import {LRUCache} from "lru-cache";
import {logError, logInfo} from "./logger";
import {IPFSDataProfile} from "../types";

export interface RetrievalHook<T> {
    (key: string, timeoutInMs: number): Promise<T | undefined>;
}

export class CacheService<T> {
    private cache: LRUCache<string, IPFSDataProfile>;
    private retrievalHook: RetrievalHook<IPFSDataProfile>;

    constructor(maxSize: number, retrievalHook: RetrievalHook<IPFSDataProfile>) {
        this.cache = new LRUCache<string, IPFSDataProfile>({max: maxSize});
        this.retrievalHook = retrievalHook;
    }

    public async get(key: string, timeoutInMs: number): Promise<IPFSDataProfile | undefined> {
        const cachedValue = this.cache.get(key);
        if (cachedValue) {
            logInfo(`Cache hit for key: ${key}`);
            return cachedValue;
        }

        logInfo(`Cache miss for key: ${key}. Retrieving from origin.`);
        try {
            const value = await this.retrievalHook(key, timeoutInMs);
            if (value) {
                this.cache.set(key, value);
            }
            return value;
        } catch (e) {
            logError(`Error retrieving profile from origin for key: ${key}`, e)
            return undefined;
        }
    }

    public set(key: string, value: IPFSDataProfile): void {
        this.cache.set(key, value);
    }

    public delete(key: string): boolean {
        return this.cache.delete(key);
    }
}
