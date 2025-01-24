import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import timeout from 'connect-timeout';

import config from './config/config';
import ProfileRepo from './repositories/profileRepo';
import IndexerService from './services/indexerService';
import KuboService from './services/kuboService';
import { errorHandler } from './utils/errorHandler';
import { logError, logInfo } from './utils/logger';
import { sanitizeSearchParams } from './utils/sanitizer';

import('kubo-rpc-client').then(kubo => {
    const app = express();

    app.use(cors({origin: config.corsOrigin, methods: ['GET', 'POST']}));
    app.use(bodyParser.json({limit: `${config.maxProfileSize / 1024}kb`}));
    app.use(timeout(`${config.defaultTimeout}ms`));

    app.use(errorHandler);

    (async () => {
        await IndexerService.initialize();
    })();

    const haltOnTimedout = (req: Request, res: Response, next: () => void) => {
        if (!req.timedout) next();
    };

    const isValidCid = (cid: string | null | undefined): boolean =>
        !(!cid || cid.trim() === '' || cid.length != 46 || !cid.startsWith('Qm') || !/^[a-zA-Z0-9]*$/.test(cid));

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
                isBlackListed: KuboService.isBlackListed(o)
            }
        });

        try {
            const fetchPromises = validCidArray.map(cid => {
                if (cid.isValid && !cid.isBlackListed) {
                    return KuboService.getCachedProfile(cid.cid, config.defaultTimeout / 2)
                } else if(!cid.isValid) {
                    return Promise.reject(new Error(`Invalid CID: ${cid.cid}`));
                } else {
                    return Promise.reject(new Error(`The CID ${cid.cid} is blacklisted because it failed validation previously`));
                }
            });
            const profiles = await Promise.all(fetchPromises.map(p => p.catch(e => {
                logError('Failed to fetch profile', e);
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
        if (KuboService.isBlackListed(<any>req.query.cid)) {
            return res.status(400).json({error: 'CID is blacklisted because it failed validation previously'});
        }

        logInfo(`Received request for profile with CID: ${req.query.cid}`);

        try {
            const profile = await KuboService.getCachedProfile(req.query.cid as string, config.defaultTimeout - 30);
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

        logInfo('Received profile for pinning:', req.body);

        const validation = await KuboService.validateProfile(req.body);
        if (validation.errors.length) {
            return res.status(400).json({errors: validation.errors});
        }

        try {
            const buffer = Buffer.from(JSON.stringify(validation.sanitizedProfile));
            const result = await KuboService.ipfs.add(buffer);
            await KuboService.ipfs.pin.add(result.cid);
            if (req.timedout) return;
            return res.json({cid: result.cid.toString()});
        } catch (error) {
            logError('Failed to pin file', error);
            if (req.timedout) return;
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.get('/health', haltOnTimedout, async (req: Request, res: Response) => {
        if (req.timedout) return;
        logInfo('Health check initiated');
        try {
            await KuboService.ipfs.id();
            if (req.timedout) return;
            return res.json({status: 'ok'});
        } catch (error) {
            logError('Failed to connect to IPFS', error);
            if (req.timedout) return;
            return res.status(500).json({error: (error as Error).message});
        }
    });

    app.get('/search', (req, res) => {
        try {
            const { name, description, address, CID } = req.query;

            if (!name && !description && !address && !CID) {
                return res.status(400).json({ error: 'At least one search parameter is required' });
            }

            const sanitizedParams = sanitizeSearchParams({
                name,
                description,
                address,
                CID
            });

            const results = ProfileRepo.searchProfiles(sanitizedParams);

            const sanitizedResults = results.map(result => ({
                name: result.name,
                description: result.description,
                address: result.address,
                CID: result.CID,
                lastUpdatedAt: result.lastUpdatedAt
            }));

            res.json(sanitizedResults);
        } catch (error) {
            logError('Error searching profiles:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.listen(config.port, () => {
        logInfo(`Server is running at http://localhost:${config.port}`);
    });

    process.on('SIGINT', () => {
        logInfo('Shutting down...');
        process.exit(0);
    });
});
