import {LRUCache} from 'lru-cache';
import {logError, logInfo} from '../utils/logger';
import {IPFSDataProfile} from '../types';
import config from '../config/config';
import {CacheService} from "../utils/cache";
import {PersistenceService} from "./persistenceService";
import {ProfileValidator} from "./profileValidator";

export class KuboService implements PersistenceService {
  // @todo fix types
  public ipfs: any;

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
  // @todo make enum for types
  async unpinAll(cids: string[]): Promise<boolean> {

    try {
      // Prepare batch unpinning options based on pin type
      // Use rmAll to process all CIDs in a batch
      let unpinnedCounter = 0;
      // @todo do not apply recursive unpin to all
      for await (const result of this.ipfs.pin.rmAll(cids, { recursive: true })) {
        logInfo(`Unpinned: ${result}`);
        unpinnedCounter++;
      }
      
      // Run garbage collection after batch operation is complete
      console.log("Running garbage collection...");
      for await (const gcResult of this.ipfs.repo.gc({ quiet: false })) {
        logInfo(gcResult);
      }
      
      // Delete items from cache
      const cacheResults = await Promise.all(
        cids.map(cid => this.profileCache.delete(cid))
      );
      
      // Report final repo size
      logInfo(`Successfully unpinned ${unpinnedCounter} CIDs`);
      
      return unpinnedCounter === cids.length;

    } catch (error) {
      logError(`Error unpinning:`, error);
      return false;
    }
  }

  async listItems(offset = 0, limit = 10): Promise<{cid: string, type: string}[]> {
    try {
      // Array to store pinned items
      const pinnedItems = [];
      let skipped = 0;

      // Iterate through pinned items
      for await (const pin of this.ipfs.pin.ls()) {
        // Skip items until we reach the offset
        if (skipped < offset) {
          skipped++;
          continue;
        }
  
        // Add item to the list
        pinnedItems.push({
          cid: pin.cid.toString(), // CID of the pinned item
          type: pin.type, // Type of pin (direct, recursive, etc.)
        });

        // Break if we've reached the limit
        if (pinnedItems.length >= limit) {
          break;
        }
      }

      return pinnedItems;
    } catch (error) {
      logError('Error retrieving pinned IPFS items:', error);
      return [];
    }
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
  ): Promise<IPFSDataProfile | undefined> => {
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
      return undefined;
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
  ): Promise<IPFSDataProfile | undefined> => {
    return this.profileCache.get(cid, timeoutInMs);
  };
}