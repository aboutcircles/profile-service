import {Request, Response} from "express";
import {getConfig} from "../../config";

export const health = () => async (req: Request, res: Response) => {
    if (req.timedout) {
        return;
    }
    console.log('Health check initiated');

    const config = getConfig();
    const kubo = await import("kubo-rpc-client");
    const ipfs = kubo.create(config.ipfs);
    
    try {
        await ipfs.id();
        if (req.timedout) return;
        return res.json({status: 'ok'});
    } catch (error) {
        console.error('Failed to connect to IPFS', error);
        if (req.timedout) return;
        return res.status(500).json({error: `Failed to connect to IPFS: ${(error as Error).message}`});
    }
}