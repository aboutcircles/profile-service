import {logInfo} from '../utils/logger';

import {ProfileRepository} from '../repositories/profileRepo';
import {PersistenceService} from "./persistenceService";

export class CleanupService {
  private initialization = true;
  private chunkSize = 1000;

  constructor(private persistenceService: PersistenceService, private profileRepository: ProfileRepository) {
    logInfo('constructing CleanupService');
  }

  initialize = async () => {
    // @todo add as a cron process
    // @todo this should be enableds only after full sync
      logInfo('Initializing CleanupService');
      // @todo add filter by last modified
      // the filter is only applicable to the s3

      // @todo it should be ()
      if(await this.persistenceService.isHealthy()) {
        // get chunk of keys with cid or cid
        // get chunk if such cids exists
        // call delete with some props which are false for the mentioned cunck
        await this.cleanupS3();
        //await this.cleanupKubo();

    
      }
  };
  // @todo check item type
  // @todo check if we have an offset issue that after the items deletion the offset should not jump
  cleanupS3 = async () => {
    let offset = 0;
    let hasMoreItems = true;
    let stats = {
      total: 0,
      removed: 0
    };
    
    while (hasMoreItems) {
      // Step 1: Get a chunk of items with their keys and CIDs
      const items = await this.persistenceService.listItems(offset, this.chunkSize);
      
      if (items.length === 0) {
        hasMoreItems = false;
        break;
      }
      
      stats.total += items.length;
      console.log(`Processing chunk of ${items.length} items (offset: ${offset})...`);
      
      // Step 2: Extract CIDs from the items to check existence
      const cids = items.map((item:any) => item.cid);
      // Step 3: Check which CIDs exist in the profiles database
      const existResults = await this.profileRepository.checkProfilesCidsExist(cids);
      
      // Step 4: Find keys of items whose CIDs don't exist in the profiles database
      const keysToUnpin = items
        .filter((item:any, index: number) => !existResults[index])
        .filter((item: any) => item.key !== undefined); // Filter out undefined keys
      //console.log(keysToUnpin)
      // Only attempt to unpin if there are keys to unpin
      if (keysToUnpin.length > 0) {
        stats.removed += keysToUnpin.length;
  
        console.log(keysToUnpin)
        const unpinResult = await this.persistenceService.unpinAll(keysToUnpin);
        if(!unpinResult) {
          // @todo update error description
          console.log("Error unpinning keys:", keysToUnpin);
        }
      }
      
      // Step 5: Move to the next chunk
      offset += this.chunkSize;
      
      // Optional: Add a small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Cleanup completed. Processed ${stats.total} items, removed ${stats.removed} unused items.`);
    return stats;
  }

  cleanupKubo = async () => {
    let offset = 0;
    let hasMoreItems = true;
    let stats = {
      total: 0,
      removed: 0
    };
    
    while (hasMoreItems) {
      // Step 1: Get a chunk of items with their CIDs
      const items = await this.persistenceService.listItems(this.chunkSize, offset);
      
      if (items.length === 0) {
        hasMoreItems = false;
        break;
      }
      
      stats.total += items.length;
      console.log(`Processing chunk of ${items.length} items (offset: ${offset})...`);
      
      // Step 2: Extract CIDs from the items
      const cids = items.map((item: {cid: string, type: string}) => item.cid);
      
      // Step 3: Check which CIDs exist in the profiles database
      const existResults = await this.profileRepository.checkProfilesCidsExist(cids);
      
      // Step 4: Unpin CIDs that don't exist in the profiles database
      const unpinItems = items.map((item: {cid: string, type: string}) => item.cid);
      const unpinResult = await this.persistenceService.unpinAll(unpinItems);
      if(!unpinResult) {
        // @todo update error description
        console.log("Error");
      }
      
      // Step 5: Move to the next chunk
      offset += this.chunkSize;
      
      // Optional: Add a small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`CID cleanup completed. Processed ${stats.total} items, removed ${stats.removed} unused CIDs.`);
    return stats;
  }
  // @todo maybe we should also remove it from some cache
}
