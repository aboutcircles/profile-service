import axios from 'axios';
import WebSocket, { MessageEvent } from 'ws';
import { hexToNumber } from 'viem';
import config from '../config/config';
import ProfileRepo, { Profile } from '../repositories/profileRepo';
import eventQueue from '../queue/eventQueue';
import { convertMetadataDigestToCID } from '../utils/converters';

import KuboService from './kuboService';

class IndexerService {
  private ws: WebSocket | null = null;

  async initialize(): Promise<void> {
    const latestBlock = await this.fetchLatestBlock();
    const lastProcessedBlock = ProfileRepo.getLastProcessedBlock();

    await this.catchUpOnMissedEvents(lastProcessedBlock, latestBlock);
    this.startWebSocketSubscription();
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
    const { avatar, metadataDigest, blockNumber } = event.values;
    const CID = convertMetadataDigestToCID(metadataDigest);
    const profileData = await KuboService.getCachedProfile(CID, config.defaultTimeout / 2);

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

  private startWebSocketSubscription(): void {
    console.log(config.wsEndpoint);
    this.ws = new WebSocket(config.wsEndpoint);

    this.ws.on('message', (event: MessageEvent) => {
      const message = JSON.parse(event.data as unknown as string);
      const { id, method, params } = message;
      console.log({ event, message, id, method, params });
      if (event.type === 'CrcV2_UpdateMetadataDigest') {
        eventQueue.add({ event, processEvent: this.processEvent.bind(this) });
      }
    });

    this.ws.onmessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data as unknown as string);
      const { id, method, params } = message;
      console.log({ event, message, id, method, params });
      if (event.type === 'CrcV2_UpdateMetadataDigest') {
        eventQueue.add({ event, processEvent: this.processEvent.bind(this) });
      }
    }

    this.ws.on('close', () => {
      console.warn('WebSocket closed. Reconnecting...');
      setTimeout(() => this.startWebSocketSubscription(), 1000);
    });
  }
}

export default new IndexerService();
