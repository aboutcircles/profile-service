import {Request, Response} from "express";
import {getConfig} from "../../config";
import {isValidCid} from "../isValidCid";
import {isBlackListed} from "../cidBlacklist";
import {getCachedProfile} from "../getCachedProfile";

export const get = () => async (req: Request, res: Response) => {
    if (req.timedout) return;

    if (!isValidCid(<any>req.query.cid)) {
        return res.status(400).json({error: 'CID is required'});
    }
    if (isBlackListed(<any>req.query.cid)) {
        return res.status(400).json({error: 'CID is blacklisted because it failed validation previously'});
    }

    console.log(`Received request for profile with CID: ${req.query.cid}`);

    const config = getConfig();
    const kubo = await import("kubo-rpc-client");
    const ipfs = kubo.create(config.ipfs);
    try {
        const profile = await getCachedProfile(config, ipfs, req.query.cid as string, config.defaultTimeout - 30);
        if (req.timedout) return;
        return res.json(profile);
    } catch (error) {
        if (req.timedout) return;
        console.error('Failed to retrieve profile', error);
        return res.status(500).json({error: (error as Error).message});
    }
}