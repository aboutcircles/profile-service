import {CacheService} from "../utils/cache";
import {LRUCache} from "lru-cache";
import {SanitizedProfile} from "../utils/sanitizer";

export interface PersistenceService {
  /**
   * In-memory cache service for SanitizedProfile objects.
   */
  profileCache: CacheService<SanitizedProfile>;

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
  ): Promise<SanitizedProfile | undefined>;

  /**
   * Returns a cached profile if available, or fetches it from IPFS using the CacheService.
   * @param cid - The IPFS CID of the profile.
   * @param timeoutInMs - The maximum time in milliseconds to wait for the fetch.
   * @returns The sanitized profile if found; otherwise, `undefined`.
   */
  getCachedProfile(
    cid: string,
    timeoutInMs: number
  ): Promise<SanitizedProfile | undefined>;

  /**
   * Pins a profile to the IPFS node.
   * @param profile - The profile to pin.
   * @returns The IPFS CID of the pinned profile.
   */
  pin(profile: SanitizedProfile): Promise<string>;

  /**
   * Checks if the storage service is healthy.
   */
  isHealthy(): Promise<boolean>;
}