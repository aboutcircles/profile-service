import {Config} from "../config";
import {addToBlackList} from "./cidBlacklist";
import {ProfileValidator} from "../profileValidator";

export const fetchProfile = async (config: Config, ipfs: any, cid: string, timeoutInMs: number): Promise<any> => {
    console.log(`Fetching profile for CID: ${cid}`);

    const maxProfileSize = config.descriptionLength + config.imageUrlLength + config.maxNameLength + config.maxImageSizeKB * 1024;
    const stream: AsyncIterable<Uint8Array> = ipfs.cat(cid, {timeout: timeoutInMs});
    let data = Buffer.alloc(0);

    for await (const chunk of stream) {
        if (data.length + chunk.length > maxProfileSize) {
            addToBlackList(cid);
            throw new Error(`Response size exceeds ${maxProfileSize} byte limit`);
        }
        data = Buffer.concat([data, chunk]);
    }

    let profile;
    try {
        profile = JSON.parse(data.toString('utf-8'));
    } catch (error) {
        addToBlackList(cid);
        throw new Error('Invalid JSON data');
    }

    console.log(`Validating profile fetched profile: ${cid}`);
    const profileValidator = new ProfileValidator(config)
    const errors = await profileValidator.validate(profile);
    if (errors.length) {
        addToBlackList(cid);
        throw new Error(errors.join(', '));
    }
    return profile;
};