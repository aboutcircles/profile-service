import config from './../config/config';

import {logInfo} from '../utils/logger';

import {ProfileRepository} from '../repositories/profileRepo';
import {PersistenceService} from "./persistenceService";

export class CleanupService {
  private initialization = true;
  private chunkSize = 2;

  constructor(private persistenceService: PersistenceService, private profileRepository: ProfileRepository) {
    logInfo('constructing CleanupService');
  }

  initialize = async () => {
    // @todo add as a cron process
    // @todo this should be enableds only after full sync
    logInfo('Initializing CleanupService');
    // @todo add filter by last modified
    // the filter is only applicable to the s3
    // @todo setup cron procedure
    if(config.useS3) {
      await this.cleanupS3();
    } else {
      await this.cleanupKubo();
    }
  };
  // @todo check item type
  // @todo check if we have an offset issue that after the items deletion the offset should not jump
  cleanupS3 = async () => {
    let offset = 0;
    let hasMoreItems = true;
    
    while (hasMoreItems) {
      // Step 1: Get a chunk of items with their keys and CIDs
      const items = await this.persistenceService.listItems(offset, this.chunkSize);
      
      if (items.length === 0) {
        hasMoreItems = false;
        break;
      }

      console.log(`Processing chunk of ${items.length} items (offset: ${offset})...`);
      
      // Step 2: Extract CIDs from the items to check existence
      const cids = items.map((item:any) => item.cid);
      // Step 3: Check which CIDs exist in the profiles database
      const existResults = await this.profileRepository.checkProfilesCidsExist(cids);
      
      // Step 4: Find keys of items whose CIDs don't exist in the profiles database
      const keysToUnpin = items
        .filter((_: any, index: number) => !existResults[index])
        .filter((item: any) => item.key !== undefined); // Filter out undefined keys
      //console.log(keysToUnpin)
      // Only attempt to unpin if there are keys to unpin
      if (keysToUnpin.length > 0) {
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
    
    console.log(`Cleanup completed.`);
  }

  cleanupKubo = async () => {
    let cidsBatch: string[] = [];
    let stats = {
      total: 0,
      removed: 0
    }

    const pinStream = this.persistenceService.streamPins();

    for await (const pin of pinStream) {
      // Step 1: Add CIDs to the batch
      cidsBatch.push(pin.cid.toString());
      stats.total++;

      if(cidsBatch.length >= this.chunkSize) {
        // Step 2: Check which CIDs utilized in the profiles database
        const existResults = await this.profileRepository.checkProfilesCidsExist(cidsBatch);
        const unpinItems = cidsBatch
          .filter((_: any, index:number) => !existResults[index]);

        // Step 4: Unpin CIDs that are not used in the profiles database
        if(unpinItems.length) {
          const unpinItemsCount = await this.persistenceService.unpinAll(unpinItems);
          stats.removed += unpinItemsCount;
        }
        // Add a small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));

        // Step 4: Empty the batch for the next iteration
        cidsBatch = [];
      }
    }

    console.log(`IPFS cleanup completed. Processed ${stats.total} items, removed ${stats.removed} unused CIDs.`);
  }
}
