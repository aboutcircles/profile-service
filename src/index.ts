import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import config from './config/config';
import {ProfileRepository} from './repositories/profileRepo';
import {IndexerService} from './services/indexerService';
import {errorHandler} from './utils/errorHandler';
import {logError, logInfo, logWarn} from './utils/logger';
import {sanitizeSearchParams} from './utils/sanitizer';
import {PinningService} from "./services/pinningService";
import {ProfileValidator} from "./services/profileValidator";
import {Profile, IPFSDataProfile, CompleteProfile} from './types';
import {GatewayError} from "./services/fetchFromOriginErrors";

const app = express();

app.use(cors({origin: config.corsOrigin, methods: ['GET', 'POST']}));
app.use(bodyParser.json({limit: `${config.maxProfileSize / 1024}kb`}));

app.use(errorHandler);

const persistenceService: PinningService = new PinningService();
let profileRepo: ProfileRepository = new ProfileRepository();
let indexerService = new IndexerService(persistenceService, profileRepo);

(async () => {
    await indexerService.initialize();
})();

const isValidCid = (cid: string | null | undefined): boolean =>
    !(!cid || cid.trim() === '' || cid.length != 46 || !cid.startsWith('Qm') || !/^[a-zA-Z0-9]*$/.test(cid));

/**
 * Fetches complete profiles from IPFS for the given database profiles.
 * @param profiles - The database profiles to fetch complete data for.
 * @param persistenceService - The service to use for fetching from IPFS.
 * @param timeoutInMs - The timeout for each fetch operation.
 * @returns An array of profiles with IPFS data merged in where available.
 */
async function fetchCompleteProfiles(
    profiles: Profile[],
    persistenceService: PinningService,
    timeoutInMs: number
): Promise<Array<CompleteProfile>> {
    if (!profiles.length) return [];

    const fetchPromises = profiles.map(profile => {
        if (isValidCid(profile.CID) && !persistenceService.isBlackListed(profile.CID)) {
            return persistenceService.getCachedProfile(profile.CID, timeoutInMs)
                .then(ipfsProfile => {
                    if (ipfsProfile) {
                        // Merge database profile with IPFS profile
                        return {
                            ...profile,
                            ...ipfsProfile
                        };
                    }
                    return profile;
                })
                .catch(() => profile); // Return original profile on error
        }
        return Promise.resolve(profile);
    });

    return Promise.all(fetchPromises);
}

app.get('/getBatch', async (req: Request, res: Response) => {
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
            isBlackListed: persistenceService.isBlackListed(o)
        }
    });

    try {
        const fetchPromises = validCidArray
            .map(cid => {
                if (cid.isValid && !cid.isBlackListed) {
                    return persistenceService.getCachedProfile(cid.cid, config.defaultTimeout)
                } else if (!cid.isValid) {
                    return Promise.reject(new Error(`Invalid CID: ${cid.cid}`));
                } else {
                    return Promise.reject(new Error(`The CID ${cid.cid} is blacklisted because it failed validation previously`));
                }
            }).map(p =>
                p.catch((e: Error) => {
                    logWarn('Failed to fetch profile:', e.message);
                    return null;
                })
            );

        const profiles: (IPFSDataProfile | null | undefined)[] = await Promise.all(fetchPromises);
        if (req.timedout) return;
        return res.json(profiles);
    } catch (error) {
        if (req.timedout) return;
        logError('Failed to fetch profiles in batch', error);
        return res.status(500).json({error: (error as Error).message});
    }
});

app.get('/get', async (req: Request, res: Response) => {
    if (req.timedout) return;

    if (!isValidCid(<any>req.query.cid)) {
        return res.status(400).json({error: 'CID is required'});
    }
    if (persistenceService.isBlackListed(<any>req.query.cid)) {
        return res.status(400).json({error: 'CID is blacklisted because it failed validation previously'});
    }

    logInfo(`Received request for profile with CID: ${req.query.cid}`);

    try {
        const profile: IPFSDataProfile | null | undefined = await persistenceService.getCachedProfile(req.query.cid as string, config.defaultTimeout);
        if (req.timedout) return;
        return res.json(profile);
    } catch (error) {
        if (error instanceof GatewayError && error.statusCode === 404) {
            return res.status(404).json({error: 'Profile not found'});
        }

        if (req.timedout) return;
        logError('Failed to retrieve profile', error);
        return res.status(500).json({error: (error as Error).message});
    }
});

app.post('/pin', async (req: Request, res: Response) => {
    if (req.timedout) return;

    logInfo('Received profile for pinning:', req.body);

    const validation = await ProfileValidator.validateProfile(req.body);
    if (validation.errors.length) {
        return res.status(400).json({errors: validation.errors});
    }

    try {
        if (!validation.sanitizedProfile) {
            throw new Error('Failed to sanitize profile');
        }

        const cid = await persistenceService.pin(validation.sanitizedProfile);
        logInfo('JSON pinned to IPFS with CID:', cid);
        if (req.timedout) return;
        return res.json({cid: cid});
    } catch (error) {
        logError('Failed to pin JSON:', error);
        return res.status(500).json({error: (error as Error).message});
    }
});

app.get('/health', async (req: Request, res: Response) => {
    if (req.timedout) return;
    logInfo('Health check initiated');
    try {
        await persistenceService.isHealthy();
        if (req.timedout) return;
        return res.json({status: 'ok'});
    } catch (error) {
        logError('Failed to connect to IPFS', error);
        if (req.timedout) return;
        return res.status(500).json({error: (error as Error).message});
    }
});

app.post('/search/addresses', (req, res) => {
    try {
        const {addresses = [], fetchComplete} = req.body;

        if (!Array.isArray(addresses) || addresses.length === 0) {
            return res.status(400).json({error: 'Addresses array is required and cannot be empty'});
        }

        if (addresses.length > config.maxAddressesSearchSize) {
            return res.status(400).json({
                error: `Maximum number of addresses exceeded. Limit is ${config.maxAddressesSearchSize}`
            });
        }

        const sanitizeResult = sanitizeSearchParams({
            addresses: addresses.join(','),  // Convert array to string for sanitization
            fetchComplete: fetchComplete ? 'true' : 'false'
        });

        if (!sanitizeResult.isValid || !sanitizeResult.sanitized) {
            return res.status(400).json({
                error: 'Invalid addresses format',
                details: sanitizeResult.errors
            });
        }

        // Split back into array after sanitization
        const sanitizedAddresses = sanitizeResult.sanitized.addresses?.split(',') || [];

        const results = profileRepo?.searchProfilesByAddresses(sanitizedAddresses);

        if (!results) {
            return res.status(500).json({error: 'Internal Server Error'});
        }

        // If fetchComplete is true, fetch complete profiles from IPFS
        if (sanitizeResult.sanitized.fetchComplete === 'true') {
            fetchCompleteProfiles(results, persistenceService, config.defaultTimeout)
                .then(completeResults => {
                    const sanitizedResults = completeResults.map((result: CompleteProfile) => ({
                        name: result.name,
                        description: result.description,
                        address: result.address,
                        CID: result.CID,
                        lastUpdatedAt: result.lastUpdatedAt,
                        registeredName: result.registeredName,
                        imageUrl: result.imageUrl,
                        previewImageUrl: result.previewImageUrl,
                        location: result.location,
                        geoLocation: result.geoLocation
                    }));

                    res.json({results: sanitizedResults});
                })
                .catch(error => {
                    logError('Error fetching complete profiles:', error);
                    res.status(500).json({error: 'Error fetching complete profiles'});
                });
        } else {
            // Original behavior - return only database profiles
            const sanitizedResults = results.map((result: Profile) => ({
                name: result.name,
                description: result.description,
                address: result.address,
                CID: result.CID,
                lastUpdatedAt: result.lastUpdatedAt,
                registeredName: result.registeredName,
                location: result.location,
                geoLocation: result.geoLocation
            }));

            res.json({results: sanitizedResults});
        }
    } catch (error) {
        logError('Error searching profiles by addresses:', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

app.get('/search', (req, res) => {
    try {
        const {name, description, address, CID, registeredName, location, fetchComplete} = req.query;

        if (!name && !description && !address && !CID && !registeredName && !location) {
            return res.status(400).json({error: 'At least one search parameter is required'});
        }

        const sanitizeResult = sanitizeSearchParams({
            name,
            description,
            address,
            CID,
            registeredName,
            location,
            fetchComplete
        });

        if (!sanitizeResult.isValid || !sanitizeResult.sanitized) {
            return res.status(400).json({
                error: 'Invalid search parameters',
                details: sanitizeResult.errors
            });
        }

        const results = profileRepo?.searchProfiles({
            name: sanitizeResult.sanitized.name,
            description: sanitizeResult.sanitized.description,
            address: sanitizeResult.sanitized.address,
            CID: sanitizeResult.sanitized.CID,
            registeredName: sanitizeResult.sanitized.registeredName,
            location: sanitizeResult.sanitized.location
        });

        if (!results) {
            return res.status(500).json({error: 'Internal Server Error'});
        }

        // If fetchComplete is true, fetch complete profiles from IPFS
        if (sanitizeResult.sanitized.fetchComplete === 'true') {
            fetchCompleteProfiles(results, persistenceService, config.defaultTimeout)
                .then(completeResults => {
                    const sanitizedResults = completeResults.map(result => ({
                        name: result.name,
                        description: result.description,
                        address: result.address,
                        CID: result.CID,
                        lastUpdatedAt: result.lastUpdatedAt,
                        registeredName: result.registeredName,
                        imageUrl: result.imageUrl,
                        previewImageUrl: result.previewImageUrl,
                        location: result.location,
                        geoLocation: result.geoLocation
                    }));

                    res.json(sanitizedResults);
                })
                .catch(error => {
                    logError('Error fetching complete profiles:', error);
                    res.status(500).json({error: 'Error fetching complete profiles'});
                });
        } else {
            // Original behavior - return only database profiles
            const sanitizedResults = results.map(result => ({
                name: result.name,
                description: result.description,
                address: result.address,
                CID: result.CID,
                lastUpdatedAt: result.lastUpdatedAt,
                registeredName: result.registeredName,
                location: result.location,
                geoLocation: result.geoLocation
            }));

            res.json(sanitizedResults);
        }
    } catch (error) {
        logError('Error searching profiles:', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

app.listen(config.port, () => {
    logInfo(`Server is running at http://localhost:${config.port}`);
});

process.on('SIGINT', () => {
    logInfo('Shutting down...');
    process.exit(0);
});
