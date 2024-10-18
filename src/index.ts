import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import sharp from 'sharp';
import timeout from 'connect-timeout';
import {LRUCache} from 'lru-cache';
import {ethers} from "ethers";

import knex from 'knex';
import {AvatarRow, CirclesData, CirclesQuery, CirclesRpc} from "@circles-sdk/data";

export const db = knex({
    client: 'sqlite3',
    connection: {
        filename: './profiles.db'
    },
    useNullAsDefault: true
});

db.schema.hasTable('profiles').then(exists => {
    if (!exists) {
        return db.schema.createTable('profiles', table => {
            table.string('avatar').primary();
            table.string('cid');
            table.string('name');
        }).then(() => {
            // Create full-text index on 'name'
            return db.raw('CREATE VIRTUAL TABLE profiles_fts USING fts5(name, content=\'profiles\', content_rowid=\'rowid\');');
        });
    }
});

const config = {
    ipfs: {
        host: process.env.IPFS_HOST || 'localhost',
        port: process.env.IPFS_PORT || 5001,
        protocol: process.env.IPFS_PROTOCOL || 'http',
    },
    corsOrigin: process.env.CORS_ORIGIN || '*',
    maxImageSizeKB: parseInt(process.env.MAX_IMAGE_SIZE_KB || '150'),
    descriptionLength: parseInt(process.env.DESCRIPTION_LENGTH || '500'),
    imageUrlLength: parseInt(process.env.IMAGE_URL_LENGTH || '2000'),
    imageDimension: parseInt(process.env.IMAGE_DIMENSION || '256'),
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '1') * 1000,
    maxNameLength: parseInt(process.env.MAX_NAME_LENGTH || '36'),
    maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '50'),
    cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || '200'),
    circlesRpcUrl: process.env.CIRCLES_RPC_URL || 'http://localhost:8545',
};

/**
 * Read all v2 avatars and the corresponding CIDs from the circles rpc endpoint.
 */
const initialize = async () => {
    const rpc = new CirclesRpc(config.circlesRpcUrl);
    const data = new CirclesData(rpc);

    const v2AvatarsQuery = new CirclesQuery<AvatarRow>(roc, {
        namespace: "V_CrcV2",
        table: "Avatars",
        columns: ["avatar", "cidV0Digest"],

    })
}

const upsertProfile = async (profile: any) => {
    await db('profiles').insert(profile).onConflict('avatar').merge();

    // Update full-text search table
    await db('profiles_fts').insert({rowid: profile.avatar, name: profile.name}).onConflict('rowid').merge();
};

const getCidByAvatar = async (avatar: string): Promise<string | null> => {
    const result = await db('profiles').where({avatar}).select('cid').first();
    return result ? result.cid : null;
};

import('kubo-rpc-client').then(kudo => {
    const app = express();
    const port = process.env.PINNING_SERVICE_PORT || 3000;

    const maxProfileSize = config.descriptionLength + config.imageUrlLength + config.maxNameLength + config.maxImageSizeKB * 1024;

    const ipfs = kudo.create(config.ipfs);

    // Create LRU cache instance
    const profileCache = new LRUCache<string, any>({max: config.cacheMaxSize});
    const blackList = new LRUCache<string, any>({max: 100000});

    app.use(cors({origin: config.corsOrigin, methods: ['GET', 'POST']}));
    app.use(bodyParser.json({limit: `${maxProfileSize / 1024}kb`}));
    app.use(timeout(`${config.defaultTimeout}ms`));

    const addToBlackList = (cid: string) => {
        console.log(`Adding CID to blacklist: ${cid}`);
        blackList.set(cid, true);
    }

    const isBlackListed = (cid: string) => {
        return blackList.get(cid) !== undefined;
    }

    const haltOnTimedout = (req: Request, res: Response, next: () => void) => {
        if (!req.timedout) next();
    };

    const logError = (description: string, error: any) => {
        console.error(`${description}:`, error);
    };
    const logInfo = (description: string, error: any) => {
        console.info(`${description}:`, error.message);
    };

    const isValidCid = (cid: string | null | undefined): boolean =>
        !(!cid || cid.trim() === '' || cid.length != 46 || !cid.startsWith('Qm') || !/^[a-zA-Z0-9]*$/.test(cid));

    const validateImage = async (dataUrl: string): Promise<boolean> => {
        const dataUrlPattern = /^data:image\/(png|jpeg|jpg|gif);base64,/;
        if (!dataUrlPattern.test(dataUrl)) {
            console.error('Invalid data URL pattern');
            return false;
        }

        const base64Data = dataUrl.replace(dataUrlPattern, '');
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length > config.maxImageSizeKB * 1024) {
            console.error('Image size exceeds limit');
            return false;
        }

        try {
            const image = sharp(buffer);
            const {width, height, format} = await image.metadata();
            return !(width !== config.imageDimension || height !== config.imageDimension || !['png', 'jpeg', 'gif'].includes(format ?? ''));
        } catch (error) {
            logError('Failed to read image metadata', error);
            return false;
        }
    };

    const validateProfile = async (profile: any) => {
        const errors = [];

        if (!profile.avatar || typeof profile.avatar !== 'string' || !ethers.isAddress(profile.avatar)) {
            errors.push('Avatar is required and must be a valid Ethereum address.');
        }

        if (!profile.name || typeof profile.name !== 'string' || profile.name.length > config.maxNameLength) {
            errors.push(`Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`);
        }

        if (profile.description && (typeof profile.description !== 'string' || profile.description.length > config.descriptionLength)) {
            errors.push(`Description must be a string and cannot exceed ${config.descriptionLength} characters.`);
        }

        if (profile.previewImageUrl) {
            const isValidImage = await validateImage(profile.previewImageUrl);
            if (!isValidImage) {
                errors.push(`Invalid preview image data URL, dimensions not ${config.imageDimension}x${config.imageDimension}, or size exceeds ${config.maxImageSizeKB}KB.`);
            }
        }

        if (profile.imageUrl && (typeof profile.imageUrl !== 'string' || profile.imageUrl.length > config.imageUrlLength)) {
            errors.push(`Image URL must be a string and cannot exceed ${config.imageUrlLength} characters.`);
        }

        return errors;
    };

    const fetchProfile = async (cid: string, timeoutInMs: number): Promise<any> => {
        console.log(`Fetching profile for CID: ${cid}`);

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
        const errors = await validateProfile(profile);
        if (errors.length) {
            addToBlackList(cid);
            throw new Error(errors.join(', '));
        }
        return profile;
    };

    const getCachedProfile = async (cid: string, timeoutInMs: number): Promise<any> => {
        const cachedProfile = profileCache.get(cid);
        if (cachedProfile) {
            console.log(`Cache hit for CID: ${cid}`);
            return cachedProfile;
        }

        const profile = await fetchProfile(cid, timeoutInMs);
        profileCache.set(cid, profile);
        return profile;
    };

    app.get('/getBatch', haltOnTimedout, async (req: Request, res: Response) => {
        if (req.timedout) return;

        const {cids} = req.query;
        const cidArray = typeof cids === 'string' ? cids.split(',') : [];

        if (!Array.isArray(cidArray) || cidArray.length === 0) {
            return res.status(400).json({error: 'CIDs are required and must be an array'});
        }

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
                    return getCachedProfile(cid.cid, config.defaultTimeout / 2)
                } else if (!cid.isValid) {
                    return Promise.reject(new Error(`Invalid CID: ${cid.cid}`));
                } else {
                    return Promise.reject(new Error(`The CID ${cid.cid} is blacklisted because it failed validation previously`));
                }
            });
            const profiles = await Promise.all(fetchPromises.map(p => p.catch(e => {
                logInfo('Failed to fetch profile', e);
                return null;
            })));
            if (req.timedout) return;
            return res.json(profiles);
        } catch (error) {
            if (req.timedout) return;
            logError('Failed to fetch profiles in batch', error);
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.get('/get', haltOnTimedout, async (req: Request, res: Response) => {
        if (req.timedout) return;

        if (!isValidCid(<any>req.query.cid)) {
            return res.status(400).json({error: 'CID is required'});
        }
        if (isBlackListed(<any>req.query.cid)) {
            return res.status(400).json({error: 'CID is blacklisted because it failed validation previously'});
        }

        console.log(`Received request for profile with CID: ${req.query.cid}`);

        try {
            const profile = await getCachedProfile(req.query.cid as string, config.defaultTimeout - 30);
            if (req.timedout) return;
            return res.json(profile);
        } catch (error) {
            if (req.timedout) return;
            logError('Failed to retrieve profile', error);
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.post('/pin', haltOnTimedout, async (req: Request, res: Response) => {
        if (req.timedout) return;

        const errors = await validateProfile(req.body);
        if (errors.length) {
            return res.status(400).json({errors});
        }
        const avatar = req.body.avatar;

        try {
            // Unpin old profile if exists
            const oldCid = await getCidByAvatar(avatar);
            if (oldCid) {
                await ipfs.pin.rm(oldCid);

                // Remove from cache
                profileCache.delete(oldCid);
            }

            // Pin new profile
            const buffer = Buffer.from(JSON.stringify(req.body));
            const result = await ipfs.add(buffer);
            await ipfs.pin.add(result.cid);

            // Update SQLite with new CID
            await upsertProfile({
                avatar,
                cid: result.cid.toString(),
                name: req.body.name
            });

            return res.json({cid: result.cid.toString()});
        } catch (error) {
            logError('Failed to pin file', error);
            if (req.timedout) return;
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.get('/health', haltOnTimedout, async (req: Request, res: Response) => {
        if (req.timedout) return;
        console.log('Health check initiated');
        try {
            await ipfs.id();
            if (req.timedout) return;
            return res.json({status: 'ok'});
        } catch (error) {
            logError('Failed to connect to IPFS', error);
            if (req.timedout) return;
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.get('/search', haltOnTimedout, async (req: Request, res: Response) => {
        if (req.timedout) return;

        const query = req.query.q;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({error: 'Search query is required'});
        }

        try {
            // Search using full-text search
            const results = await db('profiles')
                .join('profiles_fts', 'profiles.avatar', '=', 'profiles_fts.rowid')
                .where('profiles_fts', 'match', query)
                .select('profiles.avatar', 'profiles.name', 'profiles.cid');

            return res.json(results);
        } catch (error) {
            logError('Failed to search profiles', error);
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });

    process.on('SIGINT', () => {
        console.log('Shutting down...');
        process.exit(0);
    });
});
