import {Request, Response} from "express";
import {isValidCid} from "../isValidCid";
import {isBlackListed} from "../cidBlacklist";
import {getCachedProfile} from "../getCachedProfile";
import {getConfig} from "../../config";

export const getBatch = (ipfs: any) => async (req: Request, res: Response) => {
    if (req.timedout) return;

    const {cids} = req.query;
    const cidArray = typeof cids === 'string' ? cids.split(',') : [];

    if (!Array.isArray(cidArray) || cidArray.length === 0) {
        return res.status(400).json({error: 'CIDs are required and must be an array'});
    }

    const config = getConfig();
    if (cidArray.length > config.maxBatchSize) {
        return res.status(400).json({error: `Maximum batch size is ${config.maxBatchSize}`});
    }

    const validCidArray = cidArray.map(o => {
        return {
            cid: o,
            isValid: isValidCid(o),
            isBlackListed: isBlackListed(o)
        }
    });

    try {
        const fetchPromises = validCidArray.map(cid => {
            if (cid.isValid && !cid.isBlackListed) {
                return getCachedProfile(config, ipfs, cid.cid, config.defaultTimeout / 2)
            } else if (!cid.isValid) {
                return Promise.reject(new Error(`Invalid CID: ${cid.cid}`));
            } else {
                return Promise.reject(new Error(`The CID ${cid.cid} is blacklisted because it failed validation previously`));
            }
        });
        const profiles = await Promise.all(fetchPromises.map(p => p.catch(e => {
            console.warn('Failed to fetch profile', e);
            return null;
        })));
        if (req.timedout) return;
        return res.json(profiles);
    } catch (error) {
        if (req.timedout) return;
        console.error('Failed to fetch profiles in batch', error);
        return res.status(500).json({error: (error as Error).message});
    }
}