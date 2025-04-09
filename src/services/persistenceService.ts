import {CacheService} from "../utils/cache";
import {LRUCache} from "lru-cache";
import {IPFSDataProfile, Pin} from "../types";

export interface PersistenceService {
  /**
   * In-memory cache service for IPFSDataProfile objects.
   */
  profileCache: CacheService<IPFSDataProfile>;

  /**
   * Blacklist cache to store invalid or disallowed CIDs.
   */
  blackList: LRUCache<string, any>;

  /**
   * Initializes the IPFS client.
   */
  initialize(): Promise<void>;

  /**
   * Adds a CID to the blacklist.
   * @param cid - The CID to blacklist.
   */
  addToBlackList(cid: string): void;

  /**
   * Checks if a CID is blacklisted.
   * @param cid - The CID to check.
   * @returns `true` if blacklisted; otherwise `false`.
   */
  isBlackListed(cid: string): boolean;

  /**
   * Fetches a profile from IPFS and validates it.
   * @param cid - The IPFS CID of the profile.
   * @param timeoutInMs - The maximum time in milliseconds to wait for the fetch operation.
   * @returns The sanitized profile if successful; otherwise, `undefined`.
   */
  fetchProfileFromOrigin(
    cid: string,
    timeoutInMs: number
  ): Promise<IPFSDataProfile | undefined>;

  /**
   * Returns a cached profile if available, or fetches it from IPFS using the CacheService.
   * @param cid - The IPFS CID of the profile.
   * @param timeoutInMs - The maximum time in milliseconds to wait for the fetch.
   * @returns The sanitized profile if found; otherwise, `undefined`.
   */
  getCachedProfile(
    cid: string,
    timeoutInMs: number
  ): Promise<IPFSDataProfile | undefined>;

  /**
   * Pins a profile to the IPFS node.
   * @param profile - The profile to pin.
   * @returns The IPFS CID of the pinned profile.
   */
  pin(profile: IPFSDataProfile): Promise<string>;

  /**
   * Checks if the storage service is healthy.
   */
  isHealthy(): Promise<boolean>;

  /**
   * Unpins multiple content identifiers from the IPFS node or an S3 bucket.
   * 
   * @param pins - Array of Pin objects containing the CIDs and storage keys to unpin.
   * @returns A promise that resolves to the number of successfully unpinned items.
   */
  unpinAll(pinsToDelete: Pin[]): Promise<number>;

  /**
   * Creates an async generator that streams all pins and metadata from the IPFS node or an S3 bucket.
   * 
   * @param lastCleanUp - UNIX time when the last cleanup procedure finished.
   * @returns An AsyncGenerator that yields Pin objects containing CIDs.
   * @throws Error if the streaming operation fails.
   */
  streamPins(lastCleanUp?: number): AsyncGenerator<Pin>
}
