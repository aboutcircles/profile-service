import axios from 'axios';
import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

import config from '../config/config';
import ProfileRepo, {Profile} from '../repositories/profileRepo';
import EventQueue from '../queue/eventQueue';
import {uint8ArrayToCidV0} from '../utils/converters';
import {logError, logInfo, logWarn} from '../utils/logger';
import {PersistenceService} from "./persistenceService";

export class IndexerService {
  private circlesData: any;
  private eventQueue = new EventQueue<any>();
  private nameEventQueue = new EventQueue<any>();
  private initialization = true;

  // reorg handling
  private lastBlockHash: string | null = null;
  private reorgDepth = 12; // Number of blocks to handle during reorg
  private client = createPublicClient({
    chain: gnosis,
    transport: http(),
  });

  constructor(private persistenceService: PersistenceService) {}

  async initialize(): Promise<void> {
    const {CirclesRpc, CirclesData} = await import('@circles-sdk/data');

    const circlesRpc = new CirclesRpc(config.rpcEndpoint);
    this.circlesData = new CirclesData(circlesRpc);

    const latestBlock = await this.fetchLatestBlock();
    const lastProcessedBlock = ProfileRepo.getLastProcessedBlock();

    // subscribe to events before awaiting catchUpOnMissedEvents for accumulating new events to queue
    this.startWebSocketSubscription();
    this.handleCatchingUpWithBufferedEvents(lastProcessedBlock, latestBlock);

    this.reorgListening();
  }

  private async handleCatchingUpWithBufferedEvents(fromBlock: number, toBlock: number): Promise<void> {
    this.initialization = true;
    logInfo(`Starting catch up from block ${fromBlock} to ${toBlock}`);
    
    await this.catchUpOnMissedEvents(fromBlock, toBlock);
    
    // Process metadata events first to ensure profiles exist
    logInfo(`Processing ${this.eventQueue.isEmpty() ? 'no' : 'queued'} metadata events...`);
    await this.eventQueue.process(this.processEvent.bind(this));
    
    // Then process name events
    logInfo(`Processing ${this.nameEventQueue.isEmpty() ? 'no' : 'queued'} name events...`);
    await this.nameEventQueue.process(this.processRegisteredName.bind(this));
    
    logInfo('Catch up completed');
    this.initialization = false;
  }

  private async fetchLatestBlock(): Promise<number> {
    const response = await axios.post(config.rpcEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    });
    return parseInt(response.data.result, 16);
  }

  private async catchUpOnMissedEvents(fromBlock: number, toBlock: number): Promise<void> {
    const events = await this.circlesData.getEvents(
      null,
      fromBlock + 1,
      toBlock,
      [
        'CrcV2_UpdateMetadataDigest',
        'CrcV2_RegisterShortName',
        'CrcV2_RegisterGroup',
        'CrcV2_RegisterOrganization'
      ],
      [],
      true
    );

    logInfo('Catching up on missed events: ', events.length);

    for (const event of events) {
      try {
        if (event.$event === 'CrcV2_UpdateMetadataDigest') {
          if (this.initialization) {
            this.eventQueue.enqueue(event);
          } else {
            await this.processEvent(event);
          }
        } else if (['CrcV2_RegisterShortName', 'CrcV2_RegisterGroup', 'CrcV2_RegisterOrganization'].includes(event.$event)) {
          if (this.initialization) {
            this.nameEventQueue.enqueue(event);
          } else {
            await this.processRegisteredName(event);
          }
        }
      } catch (e) {
        console.error(`Couldn't process event:`, e);
      }
    }
  }

  private async processEvent(event: any): Promise<void> {
    logInfo(`Processing event from tx: ${event.transactionHash}, blockNumber: ${event.blockNumber}`);

    const {avatar, metadataDigest, blockNumber} = event;
    // remove 0x prefix
    const CID = uint8ArrayToCidV0(metadataDigest.slice(1));
    const profileData = await this.persistenceService.getCachedProfile(CID, config.defaultTimeout / 2);

    if (!profileData) {
      logError(`Failed to fetch profile data for CID: ${CID}`);
      return;
    }
    logInfo(`Profile proccessed for CID: ${CID}, avatar: ${avatar}, name: ${profileData.name}`);

    const profile: Profile = {
      address: avatar,
      CID,
      lastUpdatedAt: blockNumber,
      name: profileData.name,
      description: profileData.description,
      registeredName: null,
    };

    ProfileRepo.upsertProfile(profile);
  }

  private async processRegisteredName(event: any): Promise<void> {
    const { avatar, blockNumber, organization, group } = event;
    logInfo(`Processing registered name event: ${event.$event} for ${avatar ?? organization ?? group} at block ${blockNumber}`, ...event);
    let name: string | null = null;

    switch(event.$event) {
      case 'CrcV2_RegisterOrganization':
      case 'CrcV2_RegisterGroup':
        name = event.name;
        break;
      case 'CrcV2_RegisterShortName': {
        try {
          // Convert uint72 to bytes then to base58
          const shortNameBigInt = BigInt(event.shortName);
          const hex = shortNameBigInt.toString(16).padStart(18, '0'); // 72 bits = 18 hex chars
          const bytes = Buffer.from(hex, 'hex');
          const bs58 = await import('bs58');
          name = bs58.default.encode(bytes);
          logInfo(`Converted shortName ${event.shortName} to base58: ${name}`);
        } catch (error) {
          logError(`Failed to convert shortName to base58: ${error}`);
          return;
        }
        break;
      }
    }

    if (name) {
      const profile: Profile = {
        address: avatar ?? organization ?? group,
        CID: '', // Will be updated by UpdateMetadataDigest event
        lastUpdatedAt: blockNumber,
        name: '', // Will be updated by UpdateMetadataDigest event
        description: '', // Will be updated by UpdateMetadataDigest event
        registeredName: name,
      };
      ProfileRepo.updateProfile(profile);
      logInfo(`Attempted to update registered name for ${avatar ?? organization ?? group}: ${name}`);
    }
  }

  private async startWebSocketSubscription(): Promise<void> {
    const events = await this.circlesData.subscribeToEvents();

    events.subscribe((event: any) => {
      logInfo('Event received: ', event.$event);

      if (event.$event === 'CrcV2_UpdateMetadataDigest') {
        if (this.initialization) {
          this.eventQueue.enqueue(event);
        } else {
          this.processEvent(event);
        }
      } else if (['CrcV2_RegisterShortName', 'CrcV2_RegisterGroup', 'CrcV2_RegisterOrganization'].includes(event.$event)) {
        if (this.initialization) {
          this.nameEventQueue.enqueue(event);
        } else {
          this.processRegisteredName(event);
        }
      }
    });
  }

  // reorg handling
  private reorgListening(): void {
    this.client.watchBlocks({
      onBlock: async (block) => {
        const blockNumber = Number(block.number);
        const blockHash = block.hash;
        const parentHash = block.parentHash;

        logInfo(`New block: ${blockNumber}, hash: ${blockHash}, parentHash: ${parentHash}`);
        // Check for reorg
        if (this.lastBlockHash && parentHash !== this.lastBlockHash) {
          logWarn('Reorg detected! Re-indexing recent blocks...');
          // not waiting until finish on purpose
          this.handleReorg(blockNumber);
        }

        // Update last block state
        this.lastBlockHash = blockHash;
      },
      onError: (error) => {
        logError('Error watching blocks:', error);
      },
    });
  }

  private async handleReorg(currentBlockNumber: number): Promise<void> {
    const startBlock = Math.max(currentBlockNumber - this.reorgDepth, 0);

    logInfo(`Handling reorg: Deleting data older than block ${startBlock}`);

    // Delete all records older than currentBlockNumber - 12
    ProfileRepo.deleteDataOlderThanBlock(startBlock);

    // Re-index blocks from startBlock
    this.handleCatchingUpWithBufferedEvents(startBlock, currentBlockNumber);
  }
}
