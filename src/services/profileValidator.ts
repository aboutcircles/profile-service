import config from '../config/config';
import {logError} from '../utils/logger';
import sharp from "sharp";
import {SanitizedProfile, sanitizeProfile} from "../utils/sanitizer";

export class ProfileValidator {
  /**
   * Validates a base64-encoded image (dimensions, size, format).
   * @param dataUrl - The data URL of the image to validate.
   * @returns `true` if valid; otherwise `false`.
   */
  static async validateImage(dataUrl: string): Promise<boolean> {
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
      const { width, height, format } = await image.metadata();
      return !(
        width !== config.imageDimension ||
        height !== config.imageDimension ||
        !['png', 'jpeg', 'gif'].includes(format ?? '')
      );
    } catch (error) {
      logError('Failed to read image metadata', error);
      return false;
    }
  }

  /**
   * Validates a profile object and returns sanitized data if valid.
   * @param profile - The raw profile object to validate.
   * @returns An object containing any validation errors,
   *          and the sanitized profile if no errors occurred.
   */
  static async validateProfile(profile: any): Promise<{
    errors: string[];
    sanitizedProfile?: SanitizedProfile;
  }> {
    const sanitizeResult = sanitizeProfile(profile);
    if (!sanitizeResult.isValid || !sanitizeResult.sanitized) {
      return {
        errors: sanitizeResult.errors
      };
    }

    const errors: string[] = [];
    const sanitizedProfile = sanitizeResult.sanitized;

    // Name validation
    if (
      !sanitizedProfile.name ||
      sanitizedProfile.name.length > config.maxNameLength
    ) {
      errors.push(
        `Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`
      );
    }

    // Description validation
    if (
      sanitizedProfile.description &&
      sanitizedProfile.description.length > config.descriptionLength
    ) {
      errors.push(
        `Description must be a string and cannot exceed ${config.descriptionLength} characters.`
      );
    }

    // Preview image URL validation
    if (sanitizedProfile.previewImageUrl) {
      const isValidImage = await ProfileValidator.validateImage(
        sanitizedProfile.previewImageUrl
      );
      if (!isValidImage) {
        errors.push(
          `Invalid preview image data URL, dimensions not ${config.imageDimension}x${config.imageDimension}, or size exceeds ${config.maxImageSizeKB}KB.`
        );
      }
    }

    // Main image URL validation
    if (sanitizedProfile.imageUrl) {
      if (sanitizedProfile.imageUrl.length > config.imageUrlLength) {
        errors.push(
          `Image URL must be a string and cannot exceed ${config.imageUrlLength} characters.`
        );
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
  }
}