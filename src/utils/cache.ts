import {LRUCache} from "lru-cache";
import {logInfo} from "./logger";
import {IPFSDataProfile} from "../types";

export interface RetrievalHook<T> {
  (key: string, timeoutInMs: number): Promise<T | undefined>;
}

export class CacheService<T> {
  private cache: LRUCache<string, IPFSDataProfile>;
  private retrievalHook: RetrievalHook<IPFSDataProfile>;

  constructor(maxSize: number, retrievalHook: RetrievalHook<IPFSDataProfile>) {
    this.cache = new LRUCache<string, IPFSDataProfile>({ max: maxSize });
    this.retrievalHook = retrievalHook;
  }

  public async get(key: string, timeoutInMs: number): Promise<IPFSDataProfile | undefined> {
    const cachedValue = this.cache.get(key);
    if (cachedValue) {
      logInfo(`Cache hit for key: ${key}`);
      return cachedValue;
    }

    logInfo(`Cache miss for key: ${key}. Retrieving from origin.`);
    const value = await this.retrievalHook(key, timeoutInMs);

    if (value) {
      this.cache.set(key, value);
    }

    return value;
  }

  public set(key: string, value: IPFSDataProfile): void {
    this.cache.set(key, value);
  }

  public delete(key: string): void {
    this.cache.delete(key);
  }
}
