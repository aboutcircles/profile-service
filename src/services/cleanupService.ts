import config from './../config/config';
import {logInfo} from '../utils/logger';
import {ProfileRepository} from '../repositories/profileRepo';
import {PersistenceService} from "./persistenceService";

export class CleanupService {
  private initialization = true;
  private cleanupInProgress = false;
  private chunkSize = 100;

  constructor(private persistenceService: PersistenceService, private profileRepository: ProfileRepository) {
    logInfo('Constructing CleanupService');
  }

  initialize = async () => {
    // @todo add as a cron process
    // @todo this should be enableds only after full sync
    logInfo('Initializing CleanupService');
    // @todo add filter by last modified
    // the filter is only applicable to the s3
    // @todo setup cron procedure
    await this.cleanup();
  };
  // @todo check item type
  // @todo check if we have an offset issue that after the items deletion the offset should not jump

  cleanup = async () => {
    logInfo('Cleanup started');
    this.cleanupInProgress = true;
    let cidsBatch: {cid: string}[] = [];
    let stats = {
      total: 0,
      removed: 0
    }
    
    const pinStream = this.persistenceService.streamPins();
    
    for await (const pin of pinStream) {
      // Step 1: Add CIDs to the batch
      cidsBatch.push(pin);
      stats.total++;
      
      if (cidsBatch.length >= this.chunkSize) {
        // Process the current batch
        stats.removed += await this.processBatch(cidsBatch);
        
        // Add a small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Empty the batch for the next iteration
        cidsBatch = [];
      }
    }
    
    // Process any remaining items in the batch
    stats.removed += await this.processBatch(cidsBatch);
    
    console.log(`Cleanup completed. Processed ${stats.total} items, removed ${stats.removed} unused CIDs.`);
    this.cleanupInProgress = false;
  }
  // @todo improve comment 
  // helper funciton 
  private processBatch = async (batch: {cid: string}[]): Promise<number> => {
    let unpinItemsCount = 0;
      if (batch.length !== 0) {
      
      const CIDs = batch.map(pin => pin.cid);
      const existResults = await this.profileRepository.checkProfilesCidsExist(CIDs);
      const unpinItems = batch
        .filter((_: any, index: number) => !existResults[index]);
        
      if (unpinItems.length) {
        unpinItemsCount = await this.persistenceService.unpinAll(unpinItems);
      }
    }

    return unpinItemsCount;
  };
}
