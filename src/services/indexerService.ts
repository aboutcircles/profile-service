import axios from 'axios';
import {createPublicClient, http} from 'viem';
import {gnosis} from 'viem/chains';
import config from '../config/config';
import {ProfileRepository} from '../repositories/profileRepo';
import {Profile} from '../types';
import EventQueue from '../queue/eventQueue';
import {uint8ArrayToCidV0} from '../utils/converters';
import {logDebug, logError, logInfo, logWarn} from '../utils/logger';
import {PersistenceService} from './persistenceService';
import {
  BlacklistedCidError,
  FetchTimeoutError,
  GatewayError,
  InvalidJSONError,
  ProfileValidationError,
  ResponseSizeExceededError
} from "./fetchFromOriginErrors";
import {EventEnvelope} from "./eventEnvelope";

export class IndexerService {
  private circlesData: any;

  /**
   * Single FIFO queue for *all* events (both older "RPC" events and new "WS" events, as well as events queued for retry).
   */
  private eventQueue = new EventQueue<EventEnvelope>();

  /**
   * Buffer for *new* subscription events while we are still catching up.
   * We'll flush these into `eventQueue` only *after* the older events are processed.
   */
  private subscriptionBuffer: EventEnvelope[] = [];

  /**
   * Flag to prevent multiple queue processors from running simultaneously.
   */
  private processingQueue = false;

  private websocketUnsubscriber: any;

  /**
   * Reorg handling
   */
  private lastBlockHash: string | null = null;
  private reorgDepth = 12; // Number of blocks to handle in a reorg

  private client = createPublicClient({
    chain: gnosis,
    transport: http(),
  });

  constructor(
    private persistenceService: PersistenceService,
    private profileRepository: ProfileRepository
  ) {
  }

  /**
   * Main initialization:
   * 1) Start subscription, but store incoming events in `subscriptionBuffer`.
   * 2) Fetch older events (RPC) and enqueue them.
   * 3) Process those older events first.
   * 4) Flush subscription buffer (the new WS events that arrived meanwhile).
   * 5) Switch subscription to enqueue directly in real time.
   * 6) Start reorg detection.
   */
  async initialize(): Promise<void> {
    const {CirclesRpc, CirclesData} = await import('@circles-sdk/data');
    const circlesRpc = new CirclesRpc(config.rpcEndpoint);
    this.circlesData = new CirclesData(circlesRpc);

    // 1) Start the subscription in "buffer mode" (so we lose nothing).
    this.bufferLiveEvents()
      .then(() => logInfo('Subscribed to live events. Buffering new events...'));

    // 2) Figure out what block was last processed and the current chain tip.
    const latestBlock = await this.fetchLatestBlock();
    const lastProcessedBlock = this.profileRepository.getLastProcessedBlock();

    // 3) Catch up on older events (from lastProcessedBlock -> latestBlock).
    //    Put them directly into our single eventQueue.
    await this.catchUpOnMissedEvents(lastProcessedBlock, latestBlock);

    // 4) Process the queue (all older events get processed here first).
    await this.processQueue();

    // 5) Flush any subscription events that arrived during the catch-up.
    //    Now these "live" events are guaranteed to be from strictly newer blocks.
    logInfo('Flushing buffered subscription events...');

    for (const event of this.subscriptionBuffer) {
      this.eventQueue.enqueue({
        event,
        retries: 0,  // first time we see this event
      } as EventEnvelope);
    }
    this.subscriptionBuffer = [];
    await this.processQueue();

    // 6) Now that the backlog is done, direct any newly arriving subscription events straight to the queue.
    this.processLiveEvents()
      .then(() => logInfo('Subscribed to live events. Processing new events...'));

    // Finally, watch for reorgs
    this.reorgListening();

    logInfo('IndexerService initialized successfully.');
  }

  /**
   * Subscribe to Circles data events, but initially store them in
   * `subscriptionBuffer`. We'll flush them after we've processed
   * all older events.
   */
  private async bufferLiveEvents(): Promise<void> {
    const events = await this.circlesData.subscribeToEvents();
    this.websocketUnsubscriber = events.subscribe((event: any) => {
      // During the catch-up, simply store them so we don't lose them.
      this.subscriptionBuffer.push({
        event: event,
        retries: 0
      } as EventEnvelope);
    });
  }

  /**
   * After we're finished catching up, we "switch" the subscription to
   * enqueue events directly in real-time, rather than stashing them.
   */
  private async processLiveEvents(): Promise<void> {
    if (this.websocketUnsubscriber) {
      this.websocketUnsubscriber();
    }
    const events = await this.circlesData.subscribeToEvents();
    this.websocketUnsubscriber = events.subscribe((event: any) => {
      this.enqueueEvent(event); // now we enqueue live events in real time
    });

    logInfo('Subscription switched to direct enqueue mode.');
  }

  /**
   * Fetch the current chain tip using an RPC call.
   */
  private async fetchLatestBlock(): Promise<number> {
    const response = await axios.post(config.rpcEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    });
    return parseInt(response.data.result, 16);
  }

  /**
   * Catch up on missed events from block `fromBlock + 1` to `toBlock`.
   * Enqueue them for processing (older events).
   */
  private async catchUpOnMissedEvents(fromBlock: number, toBlock: number) {
    try {
      const events = await this.circlesData.getEvents(
        null,
        fromBlock + 1,
        toBlock,
        [
          'CrcV1_UpdateMetadataDigest',
          'CrcV2_UpdateMetadataDigest',
          'CrcV2_RegisterShortName',
          'CrcV2_RegisterGroup',
          'CrcV2_RegisterOrganization',
        ],
        [],
        true
      );

      logInfo(
        `Catching up on missed events: ${events.length} total from block ${fromBlock + 1} to ${toBlock}.`
      );

      // Enqueue all these older events
      for (const event of events) {
        this.eventQueue.enqueue({
          event,
          retries: 0,  // first time we see this event
        } as EventEnvelope);
      }
    } catch (e) {
      logError('Error fetching events:', e);
    }
  }

  /**
   * Standard queue-based event processing with concurrency = 1.
   * As soon as an event is enqueued, we call this.
   * If the queue is already being processed, the call does nothing
   * because `processingQueue` is true.
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }
    this.processingQueue = true;

    try {
      while (!this.eventQueue.isEmpty()) {
        const envelope = this.eventQueue.dequeue();
        if (!envelope) {
          throw new Error('Event envelope is null');
        }
        await this.processSingleEvent(envelope);
      }
    } catch (err) {
      logError('Error processing event queue:', err);
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Helper to safely enqueue (live) events after initialization is done.
   * Triggers processing as well.
   */
  private enqueueEvent(event: any) {
    this.eventQueue.enqueue({
      event,
      retries: 0,  // first time we see this event
    } as EventEnvelope);

    void this.processQueue(); // Kick off processing if we're idle
  }

  /**
   * Process an event by type, ensuring we do a single DB write at a time (SQLite friendly).
   */
  private async processSingleEvent(envelope: EventEnvelope) {
    try {
      switch (envelope.event.$event) {
        case 'CrcV1_UpdateMetadataDigest':
        case 'CrcV2_UpdateMetadataDigest':
          await this.processUpdateMetadataEvent(envelope);
          break;

        case 'CrcV2_RegisterShortName':
        case 'CrcV2_RegisterGroup':
        case 'CrcV2_RegisterOrganization':
          await this.processNameEvent(envelope.event);
          break;

        default:
          logDebug(`Received event of unknown type: ${envelope.event.$event}`);
          break;
      }
    } catch (e: any) {
      // If we got a 404 => do not retry
      if (e instanceof GatewayError && e.statusCode === 404) {
        logWarn(`Non-retryable 404 for event ${envelope.event.$event}, block ${envelope.event.blockNumber}`);
        return;
      }

      // If we got a 5xx => retry if under limit
      if (e instanceof GatewayError && e.statusCode >= 500 && e.statusCode < 600) {
        if (envelope.retries < config.maxProfileFetchRetries) {
          logWarn(
            `Queueing ${envelope.event.$event} for retry, block ${envelope.event.blockNumber}, attempt ${envelope.retries + 1} after 5xx: ${e.message}`
          );
          this.eventQueue.enqueue({event: envelope.event, retries: envelope.retries + 1});
        } else {
          logError(
            `Giving up on ${envelope.event.$event}, block ${envelope.event.blockNumber} after ${envelope.retries} attempts (5xx error).`
          );
        }
        return;
      }

      // If we got a fetch timeout => retry if under limit
      if (e instanceof FetchTimeoutError) {
        if (envelope.retries < config.maxProfileFetchRetries) {
          logWarn(
            `Queueing ${envelope.event.$event} for retry, block ${envelope.event.blockNumber}, attempt ${envelope.retries + 1} after timeout: ${e.message}`
          );
          this.eventQueue.enqueue({event: envelope.event, retries: envelope.retries + 1});
        } else {
          logError(
            `Giving up on ${envelope.event.$event}, block ${envelope.event.blockNumber} after ${envelope.retries} attempts (timeout).`
          );
        }
        return;
      }

      // If these non-retryable errors:
      if (
        e instanceof BlacklistedCidError ||
        e instanceof ResponseSizeExceededError ||
        e instanceof InvalidJSONError ||
        e instanceof ProfileValidationError
      ) {
        logWarn(`Non-retryable error for event ${envelope.event.$event}, block ${envelope.event.blockNumber}: ${e.message}`);
        return;
      }

      logError(
        `Failed to process event ${envelope.event.$event} (tx: ${envelope.event.transactionHash}):`, e
      );

      throw e;
    }
  }

  /**
   * Processes the "UpdateMetadataDigest" event, updating the profile in SQLite.
   */
  private async processUpdateMetadataEvent(envelope: EventEnvelope) {
    const {avatar, metadataDigest, blockNumber, transactionHash} = envelope.event;


    const latestBlock = this.profileRepository.getLastProcessedBlockForAddress(avatar);
    if (blockNumber <= latestBlock) {
      logInfo(
        `Skipping metadata event at block ${blockNumber} for ${avatar} – newer data already stored at block ${latestBlock}.`
      );
      return;
    }

    if (envelope.retries > 0) {
      // This is an old event which is retried.
      // Ignore it if the account already has newer data.
      const latestBlock = this.profileRepository.getLastProcessedBlockForAddress(avatar);
      if (latestBlock > envelope.event.blockNumber) {
        logInfo(
          `Retry: Discarding old event ${envelope.event.$event} for address ${avatar} (tx: ${envelope.event.transactionHash}) because there is newer data (block ${envelope.event.blockNumber}).`
        );
        return;
      }

      logInfo(`Retry: Retrying event ${envelope.event.$event} for address ${avatar} (tx: ${envelope.event.transactionHash}).. Attempt ${envelope.retries}.`);
    }

    logInfo(`Processing metadata update: tx=${transactionHash}, block=${blockNumber}`);

    if (envelope.event.$event === 'CrcV1_UpdateMetadataDigest' && this.profileRepository.hasProfile(avatar)) {
      // Check if there's already a (v2) profile for the address, if so, skip the event.
      // Long term we might want to store both profiles. Right now v2 overrides v1.
      logInfo(`Skipping v1 profile for ${avatar} because there's a profile already`);
      return;
    }

    // remove "0x" prefix
    const CID = uint8ArrayToCidV0(metadataDigest.slice(1));

    // Attempt to fetch IPFS data
    const profileData = await this.persistenceService.getCachedProfile(CID, config.defaultTimeout);

    // If IPFS data is found, store it all
    const profile: Profile = {
      address: avatar,
      CID,
      lastUpdatedAt: blockNumber,
      name: profileData.name ?? null, // use null if not provided
      description: profileData.description ?? undefined,
      registeredName: null,
      location: profileData.location ?? undefined,
      geoLocation: profileData.geoLocation ?? undefined
    };

    this.profileRepository.upsertProfile(profile);

    logInfo(
      `Profile upserted for avatar=${avatar}, block=${blockNumber}, name=${profileData.name}`
    );
  }

  /**
   * Processes register-name events (ShortName, Group, Org), updating the
   * corresponding record in SQLite.
   */
  private async processNameEvent(event: any) {
    const {avatar, organization, group, blockNumber, shortName} = event;
    logInfo(
      `Processing name event: ${event.$event}, block=${blockNumber} for ${
        avatar ?? organization ?? group
      }`
    );

    let name: string | null = null;

    switch (event.$event) {
      case 'CrcV2_RegisterOrganization':
      case 'CrcV2_RegisterGroup':
        name = event.name || null; // if the event has no name, store null
        break;

      case 'CrcV2_RegisterShortName':
        try {
          const shortNameBigInt = BigInt(shortName);
          const hex = shortNameBigInt.toString(16).padStart(18, '0');
          const bytes = Buffer.from(hex, 'hex');
          const bs58 = await import('bs58');
          name = bs58.default.encode(bytes);
          logInfo(`Converted shortName ${shortName} to base58: ${name}`);
        } catch (err) {
          logError(`Failed to convert shortName ${shortName} to base58: ${err}`);
          return;
        }
        break;
    }

    if (name) {
      const address = avatar ?? organization ?? group;
      const profile: Profile = {
        address,
        CID: null, // updated by a future UpdateMetadataDigest event
        lastUpdatedAt: blockNumber,
        // In the name-event scenario, we don’t have an IPFS name, so store null or empty
        // The user wants to allow no name, so let's do null:
        name: null,
        description: undefined,
        registeredName: name,
        location: undefined,
        geoLocation: undefined
      };

      this.profileRepository.upsertProfile(profile);

      logInfo(`Upserted registered name for ${address}: ${name} (block ${blockNumber})`);
    }
  }

  /**
   * Listen for new blocks and detect reorg conditions.
   */
  private reorgListening(): void {
    this.client.watchBlocks({
      onBlock: async (block) => {
        const blockNumber = Number(block.number);
        const blockHash = block.hash;
        const parentHash = block.parentHash;

        logInfo(
          `New block: number=${blockNumber}, hash=${blockHash}, parentHash=${parentHash}`
        );

        // Check for reorg
        if (this.lastBlockHash && parentHash !== this.lastBlockHash) {
          logInfo('Reorg detected! Re-indexing recent blocks...');
          await this.handleReorg(blockNumber);
        }
        this.lastBlockHash = blockHash;
      },
      onError: (error) => {
        logError('Error watching blocks:', error);
      },
    });
  }

  /**
   * When a reorg is detected, we delete DB data newer than (currentBlock - reorgDepth)
   * and re-fetch events for that same range, re-processing them in a single queue run.
   */
  private async handleReorg(currentBlockNumber: number): Promise<void> {
    const startBlock = Math.max(currentBlockNumber - this.reorgDepth, 0);
    logInfo(
      `Handling reorg: removing data above block ${startBlock} and re-indexing...`
    );

    // 1) Roll back
    this.profileRepository.deleteDataOlderThanBlock(startBlock);

    // 2) Re-fetch events for [startBlock..currentBlockNumber], enqueue them
    await this.catchUpOnMissedEvents(startBlock, currentBlockNumber);

    // 3) Process them in one go
    await this.processQueue();
  }
}