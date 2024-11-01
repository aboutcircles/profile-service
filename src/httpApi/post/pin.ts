import {Request, Response} from "express";
import {getConfig} from "../../config";
import {ProfileValidator} from "../../profileValidator";

export const pin = (ipfs: any) => async (req: Request, res: Response) => {
    if (req.timedout) return;

    console.log('Received profile for pinning:', req.body);

    const config = getConfig();
    const profileValidator = new ProfileValidator(config)
    const errors = await profileValidator.validate(req.body);
    if (errors.length) {
        return res.status(400).json({errors});
    }

    try {
        const buffer = Buffer.from(JSON.stringify(req.body));
        const result = await ipfs.add(buffer);
        await ipfs.pin.add(result.cid);
        if (req.timedout) return;
        return res.json({cid: result.cid.toString()});
    } catch (error) {
        console.error('Failed to pin file', error);
        if (req.timedout) return;
        return res.status(500).json({error: (error as Error).message});
    }
}