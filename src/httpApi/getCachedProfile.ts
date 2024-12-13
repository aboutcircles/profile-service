import {LRUCache} from "lru-cache";
import {fetchProfile} from "./fetchProfile";
import {Config} from "../config";

let profileCache: LRUCache<string, any> | undefined;

export const getCachedProfile = async (config: Config, ipfs: any, cid: string, timeoutInMs: number): Promise<any> => {
    if (!profileCache) {
        profileCache = new LRUCache<string, any>({max: config.cacheMaxSize});
    }
    const cachedProfile = profileCache.get(cid);
    if (cachedProfile) {
        console.log(`Cache hit for CID: ${cid}`);
        return cachedProfile;
    }

    const profile = await fetchProfile(config, ipfs, cid, timeoutInMs);
    profileCache.set(cid, profile);
    return profile;
};