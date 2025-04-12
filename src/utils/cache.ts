import {LRUCache} from "lru-cache";
import {logDebug, logInfo} from "./logger";

export interface RetrievalHook<T> {
    (key: string, timeoutInMs: number): Promise<T | undefined>;
}

export class NotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NotFoundError';
    }
}

export class CacheService<T extends {}> {
    private cache: LRUCache<string, T>;
    private retrievalHook: RetrievalHook<T>;

    constructor(maxSize: number, retrievalHook: RetrievalHook<T>) {
        this.cache = new LRUCache<string, T>({max: maxSize});
        this.retrievalHook = retrievalHook;
    }

    public async tryGet(key: string, timeoutInMs: number): Promise<T | undefined> {
        const cachedValue = this.cache.get(key);
        if (cachedValue) {
            logDebug(`Cache hit for key: ${key}`);
            return cachedValue;
        }

        logInfo(`Cache miss for key: ${key}. Retrieving from origin.`);
        const value = await this.retrievalHook(key, timeoutInMs);
        if (value) {
            this.cache.set(key, value);
            return value;
        }

        return undefined;
    }

    public async get(key: string, timeoutInMs: number): Promise<T> {
        const value = await this.tryGet(key, timeoutInMs);
        if (!value) {
            throw new NotFoundError(`No value found for key: ${key}`);
        }
        return value;
    }

    public set(key: string, value: T): void {
        this.cache.set(key, value);
    }

    public delete(key: string): boolean {
        return this.cache.delete(key);
    }
}
