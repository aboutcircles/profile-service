import {logError, logInfo, logWarn} from '../utils/logger';
import {LRUCache} from 'lru-cache';
import {IPFSDataProfile, Pin} from '../types';
import config from '../config/config';
import {CacheService} from '../utils/cache';
import {PersistenceService} from './persistenceService';
import {ProfileValidator} from './profileValidator';
import AWS from "aws-sdk";
import {
    BlacklistedCidError,
    FetchTimeoutError,
    GatewayError,
    InvalidJSONError,
    ProfileValidationError,
    ResponseSizeExceededError
} from "./fetchFromOriginErrors";
import {v4 as uuidv4} from "uuid";

export class PinningService implements PersistenceService {
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

    async *streamPins(lastCleanUp: number): AsyncGenerator<Pin> {
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

        let truncated = true;
        let continuationToken: string | undefined;

        // Paginate through objects
        while (truncated) {
          if (continuationToken) {
            listParams.ContinuationToken = continuationToken;
          }

          const response = await s3.listObjectsV2(listParams).promise();
          truncated = !!response.IsTruncated;
          continuationToken = response.NextContinuationToken;

          if (response.Contents) {
            // Process each object sequentially instead of using Promise.all
            for (const object of response.Contents) {
              try {
                const lastModifiedTime = object.LastModified ? Math.floor(object.LastModified.getTime() / 1000) : 0;
                if(lastModifiedTime <= lastCleanUp) {
                  const headParams: AWS.S3.HeadObjectRequest = {
                    Bucket: config.s3Bucket as string,
                    Key: object.Key as string
                  };

                  const metadata = await s3.headObject(headParams).promise();
                  const cid = metadata.Metadata?.['cid'] || metadata.Metadata?.['x-amz-meta-cid'];

                  if (cid) {
                    yield {
                      cid,
                      key: object.Key,
                      createdAt: object.LastModified ? lastModifiedTime : undefined
                    };
                  }
                }
              } catch (err) {
                logError(`Failed to get metadata for object: ${object.Key}`, err);
                // Continue with next object
              }
            }
          }

          // If no more pages, break the loop
          if (!truncated) {
            break;
          }
        }
      } catch (err) {
        logError('Failed to list pinned CIDs', err);
        throw err;
      }
    }

    async unpinAll(pins: Pin[]): Promise<number> {
      try {
        let unpinnedCounter = 0;
        const s3 = new AWS.S3({
          endpoint: config.s3ApiUrl,
          region: 'us-east-1',
          signatureVersion: 'v4',
          accessKeyId: config.s3Key,
          secretAccessKey: config.s3Secret,
        });

        // Delete objects one by one
        for (const pin of pins) {
          const deleteParams: AWS.S3.Types.DeleteObjectRequest = {
            Bucket: config.s3Bucket as string,
            Key: pin.key as string
          };

          try {
            // Delete a single object and await its completion
            await s3.deleteObject(deleteParams).promise();

            // Delete item from cache
            await this.profileCache.delete(pin.cid);
            unpinnedCounter++;
          } catch (error) {
            logError(`Error deleting object ${pin.key} - ${pin.cid}:`, error);
          }
        }
        logInfo(`Unpinned CIDs: ${pins.map(pin => pin.cid).join(', ')}`);
        return unpinnedCounter;

      } catch (error) {
        logError('Failed to unpin CIDs:', error);
        return 0;
      }
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
                logError(`Error uploading profile ${JSON.stringify(profile)} to Filebase:`, err);
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
    ): Promise<IPFSDataProfile> => {
        logInfo(`Fetching profile with CID: ${cid} from IPFS gateway.`);

        if (this.isBlackListed(cid)) {
            throw new BlacklistedCidError(
                `The CID ${cid} is blacklisted because it failed validation previously`
            );
        }

        const gatewayUrl = `${config.ipfsGateway}${cid}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            logWarn(`Aborting fetch for CID ${cid} due to timeout (${timeoutInMs}ms).`);
            controller.abort();
        }, timeoutInMs);

        let chunks: Uint8Array[] = [];
        let totalBytes = 0;

        try {
            const response = await fetch(gatewayUrl, {signal: controller.signal});
            clearTimeout(timeoutId);

            // If not OK (like 404 or 500), throw
            if (!response.ok) {
                throw new GatewayError(
                    `Gateway returned status ${response.status}: ${response.statusText}`,
                    response.status
                );
            }

            // Ensure there's a readable stream
            const reader = response.body?.getReader();
            if (!reader) {
                throw new GatewayError('No readable stream in fetch response', response.status);
            }

            // Stream out the body in chunks
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                if (!value) continue; // occasionally undefined

                totalBytes += value.byteLength;

                // If we exceed the limit, abort & throw
                if (totalBytes > config.maxProfileSize) {
                    this.addToBlackList(cid);
                    controller.abort();
                    throw new ResponseSizeExceededError(
                        `Response size exceeds ${config.maxProfileSize} byte limit`
                    );
                }
                chunks.push(value);
            }

        } catch (error: any) {
            // If the request was aborted due to timeout, throw a specialized error
            if (error.name === 'AbortError') {
                logWarn(`Fetch for CID ${cid} aborted (possibly timed out after ${timeoutInMs}ms).`);
                throw new FetchTimeoutError(`Timed out after ${timeoutInMs}ms for CID ${cid}`);
            }

            // Otherwise, rethrow so the caller can handle
            throw error;
        }

        // Combine all chunks into a single Uint8Array
        const data = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
        }

        // Parse JSON
        let profile: any;
        try {
            profile = JSON.parse(Buffer.from(data).toString('utf-8'));
        } catch (err) {
            this.addToBlackList(cid);
            throw new InvalidJSONError('Invalid JSON data');
        }

        // Validate
        const validation = await ProfileValidator.validateProfile(profile);
        if (validation.errors.length) {
            this.addToBlackList(cid);
            throw new ProfileValidationError(validation.errors.join(', '));
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
