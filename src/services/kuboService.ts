import sharp from 'sharp';
import {LRUCache} from 'lru-cache';
import { logError, logInfo } from '../utils/logger';
import { sanitizeProfile, SanitizedProfile } from '../utils/sanitizer';
import config from '../config/config';

class KuboService {
  ipfs: any;
  profileCache = new LRUCache<string, any>({max: config.cacheMaxSize});
  blackList = new LRUCache<string, any>({max: 100000});

  constructor() {
    logInfo('constructing KuboService');

    this.initialize();
  }

  initialize = async () => {
    logInfo('Initializing KuboService');
    const kubo = await import('kubo-rpc-client');

    this.ipfs = kubo.create(config.ipfs);
  }

  addToBlackList = (cid: string) => {
    logInfo(`Adding CID to blacklist: ${cid}`);
    this.blackList.set(cid, true);
  }

  isBlackListed = (cid: string) => {
    return this.blackList.get(cid) !== undefined;
  }

  validateImage = async (dataUrl: string): Promise<boolean> => {
    const dataUrlPattern = /^data:image\/(png|jpeg|jpg|gif);base64,/;
    if (!dataUrlPattern.test(dataUrl)) {
      logError('Invalid data URL pattern');
      return false;
    }

    const base64Data = dataUrl.replace(dataUrlPattern, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > config.maxImageSizeKB * 1024) {
      logError('Image size exceeds limit');
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

  validateProfile = async (profile: any): Promise<{ errors: string[]; sanitizedProfile?: SanitizedProfile }> => {
    const sanitizeResult = sanitizeProfile(profile);
    if (!sanitizeResult.isValid || !sanitizeResult.sanitized) {
      return {
        errors: sanitizeResult.errors
      };
    }

    const errors: string[] = [];
    const sanitizedProfile = sanitizeResult.sanitized;

    if (!sanitizedProfile.name || sanitizedProfile.name.length > config.maxNameLength) {
      errors.push(`Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`);
    }

    if (sanitizedProfile.description && sanitizedProfile.description.length > config.descriptionLength) {
      errors.push(`Description must be a string and cannot exceed ${config.descriptionLength} characters.`);
    }

    if (sanitizedProfile.previewImageUrl) {
      const isValidImage = await this.validateImage(sanitizedProfile.previewImageUrl);
      if (!isValidImage) {
        errors.push(`Invalid preview image data URL, dimensions not ${config.imageDimension}x${config.imageDimension}, or size exceeds ${config.maxImageSizeKB}KB.`);
      }
    }

    if (sanitizedProfile.imageUrl) {
      if (sanitizedProfile.imageUrl.length > config.imageUrlLength) {
        errors.push(`Image URL must be a string and cannot exceed ${config.imageUrlLength} characters.`);
      }

      try {
        const url = new URL(sanitizedProfile.imageUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push('Image URL must use HTTP or HTTPS protocol');
        }
      } catch {
        errors.push('Invalid image URL format');
      }
    }

    return {
      errors,
      sanitizedProfile: errors.length === 0 ? sanitizedProfile : undefined
    };
  };

  fetchProfile = async (cid: string, timeoutInMs: number): Promise<any> => {
    logInfo(`Fetching profile for CID: ${cid}`);

    if (this.isBlackListed(cid)) {
      throw new Error(`The CID ${cid} is blacklisted because it failed validation previously`);
    }

    let data = Buffer.alloc(0);
    try {
      const stream: AsyncIterable<Uint8Array> = this.ipfs.cat(cid, {timeout: timeoutInMs});

      for await (const chunk of stream) {
        if (data.length + chunk.length > config.maxProfileSize) {
          this.addToBlackList(cid);
          throw new Error(`Response size exceeds ${config.maxProfileSize} byte limit`);
        }
        data = Buffer.concat([data, chunk]);
      }
    } catch (error) {
      logError('Failed to fetch profile', error);
      throw new Error('Failed to fetch profile');
    }

    let profile;
    try {
      profile = JSON.parse(data.toString('utf-8'));
    } catch (error) {
      this.addToBlackList(cid);
      throw new Error('Invalid JSON data');
    }

    const validation = await this.validateProfile(profile);
    if (validation.errors.length) {
      this.addToBlackList(cid);
      throw new Error(validation.errors.join(', '));
    }
    return validation.sanitizedProfile;
  };

  getCachedProfile = async (cid: string, timeoutInMs: number): Promise<any> => {
    const cachedProfile = this.profileCache.get(cid);
    if (cachedProfile) {
      logInfo(`Cache hit for CID: ${cid}`);
      return cachedProfile;
    }

    const profile = await this.fetchProfile(cid, timeoutInMs);
    this.profileCache.set(cid, profile);
    return profile;
  };
}

export default new KuboService();
