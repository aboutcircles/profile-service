import axios from 'axios';
import {createPublicClient, http} from 'viem';
import {gnosis} from 'viem/chains';

import config from '../config/config';
import ProfileRepo, {Profile} from '../repositories/profileRepo';
import EventQueue from '../queue/eventQueue';
import {uint8ArrayToCidV0} from '../utils/converters';
import {logError, logInfo, logWarn} from '../utils/logger';

import KuboService from './kuboService';

/* todo:
- check search endpoint
 */

class IndexerService {
  private circlesData: any;
  private eventQueue = new EventQueue<any>();
  private initialization = true;

  // reorg handling
  private lastBlockHash: string | null = null;
  private reorgDepth = 12; // Number of blocks to handle during reorg
  private client = createPublicClient({
    chain: gnosis,
    transport: http(),
  });

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
    await this.catchUpOnMissedEvents(fromBlock, toBlock);
    await this.eventQueue.process(this.processEvent);
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
    const events = await this.circlesData.getEvents(null, fromBlock + 1, toBlock, ['CrcV2_UpdateMetadataDigest'], [], true);

    logInfo('Catching up on missed events: ', events.length);

    for (const event of events) {
      try {
        await this.processEvent(event);
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
    const profileData = await KuboService.getCachedProfile(CID, config.defaultTimeout / 2);

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
    };

    ProfileRepo.upsertProfile(profile);
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

export default new IndexerService();
