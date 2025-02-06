import {LRUCache} from 'lru-cache';
import {logError, logInfo} from '../utils/logger';
import {SanitizedProfile} from '../utils/sanitizer';
import config from '../config/config';
import {CacheService} from "../utils/cache";
import {PersistenceService} from "./persistenceService";
import {ProfileValidator} from "./profileValidator";

export class KuboService implements PersistenceService {
  private ipfs: any;

  profileCache: CacheService<SanitizedProfile>;
  blackList = new LRUCache<string, any>({max: 100000});

  constructor() {
    logInfo('constructing KuboService');

    this.profileCache = new CacheService<SanitizedProfile>(
      config.cacheMaxSize,
      this.fetchProfileFromOrigin.bind(this)
    );
    this.initialize();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.ipfs.id();
      return true;
    } catch (error) {
      logError('IPFS node is not healthy', error);
      return false;
    }
  }

  async pin(profile: SanitizedProfile): Promise<string> {
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

  // ----------------------------------
  // Removed validateImage and validateProfile
  // and replaced them with calls to ProfileValidator.
  // ----------------------------------

  fetchProfileFromOrigin = async (
    cid: string,
    timeoutInMs: number
  ): Promise<SanitizedProfile | undefined> => {
    logInfo(`Fetching profile for CID: ${cid} from origin (IPFS).`);

    if (this.isBlackListed(cid)) {
      throw new Error(
        `The CID ${cid} is blacklisted because it failed validation previously`
      );
    }

    let data = Buffer.alloc(0);
    try {
      const stream: AsyncIterable<Uint8Array> = this.ipfs.cat(cid, {
        timeout: timeoutInMs
      });

      for await (const chunk of stream) {
        if (data.length + chunk.length > config.maxProfileSize) {
          this.addToBlackList(cid);
          throw new Error(
            `Response size exceeds ${config.maxProfileSize} byte limit`
          );
        }
        data = Buffer.concat([data, chunk]);
      }
    } catch (error) {
      logError('Failed to fetch profile from IPFS', error);
      throw new Error('Failed to fetch profile from IPFS');
    }

    let profile: any;
    try {
      profile = JSON.parse(data.toString('utf-8'));
    } catch (error) {
      this.addToBlackList(cid);
      throw new Error('Invalid JSON data');
    }

    // Now use ProfileValidator to validate the profile
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
}