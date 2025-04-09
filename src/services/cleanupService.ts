import { CronJob } from 'cron';
import {logError, logInfo} from '../utils/logger';
import config from '../config/config';
import {ProfileRepository} from '../repositories/profileRepo';
import {PersistenceService} from "./persistenceService";
import {Pin} from '../types'

export class CleanupService {
  private cronJob!: CronJob;
  private cleanupInProgress: boolean = false;
  private lastCleanUp: number = 0; // UNIX time of the last cleanup

  constructor(private persistenceService: PersistenceService, private profileRepository: ProfileRepository) {
    logInfo('Constructing CleanupService');
  }

  initialize = () => {
    logInfo('Initializing CleanupService');
    
    // Setup cron procedure to run every 20 minutes
    this.cronJob = new CronJob(
      `0 */${config.cleanupInterval} * * * *`,
      async () => {
        // If cleanup is already in progress, skip
        if (this.cleanupInProgress) {
          logInfo('Cleanup already in progress, skipping');
          return;
        }
        
        logInfo('Starting scheduled cleanup');
        try {
          await this.cleanup();
          logInfo('Scheduled cleanup completed successfully');
        } catch (error: any) {
          logError(`Scheduled cleanup failed: ${error.message}`);
        }
      },
      null,  // onComplete
      true,  // start
      null,  // timezone
      null,  // context
      true   // runOnInit
    );
    
    // Start the cron job
    this.cronJob.start();
    logInfo(`Cleanup cron job started - running every ${config.cleanupInterval} minutes`);
    
    return Promise.resolve();
  };

  /**
   * Performs a cleanup operation by identifying and removing unused content identifiers (CIDs).
   * 
   * This method:
   * 1. Retrieves all pins from the persistence service in a streaming fashion
   * 2. Processes pins in batches (defined by config.cleanupBatchSize)
   * 3. For each batch, determines which CIDs are no longer associated with any profiles
   * 4. Unpins (removes) those unused CIDs from the persistence service
   * 
   * The cleanup runs as an atomic operation (tracked via cleanupInProgress flag)
   * to prevent concurrent executions.
   * 
   * @returns {Promise<void>} A promise that resolves when the cleanup completes
   */
  cleanup = async () => {
    this.cleanupInProgress = true;
    let cidsBatch: Pin[] = [];
    let stats = {
      total: 0,
      removed: 0
    }

    const pinStream = this.persistenceService.streamPins(config.useS3 ? this.lastCleanUp : undefined)
    
    for await (const pin of pinStream) {
      // Step 1: Add CIDs to the batch
      cidsBatch.push(pin);
      stats.total++;
      
      if (cidsBatch.length >= config.cleanupBatchSize) {
        // Process the current batch
        stats.removed += await this.processBatch(cidsBatch);
        
        // Empty the batch for the next iteration
        cidsBatch = [];
      }
    }

    // Process any remaining items in the batch
    stats.removed += await this.processBatch(cidsBatch);
    this.cleanupInProgress = false;
    this.lastCleanUp = Math.floor(Date.now() / 1000);

    console.log(`Cleanup process completed. Processed ${stats.total} items, removed ${stats.removed} unused CIDs.`);
  }

  /**
   * Processes a batch of Pin objects to identify and remove unused CIDs.
   * 
   * This helper function:
   * 1. Extracts the CIDs from the batch of Pin objects
   * 2. Checks with the profile repository to determine which CIDs are still in use
   * 3. Filters the batch to find Pin objects whose CIDs are no longer referenced by any profiles
   * 4. Removes these unused CIDs from the persistence service
   * 
   * @param {Pin[]} batch - An array of Pin objects to process
   * @returns {Promise<number>} A promise that resolves to the number of items that were unpinned
   */
  private processBatch = async (batch: Pin[]): Promise<number> => {
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
