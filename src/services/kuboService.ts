import {LRUCache} from 'lru-cache';
import {logError, logInfo} from '../utils/logger';
import {IPFSDataProfile} from '../types';
import config from '../config/config';
import {CacheService} from "../utils/cache";
import {PersistenceService} from "./persistenceService";
import {ProfileValidator} from "./profileValidator";
import {
  BlacklistedCidError,
  FetchTimeoutError,
  InvalidJSONError, ProfileValidationError,
  ResponseSizeExceededError
} from "./fetchFromOriginErrors";

export class KuboService implements PersistenceService {
  private ipfs: any;

  profileCache: CacheService<IPFSDataProfile>;
  blackList = new LRUCache<string, any>({max: 100000});

  constructor() {
    logInfo('constructing KuboService');

    this.profileCache = new CacheService<IPFSDataProfile>(
      config.cacheMaxSize,
      this.fetchProfileFromOrigin.bind(this)
    );
    this.initialize();
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Check if IPFS client is initialized
      if (!this.ipfs) {
        logError('IPFS client is not initialized yet');
        return false;
      }
      
      await this.ipfs.id();
      return true;
    } catch (error) {
      logError('IPFS node is not healthy', error);
      return false;
    }
  }

  async pin(profile: IPFSDataProfile): Promise<string> {
    const buffer = Buffer.from(JSON.stringify(profile));
    const result = await this.ipfs.add(buffer);
    await this.ipfs.pin.add(result.cid);
    return result.cid.toString();
  }

  initialize = async () => {
    logInfo('Initializing KuboService');
    const kubo = await import('kubo-rpc-client');
    this.ipfs = kubo.create(config.ipfs);
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
  ): Promise<IPFSDataProfile> => {
    logInfo(`Fetching profile for CID: ${cid} from IPFS (Kubo).`);

    // 1. Blacklist check
    if (this.isBlackListed(cid)) {
      throw new BlacklistedCidError(
          `The CID ${cid} is blacklisted because it failed validation previously`
      );
    }

    let data = Buffer.alloc(0);

    try {
      // Kubo's `cat` can take a timeout option in ms
      const stream: AsyncIterable<Uint8Array> = this.ipfs.cat(cid, {
        timeout: timeoutInMs
      });

      for await (const chunk of stream) {
        // 2. Size check
        if (data.length + chunk.length > config.maxProfileSize) {
          this.addToBlackList(cid);
          throw new ResponseSizeExceededError(
              `Response size exceeds ${config.maxProfileSize} byte limit`
          );
        }

        data = Buffer.concat([data, chunk]);
      }
    } catch (error: any) {
      if (
          error.name.toLowerCase().includes("timeout") ||
          (typeof error.message === 'string' &&
              (error.message.toLowerCase().includes('timeout') || error.message.toLowerCase().includes('deadline')))
      ) {
        // TODO: What's the correct error.name and/or message?
        throw new FetchTimeoutError(`Timed out after ${timeoutInMs}ms for CID ${cid}`);
      }
      // Otherwise, treat it as a general error
      logError(`Failed to fetch profile from IPFS for CID ${cid}`, error);
      throw error;
    }

    // 4. Parse JSON
    let profile: any;
    try {
      profile = JSON.parse(data.toString('utf-8'));
    } catch (err) {
      this.addToBlackList(cid);
      throw new InvalidJSONError(`Invalid JSON data for CID ${cid}`);
    }

    // 5. Validate the profile
    const validation = await ProfileValidator.validateProfile(profile);
    if (validation.errors.length) {
      this.addToBlackList(cid);
      throw new ProfileValidationError(`Profile validation failed for CID ${cid}: ` + validation.errors.join(', '));
    }

    return validation.sanitizedProfile!;
  };

  getCachedProfile = async (
    cid: string,
    timeoutInMs: number
  ): Promise<IPFSDataProfile> => {
    return this.profileCache.get(cid, timeoutInMs);
  };
}