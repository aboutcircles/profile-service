import {Request, Response} from "express";
import {getConfig} from "../../config";
import {ProfileValidator} from "../../profileValidator";

export const pin = () => async (req: Request, res: Response) => {
    if (req.timedout) {
        return;
    }

    console.log('Received profile for pinning:', req.body);

    const config = getConfig();

    const profileValidator = new ProfileValidator(config)
    const errors = await profileValidator.validate(req.body);
    if (errors.length) {
        console.error(`Could not pin profile due to validation errors: ${errors.join(', ')}`);
        return res.status(400).json({errors});
    }

    const kubo = await import("kubo-rpc-client");
    const ipfs = kubo.create(config.ipfs);

    try {
        const buffer = Buffer.from(JSON.stringify(req.body));
        const result = await ipfs.add(buffer);
        console.log(`Added profile to IPFS with CID: ${result.cid}. Pinning...`);

        await ipfs.pin.add(result.cid);
        console.log(`Profile pinned successfully. CID: ${result.cid}`);

        if (req.timedout) {
            console.log('Request timed out while pinning profile');
            return;
        }

        return res.json({cid: result.cid.toString()});
    } catch (error) {
        console.error('Failed to pin file', error);
        if (req.timedout) return;
        return res.status(500).json({error: (error as Error).message});
    }
}