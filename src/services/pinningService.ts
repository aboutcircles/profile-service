import FormData from 'form-data';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';
import {logError, logInfo} from '../utils/logger';
import {LRUCache} from 'lru-cache';
import {SanitizedProfile} from '../utils/sanitizer';
import config from '../config/config';
import {CacheService} from '../utils/cache';
import {PersistenceService} from './persistenceService';
import {ProfileValidator} from './profileValidator';

interface FilebasePinResponse {
  cid: string;
  name: string;
}

export class PinningService implements PersistenceService {
  profileCache: CacheService<SanitizedProfile>;
  blackList = new LRUCache<string, any>({max: 100000});

  constructor() {
    logInfo('Constructing FilebaseGatewayPersistenceService');

    this.profileCache = new CacheService<SanitizedProfile>(
      config.cacheMaxSize,
      this.fetchProfileFromOrigin.bind(this)
    );

    this.initialize();
  }

  isHealthy(): Promise<boolean> {
    // implement your own health check if needed
    throw new Error('Method not implemented.');
  }

  async pin(profile: SanitizedProfile): Promise<string> {
    try {
      // Use the 'form-data' library for Node environments
      const formData = new FormData();

      // Create a buffer from your JSON
      const jsonBuffer = Buffer.from(JSON.stringify(profile), 'utf-8');
      const fileName = `${uuidv4()}.json`;

      // Append to form data (specify filename & content type)
      formData.append('file', jsonBuffer, {
        filename: fileName,
        contentType: 'application/json',
      });

      // Post using Axios
      const response = await axios.post<FilebasePinResponse>(
        'https://api.filebase.com/v1/ipfs/pin',
        formData,
        {
          headers: {
            Authorization: `Bearer ${config.pinningApiKey}:${config.pinningApiSecret}`,
            ...formData.getHeaders(),
          },
        }
      );

      if (response.status !== 200) {
        throw new Error(
          `Filebase API returned an error: ${response.status} ${response.statusText} - ${JSON.stringify(
            response.data
          )}`
        );
      }

      return response.data.cid;
    } catch (error) {
      logError('Error pinning JSON to Filebase:', error);
      throw error;
    }
  }

  initialize = async () => {
    logInfo('Initializing FilebaseGatewayPersistenceService');
  };

  addToBlackList = (cid: string) => {
    logInfo(`Adding CID to blacklist: ${cid}`);
    this.blackList.set(cid, true);
  };

  isBlackListed = (cid: string) => {
    return this.blackList.get(cid) !== undefined;
  };

  fetchProfileFromOrigin = async (
    cid: string,
    timeoutInMs: number
  ): Promise<SanitizedProfile | undefined> => {
    logInfo(`Fetching profile for CID: ${cid} from IPFS gateway.`);

    if (this.isBlackListed(cid)) {
      throw new Error(
        `The CID ${cid} is blacklisted because it failed validation previously`
      );
    }

    const gatewayUrl = `${config.ipfsGateway}/${cid}`;

    let data: Uint8Array;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutInMs);

      const response = await fetch(gatewayUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Gateway returned status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      data = new Uint8Array(arrayBuffer);

      if (data.byteLength > config.maxProfileSize) {
        this.addToBlackList(cid);
        throw new Error(
          `Response size exceeds ${config.maxProfileSize} byte limit`
        );
      }
    } catch (error) {
      logError('Failed to fetch profile from IPFS gateway', error);
      throw new Error('Failed to fetch profile from IPFS gateway');
    }

    let profile: any;
    try {
      profile = JSON.parse(Buffer.from(data).toString('utf-8'));
    } catch (error) {
      this.addToBlackList(cid);
      throw new Error('Invalid JSON data');
    }

    const validation = await ProfileValidator.validateProfile(profile);
    if (validation.errors.length) {
      this.addToBlackList(cid);
      throw new Error(validation.errors.join(', '));
    }

    return validation.sanitizedProfile;
  };

  getCachedProfile = async (
    cid: string,
    timeoutInMs: number
  ): Promise<SanitizedProfile | undefined> => {
    return this.profileCache.get(cid, timeoutInMs);
  };

  pinCid = async (cid: string): Promise<void> => {
    logInfo(`Pinning CID: ${cid} via pinning service`);

    try {
      const response = await fetch(config.pinningApiUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.pinningApiKey}:${config.pinningApiSecret}`,
        },
        body: JSON.stringify({cid}),
      });
      if (!response.ok) {
        throw new Error(`Failed to pin: ${await response.text()}`);
      }
    } catch (err) {
      logError('Failed to pin via pinning service', err);
      throw err;
    }
  };
}
