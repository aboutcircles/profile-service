import axios from 'axios';

import config from '../config/config';
import ProfileRepo, { Profile } from '../repositories/profileRepo';
import EventQueue from '../queue/eventQueue';
import { uint8ArrayToCidV0 } from '../utils/converters';
import { logError, logInfo } from '../utils/logger';

import KuboService from './kuboService';

/* todo:
- check for reorgs
 */

class IndexerService {
  private circlesData: any;
  private eventQueue = new EventQueue<any>();
  private initialization = false;

  async initialize(): Promise<void> {
    this.initialization = true;
    const { CirclesRpc, CirclesData } = await import('@circles-sdk/data');

    const circlesRpc = new CirclesRpc(config.rpcEndpoint);
    this.circlesData = new CirclesData(circlesRpc);

    const latestBlock = await this.fetchLatestBlock();
    const lastProcessedBlock = ProfileRepo.getLastProcessedBlock();

    // subscribe to events before awaiting catchUpOnMissedEvents for accumulating new events to queue
    this.startWebSocketSubscription();
    await this.catchUpOnMissedEvents(lastProcessedBlock, latestBlock);
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
    const response = await this.circlesData.getEvents(null, fromBlock + 1, toBlock, ['CrcV2_UpdateMetadataDigest']);
    // ascending order
    const events = response.reverse();

    logInfo('Catching up on missed events: ', events.length);

    for (const event of events) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: any): Promise<void> {
    logInfo(`Processing event from tx: ${event.transactionHash}, blockNumber: ${event.blockNumber}`);

    const { avatar, metadataDigest, blockNumber } = event;
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
}

export default new IndexerService();
