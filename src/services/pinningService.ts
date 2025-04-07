import FormData from 'form-data';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';
import {logError, logInfo} from '../utils/logger';
import {LRUCache} from 'lru-cache';
import {IPFSDataProfile} from '../types';
import config from '../config/config';
import {CacheService} from '../utils/cache';
import {PersistenceService} from './persistenceService';
import {ProfileValidator} from './profileValidator';
import AWS from "aws-sdk";

export class PinningService implements PersistenceService {
  //@todo fix types
  ipfs: any;
  profileCache: CacheService<IPFSDataProfile>;
  blackList = new LRUCache<string, any>({max: 100000});

  constructor() {
    logInfo('Constructing FilebaseGatewayPersistenceService');

    this.profileCache = new CacheService<IPFSDataProfile>(
      config.cacheMaxSize,
      this.fetchProfileFromOrigin.bind(this)
    );

    this.initialize();
  }

  isHealthy(): Promise<boolean> {
    // implement your own health check if needed
    throw new Error('Method not implemented.');
  }

  async pin(profile: IPFSDataProfile): Promise<string> {
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

  // @todo improve comments / returns list of keys and cids to delete
  async listItems(offset: number = 0, limit: number = 10): Promise<{ cid: string, key?: string, createdAt?: number }[]> {
    logInfo('Listing pinned CIDs via S3 API');
  
    try {
      const s3 = new AWS.S3({
        endpoint: config.s3ApiUrl,
        region: 'us-east-1',
        signatureVersion: 'v4',
        accessKeyId: config.s3Key,
        secretAccessKey: config.s3Secret,
      });
  
      const listParams: AWS.S3.ListObjectsV2Request = {
        Bucket: config.s3Bucket as string,
        MaxKeys: 1000 // Use maximum allowed to efficiently paginate
      };
  
      const pinnedItems: { cid: string, key?: string, createdAt?: number }[] = [];
      let truncated = true;
      let continuationToken: string | undefined;
      let itemsProcessed = 0;
  
      // Paginate through objects until we reach the desired offset + limit
      while (truncated && pinnedItems.length < limit) {
        if (continuationToken) {
          listParams.ContinuationToken = continuationToken;
        }
        
        const response = await s3.listObjectsV2(listParams).promise();
        truncated = !!response.IsTruncated;
        continuationToken = response.NextContinuationToken;
        
        if (response.Contents) {
          // Get metadata for each object to extract CID
          const objectDetailsPromises = response.Contents.map(async (object) => {
            try {
              const headParams = {
                Bucket: config.s3Bucket as string,
                Key: object.Key as string
              };
              
              const metadata = await s3.headObject(headParams).promise();
              const cid = metadata.Metadata?.['cid'] || metadata.Metadata?.['x-amz-meta-cid'];
              if (cid) {
                return {
                  cid,
                  key: object.Key,
                  createdAt: object.LastModified ? Math.floor(object.LastModified.getTime() / 1000) : undefined
                };
              }
              return null;
            } catch (err) {
              logError(`Failed to get metadata for object: ${object.Key}`, err);
              return null;
            }
          });
          
          const objectDetails = await Promise.all(objectDetailsPromises);
          const validObjects = objectDetails.filter(item => item !== null) as { cid: string, key?: string, createdAt?: number }[];
          
          // Apply offset and limit logic
          if (itemsProcessed + validObjects.length > offset) {
            // Calculate how many items to skip from this batch
            const skipCount = Math.max(0, offset - itemsProcessed);
            // Calculate how many items to take from this batch
            const takeCount = Math.min(limit - pinnedItems.length, validObjects.length - skipCount);
            
            // Add relevant items to the result
            pinnedItems.push(...validObjects.slice(skipCount, skipCount + takeCount));
          }
          
          itemsProcessed += validObjects.length;
          
          // If we've processed enough items to satisfy the limit, break the loop
          if (pinnedItems.length >= limit || !truncated) {
            break;
          }
        }
      }
  
      return pinnedItems;
    } catch (err) {
      logError('Failed to list pinned CIDs', err);
      throw err;
    }
  }
  // @todo update input
  async unpinAll(itemsToDelete: {cid: string, key: string, createdAt?: number}[]): Promise<boolean> {
    // @todo delete from cache
    try {
      const s3 = new AWS.S3({
        endpoint: config.s3ApiUrl,
        region: 'us-east-1',
        signatureVersion: 'v4',
        accessKeyId: config.s3Key,
        secretAccessKey: config.s3Secret,
      });

      // Delete objects one by one
      const deleteResults = [];
      for (const item of itemsToDelete) {
        const deleteParams = {
          Bucket: config.s3Bucket as string,
          Key: item.key
        };

        // Delete item from cache
        await this.profileCache.delete(item.cid);
        
        try {
          // Delete a single object and await its completion
          const result = await s3.deleteObject(deleteParams).promise();
          deleteResults.push({
            Key: item.key,
            Status: "DELETED",
          });
          // @todo remove from cache
          logInfo(`Successfully deleted: ${item.key}`);
        } catch (error) {
          logError(`Error deleting object ${item.key}:`, error);
        }
      }

      return deleteResults.length > 0;

    } catch (err) {
      logError(`Failed to unpin CID: ${itemsToDelete.length}`, err);
      throw err;
    }
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
  ): Promise<IPFSDataProfile | undefined> => {
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
      // @notice throwing error here causes the profiles service to fail
      return undefined;
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
  ): Promise<IPFSDataProfile | undefined> => {
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
