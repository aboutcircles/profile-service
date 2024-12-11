import axios from 'axios';
import { hexToNumber } from 'viem';

import config from '../config/config';
import ProfileRepo, { Profile } from '../repositories/profileRepo';
import EventQueue from '../queue/eventQueue';
import { convertMetadataDigestToCID } from '../utils/converters';

import KuboService from './kuboService';

/* todo:
- use circlesData for fetching block and missed events
- update logs (make it less)
- check for reorgs
 */

class IndexerService {
  private circlesData: any;
  private eventQueue = new EventQueue<any>();

  async initialize(): Promise<void> {
    const { CirclesRpc, CirclesData } = await import('@circles-sdk/data');

    const circlesRpc = new CirclesRpc(config.rpcEndpoint);
    this.circlesData = new CirclesData(circlesRpc);

    const latestBlock = await this.fetchLatestBlock();
    const lastProcessedBlock = ProfileRepo.getLastProcessedBlock();

    // subscribe to events before awaiting catchUpOnMissedEvents for accumulating new events to queue
    this.startWebSocketSubscription();
    await this.catchUpOnMissedEvents(lastProcessedBlock, latestBlock);
    await this.eventQueue.process(this.processEvent);
  }

  private async fetchLatestBlock(): Promise<number> {
    console.log(config.rpcEndpoint);
    const response = await axios.post(config.rpcEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    });
    return parseInt(response.data.result, 16);
  }

  private async catchUpOnMissedEvents(fromBlock: number, toBlock: number): Promise<void> {
    const response = await axios.post(config.rpcEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'circles_events',
      params: [null, fromBlock + 1, toBlock, ['CrcV2_UpdateMetadataDigest']],
    });

    const events = response.data.result || [];

    console.log('Catching up on missed events: ', events.length);

    for (const event of events) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: any): Promise<void> {
    console.log({ event });

    const { avatar, metadataDigest, blockNumber } = event.values;
    const CID = convertMetadataDigestToCID(metadataDigest);
    const profileData = await KuboService.getCachedProfile(CID, config.defaultTimeout / 2);

    console.log({ profileData })
    if (!profileData) {
      console.error(`Failed to fetch profile data for CID: ${CID}`);
      return;
    }

    const profile: Profile = {
      address: avatar,
      CID,
      lastUpdatedAt: hexToNumber(blockNumber),
      name: profileData.name,
      description: profileData.description,
    };

    ProfileRepo.upsertProfile(profile);
  }

  private async startWebSocketSubscription(): Promise<void> {
    const events = await this.circlesData.subscribeToEvents();

    events.subscribe((event: any) => {
      console.log('Event received: ', event);
      this.eventQueue.enqueue(event);
    });
  }
}

export default new IndexerService();
