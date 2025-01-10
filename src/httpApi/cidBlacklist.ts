import {LRUCache} from "lru-cache";

const blackList = new LRUCache<string, any>({max: 100000});

export const addToBlackList = (cid: string) => {
    console.log(`Adding CID to blacklist: ${cid}`);
    blackList.set(cid, true);
}

export const isBlackListed = (cid: string) => {
    return blackList.get(cid) !== undefined;
}