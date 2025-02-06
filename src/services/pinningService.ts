import FormData from 'form-data';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';
import {logError, logInfo} from '../utils/logger';
import {LRUCache} from 'lru-cache';
import {SanitizedProfile} from '../utils/sanitizer';
import config from '../config/config';
import {CacheService} from '../utils/cache';
import {PersistenceService} from './persistenceService';
import {ProfileValidator} from './profileValidator';
import AWS from "aws-sdk";

export class PinningService implements PersistenceService {
  profileCache: CacheService<SanitizedProfile>;
  blackList = new LRUCache<string, any>({max: 100000});

  constructor() {
    logInfo('Constructing FilebaseGatewayPersistenceService');

    this.profileCache = new CacheService<SanitizedProfile>(
      config.cacheMaxSize,
      this.fetchProfileFromOrigin.bind(this)
    );

    this.initialize();
  }

  isHealthy(): Promise<boolean> {
    // implement your own health check if needed
    throw new Error('Method not implemented.');
  }

  async pin(profile: SanitizedProfile): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const s3 = new AWS.S3({
          endpoint: config.s3ApiUrl,
          region: 'us-east-1',
          signatureVersion: 'v4',
          accessKeyId: config.s3Key,
          secretAccessKey: config.s3Secret,
        });

        const jsonBuffer = Buffer.from(JSON.stringify(profile), 'utf-8');
        const params = {
          Bucket: <string>config.s3Bucket,
          Key: uuidv4(),
          Body: jsonBuffer
        };

        const request = s3.putObject(params);
        request.on('httpHeaders', (statusCode, headers) => {
          resolve(headers['x-amz-meta-cid']);
        });
        request.send();
      } catch (err) {
        console.error(`Error uploading profile ${JSON.stringify(profile)} to Filebase:`, err);
        reject(err);
      }
    });
  }

  initialize = async () => {
    logInfo('Initializing FilebaseGatewayPersistenceService');
  };

  addToBlackList = (cid: string) => {
    logInfo(`Adding CID to blacklist: ${cid}`);
    this.blackList.set(cid, true);
  };

  isBlackListed = (cid: string) => {
    return this.blackList.get(cid) !== undefined;
  };

  fetchProfileFromOrigin = async (
    cid: string,
    timeoutInMs: number
  ): Promise<SanitizedProfile | undefined> => {
    logInfo(`Fetching profile for CID: ${cid} from IPFS gateway.`);

    if (this.isBlackListed(cid)) {
      throw new Error(
        `The CID ${cid} is blacklisted because it failed validation previously`
      );
    }

    const gatewayUrl = `${config.ipfsGateway}${cid}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutInMs);

    let chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      const response = await fetch(gatewayUrl, {signal: controller.signal});
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Gateway returned status ${response.status}`);
      }

      // Stream the body
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No readable stream in fetch response');
      }

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        if (!value) continue; // Occasionally value could be undefined

        totalBytes += value.byteLength;

        // If we exceed the limit, abort ASAP
        if (totalBytes > config.maxProfileSize) {
          this.addToBlackList(cid);
          controller.abort(); // will cause an error below
          throw new Error(`Response size exceeds ${config.maxProfileSize} byte limit`);
        }

        chunks.push(value);
      }

    } catch (error) {
      logError('Failed to fetch profile from IPFS gateway', error);
      throw new Error('Failed to fetch profile from IPFS gateway');
    }

    // Combine all chunks into a single Uint8Array
    let data = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Now parse JSON
    let profile: any;
    try {
      profile = JSON.parse(Buffer.from(data).toString('utf-8'));
    } catch (error) {
      this.addToBlackList(cid);
      throw new Error('Invalid JSON data');
    }

    const validation = await ProfileValidator.validateProfile(profile);
    if (validation.errors.length) {
      this.addToBlackList(cid);
      throw new Error(validation.errors.join(', '));
    }

    return validation.sanitizedProfile;
  };

  getCachedProfile = async (
    cid: string,
    timeoutInMs: number
  ): Promise<SanitizedProfile | undefined> => {
    return this.profileCache.get(cid, timeoutInMs);
  };

  pinCid = async (cid: string): Promise<void> => {
    logInfo(`Pinning CID: ${cid} via pinning service`);

    try {
      const response = await fetch(config.s3ApiUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.s3Key}:${config.s3Secret}`,
        },
        body: JSON.stringify({cid}),
      });
      if (!response.ok) {
        throw new Error(`Failed to pin: ${await response.text()}`);
      }
    } catch (err) {
      logError('Failed to pin via pinning service', err);
      throw err;
    }
  };
}
