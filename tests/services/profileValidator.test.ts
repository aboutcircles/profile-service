import { ProfileValidator } from '../../src/services/profileValidator';
import { IPFSDataProfile, Profile, CompleteProfile } from '../../src/types';
import sharp from 'sharp';
import config from '../../src/config/config';
import { logError } from '../../src/utils/logger';

// Mock dependencies
jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => {
    return {
      metadata: jest.fn().mockResolvedValue({
        width: 200,
        height: 200,
        format: 'png'
      })
    };
  });
});

jest.mock('../../src/utils/logger', () => ({
  logError: jest.fn()
}));

jest.mock('../../src/config/config', () => ({
  maxNameLength: 50,
  descriptionLength: 500,
  imageDimension: 200,
  maxImageSizeKB: 150,
  imageUrlLength: 500
}));

// Mock the sanitizeProfile function
jest.mock('../../src/utils/sanitizer', () => ({
  sanitizeProfile: jest.fn((input) => {
    // Basic mock implementation for testing the validator
    // If the test explicitly needs sanitization to fail, we handle that below
    let isValid = true;
    const errors: string[] = [];
    
    // Check if this is a test case that should fail validation
    if (typeof input.location === 'number') {
      isValid = false;
      errors.push('Location must be a string and cannot exceed 100 characters.');
    } else if (input.location && typeof input.location === 'string' && input.location.length > 100) {
      isValid = false;
      errors.push('Location must be a string and cannot exceed 100 characters.');
    } else if (input.location && typeof input.location === 'string' && input.location.includes('<script>')) {
      isValid = false;
      errors.push('Invalid location: Input contains potentially dangerous content');
    }
    
    // For other test cases, create valid sanitized data
    const sanitized: any = {
      name: input.name || '',
      description: input.description,
      imageUrl: input.imageUrl,
      previewImageUrl: input.previewImageUrl,
    };

    // Add location if it exists in the input (and test isn't meant to fail)
    if (input.location !== undefined && isValid) {
      sanitized.location = input.location;
    }

    return {
      isValid,
      errors,
      sanitized: isValid ? sanitized : undefined
    };
  })
}));

describe('ProfileValidator', () => {
  describe('validateProfile', () => {
    it('should pass validation for a valid profile with location', async () => {
      const validProfile = {
        name: 'Valid Profile',
        description: 'This is a valid profile',
        location: 'Berlin'
      };
      const validationResult = await ProfileValidator.validateProfile(validProfile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
      expect(validationResult.sanitizedProfile?.location).toEqual('Berlin'); // Assert location is in sanitizedProfile
    });

    it('should pass validation for a valid profile without location', async () => {
      const validProfile = {
        name: 'Valid Profile',
        description: 'This is a valid profile',
      };
      const validationResult = await ProfileValidator.validateProfile(validProfile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
    });

    it('should fail validation if location is too long', async () => {
      const invalidProfile = {
        name: 'Invalid Profile',
        description: 'Profile with long location',
        location: 'This is a very long location string that exceeds the maximum allowed length of 100 characters, which should cause a validation error'
      };
      const validationResult = await ProfileValidator.validateProfile(invalidProfile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors).toContain('Location must be a string and cannot exceed 100 characters.');
    });

    it('should fail validation if location is not a string', async () => {
      const invalidProfile = {
        name: 'Invalid Profile',
        description: 'Profile with invalid location type',
        location: 12345
      };
      const validationResult = await ProfileValidator.validateProfile(invalidProfile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors).toContain('Location must be a string and cannot exceed 100 characters.');
    });
    
    it('should pass validation for a profile with an empty location string', async () => {
      const profile = {
        name: 'Valid Profile',
        description: 'This is a valid profile',
        location: ''
      };
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
      expect(validationResult.sanitizedProfile?.location).toEqual('');
    });
    
    it('should pass validation for a profile with location at maximum allowed length', async () => {
      const profile = {
        name: 'Valid Profile',
        description: 'This is a valid profile',
        location: 'A'.repeat(100) // Exactly 100 characters
      };
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
      expect(validationResult.sanitizedProfile?.location).toHaveLength(100);
    });
    
    it('should fail validation for a profile with dangerous content in location', async () => {
      const profile = {
        name: 'Invalid Profile',
        description: 'This is a valid profile',
        location: 'Berlin <script>alert("XSS")</script>'
      };
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Invalid location: Input contains potentially dangerous content');
    });
    
    it('should validate profiles with special characters in location', async () => {
      const profile = {
        name: 'Valid Profile',
        description: 'This is a valid profile',
        location: 'München, Bayern - Germany (EU)'
      };
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
      expect(validationResult.sanitizedProfile?.location).toEqual('München, Bayern - Germany (EU)');
    });
  });

  describe('validateProfile - Name and Description', () => {
    it('should fail validation if name is missing', async () => {
      const profile = {
        description: 'This is a description',
        location: 'Berlin'
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Name is required');
    });
    
    it('should fail validation if name is too long', async () => {
      const profile = {
        name: 'A'.repeat(config.maxNameLength + 1),
        description: 'This is a description'
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Name is required');
    });
    
    it('should fail validation if description is too long', async () => {
      const profile = {
        name: 'Valid Name',
        description: 'A'.repeat(config.descriptionLength + 1)
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Description must be a string');
    });
    
    it('should pass validation with optional description field missing', async () => {
      const profile = {
        name: 'Valid Name'
        // No description
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
    });
  });
  
  describe('validateProfile - Image URL', () => {
    it('should fail validation if image URL is too long', async () => {
      const profile = {
        name: 'Valid Name',
        imageUrl: 'https://example.com/' + 'a'.repeat(config.imageUrlLength)
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Image URL must be a string');
    });
    
    it('should fail validation if image URL has invalid protocol', async () => {
      const profile = {
        name: 'Valid Name',
        imageUrl: 'ftp://example.com/image.png'
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Image URL must use HTTP or HTTPS protocol');
    });
    
    it('should fail validation if image URL is not a valid URL', async () => {
      const profile = {
        name: 'Valid Name',
        imageUrl: 'not-a-url'
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.sanitizedProfile).toBeUndefined();
      expect(validationResult.errors[0]).toContain('Invalid image URL format');
    });
    
    it('should pass validation with a valid HTTPS image URL', async () => {
      const profile = {
        name: 'Valid Name',
        imageUrl: 'https://example.com/image.png'
      };
      
      const validationResult = await ProfileValidator.validateProfile(profile);
      expect(validationResult.errors).toEqual([]);
      expect(validationResult.sanitizedProfile).toBeDefined();
    });
  });
  
  describe('validateImage', () => {
    it('should pass validation for a valid image data URL', async () => {
      // Mock the sharp implementation for this test
      const mockMetadata = jest.fn().mockResolvedValue({
        width: config.imageDimension,
        height: config.imageDimension,
        format: 'png'
      });
      
      const mockSharp = jest.fn().mockReturnValue({
        metadata: mockMetadata
      });
      
      (sharp as jest.Mock).mockImplementation(mockSharp);
      
      const validImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
      const isValid = await ProfileValidator.validateImage(validImageDataUrl);
      expect(isValid).toBe(true);
      expect(mockSharp).toHaveBeenCalled();
      expect(mockMetadata).toHaveBeenCalled();
    });

    it('should fail validation for an invalid image data URL', async () => {
      const invalidImageDataUrl = 'invalid-data-url';
      const isValid = await ProfileValidator.validateImage(invalidImageDataUrl);
      expect(isValid).toBe(false);
      expect(logError).toHaveBeenCalled();
    });
    
    it('should fail validation for an empty data URL', async () => {
      const isValid = await ProfileValidator.validateImage('');
      expect(isValid).toBe(false);
      expect(logError).toHaveBeenCalled();
    });
    
    it('should fail validation if image dimensions are incorrect', async () => {
      // Mock the sharp implementation for this test with wrong dimensions
      const mockMetadata = jest.fn().mockResolvedValue({
        width: 100, // Different than config.imageDimension
        height: config.imageDimension,
        format: 'png'
      });
      
      const mockSharp = jest.fn().mockReturnValue({
        metadata: mockMetadata
      });
      
      (sharp as jest.Mock).mockImplementation(mockSharp);
      
      const validImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
      const isValid = await ProfileValidator.validateImage(validImageDataUrl);
      expect(isValid).toBe(false);
    });
    
    it('should fail validation if image format is not supported', async () => {
      // Mock the sharp implementation for this test with unsupported format
      const mockMetadata = jest.fn().mockResolvedValue({
        width: config.imageDimension,
        height: config.imageDimension,
        format: 'bmp' // Not in ['png', 'jpeg', 'gif']
      });
      
      const mockSharp = jest.fn().mockReturnValue({
        metadata: mockMetadata
      });
      
      (sharp as jest.Mock).mockImplementation(mockSharp);
      
      const validImageDataUrl = 'data:image/bmp;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
      const isValid = await ProfileValidator.validateImage(validImageDataUrl);
      expect(isValid).toBe(false);
    });
    
    it('should fail validation if metadata reading fails', async () => {
      // Mock the sharp implementation to throw an error
      const mockMetadata = jest.fn().mockRejectedValue(new Error('Metadata read error'));
      
      const mockSharp = jest.fn().mockReturnValue({
        metadata: mockMetadata
      });
      
      (sharp as jest.Mock).mockImplementation(mockSharp);
      
      const validImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
      const isValid = await ProfileValidator.validateImage(validImageDataUrl);
      expect(isValid).toBe(false);
      expect(logError).toHaveBeenCalled();
    });
    
    it('should fail validation if image size exceeds limit', async () => {
      // Create a data URL that's too large
      const largeBase64 = 'A'.repeat(config.maxImageSizeKB * 1024);
      const largeImageDataUrl = `data:image/png;base64,${largeBase64}`;
      
      const isValid = await ProfileValidator.validateImage(largeImageDataUrl);
      expect(isValid).toBe(false);
      expect(logError).toHaveBeenCalled();
    });
  });
});
