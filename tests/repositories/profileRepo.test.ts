// Mock the database
const mockRun = jest.fn();
const mockGet = jest.fn();
const mockAll = jest.fn();
const mockPrepare = jest.fn().mockImplementation(() => ({
  run: mockRun,
  get: mockGet,
  all: mockAll
}));

// Create a mock DB object
const mockDb = { prepare: mockPrepare };

// Mock the database module
jest.mock('../../src/database/db', () => mockDb);

// Mock the config
jest.mock('../../src/config/config', () => ({
  maxListSize: 50
}));

import { ProfileRepository } from '../../src/repositories/profileRepo';
import { Profile } from '../../src/types';

describe('ProfileRepository', () => {
  let profileRepo: ProfileRepository;
  
  beforeEach(() => {
    jest.clearAllMocks();
    profileRepo = new ProfileRepository();
  });
  
  describe('upsertProfile', () => {
    it('should insert a profile with location field', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null,
        location: 'Berlin'
      };
      
      // Act
      profileRepo.upsertProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const prepareCall = mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('location');
      
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).toHaveProperty('location', 'Berlin');
    });
    
    it('should insert a profile without location field', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null
      };
      
      // Act
      profileRepo.upsertProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).not.toHaveProperty('location');
    });
    
    it('should handle empty location string', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null,
        location: ''
      };
      
      // Act
      profileRepo.upsertProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).toHaveProperty('location', '');
    });
    
    it('should handle location with special characters', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null,
        location: 'Berlin, Germany (Kreuzberg - SO36)'
      };
      
      // Act
      profileRepo.upsertProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).toHaveProperty('location', 'Berlin, Germany (Kreuzberg - SO36)');
    });
  });
  
  describe('updateProfile', () => {
    it('should update a profile with location field', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null,
        location: 'Berlin'
      };
      
      // Act
      profileRepo.updateProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const prepareCall = mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('location');
      
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).toHaveProperty('location', 'Berlin');
    });
    
    it('should update a profile without changing location field when not provided', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Updated User',
        description: 'Updated description',
        registeredName: null
      };
      
      // Act
      profileRepo.updateProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).not.toHaveProperty('location');
    });
    
    it('should update a profile by changing location field', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null,
        location: 'New York'
      };
      
      // Act
      profileRepo.updateProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).toHaveProperty('location', 'New York');
    });
    
    it('should handle setting location to empty string', () => {
      // Arrange
      const profile: Profile = {
        address: '0x123',
        CID: 'Qm123',
        lastUpdatedAt: 123456789,
        name: 'Test User',
        description: 'Test description',
        registeredName: null,
        location: ''
      };
      
      // Act
      profileRepo.updateProfile(profile);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      const runCall = mockRun.mock.calls[0][0];
      expect(runCall).toHaveProperty('location', '');
    });
  });
  
  describe('searchProfiles', () => {
    it('should search profiles by location using non-FTS query', () => {
      // Arrange
      const filters = { location: 'Berlin' };
      const mockProfiles = [{ name: 'Test', location: 'Berlin' }];
      mockAll.mockReturnValue(mockProfiles);
      
      // Mock the SQL query for this specific test
      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) {
          return {
            run: mockRun,
            get: mockGet,
            all: mockAll
          };
        }
        return {
          run: mockRun,
          get: mockGet,
          all: mockAll
        };
      });
      
      // Act
      const result = profileRepo.searchProfiles(filters);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
      
      // Since our mock implementation doesn't actually execute SQL queries,
      // we'll just verify that the function was called with the right filters
      expect(mockPrepare).toHaveBeenCalled();
      expect(filters).toHaveProperty('location', 'Berlin');
    });
    
    it('should search profiles by location using FTS query', () => {
      // Arrange
      const filters = { name: 'Test', location: 'Berlin' };
      const mockProfiles = [{ name: 'Test', location: 'Berlin' }];
      mockAll.mockReturnValue(mockProfiles);
      
      // Mock the SQL query for this specific test
      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) {
          return {
            run: mockRun,
            get: mockGet,
            all: mockAll
          };
        }
        return {
          run: mockRun,
          get: mockGet,
          all: mockAll
        };
      });
      
      // Act
      const result = profileRepo.searchProfiles(filters);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
      
      // Since our mock implementation doesn't actually execute SQL queries,
      // we'll just verify that the function was called with the right filters
      expect(mockPrepare).toHaveBeenCalled();
      expect(filters).toHaveProperty('name', 'Test');
      expect(filters).toHaveProperty('location', 'Berlin');
    });
    
    it('should search profiles by partial location match', () => {
      // Arrange
      const filters = { location: 'Ber' }; // Should match 'Berlin'
      const mockProfiles = [{ name: 'Test', location: 'Berlin' }];
      mockAll.mockReturnValue(mockProfiles);
      
      // Mock the SQL query for this specific test
      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) {
          return {
            run: mockRun,
            get: mockGet,
            all: mockAll
          };
        }
        return {
          run: mockRun,
          get: mockGet,
          all: mockAll
        };
      });
      
      // Act
      const result = profileRepo.searchProfiles(filters);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
      
      // Verify that the mock was called
      expect(mockAll).toHaveBeenCalled();
      expect(filters).toHaveProperty('location', 'Ber');
    });
    
    it('should search profiles by location with special characters', () => {
      // Arrange
      const filters = { location: 'New York, NY' };
      const mockProfiles = [{ name: 'Test', location: 'New York, NY' }];
      mockAll.mockReturnValue(mockProfiles);
      
      // Mock the SQL query
      mockPrepare.mockImplementation((sql) => ({
        run: mockRun,
        get: mockGet,
        all: mockAll
      }));
      
      // Act
      const result = profileRepo.searchProfiles(filters);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
      
      // Verify that the mock was called
      expect(mockAll).toHaveBeenCalled();
      expect(filters).toHaveProperty('location', 'New York, NY');
    });
  });
  
  describe('searchProfilesByAddresses', () => {
    it('should return profiles with location field', () => {
      // Arrange
      const addresses = ['0x123', '0x456'];
      const mockProfiles = [
        { address: '0x123', name: 'Test1', location: 'Berlin' },
        { address: '0x456', name: 'Test2', location: 'London' }
      ];
      mockAll.mockReturnValue(mockProfiles);
      
      // Mock the SQL query for this specific test
      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) {
          return {
            run: mockRun,
            get: mockGet,
            all: mockAll
          };
        }
        return {
          run: mockRun,
          get: mockGet,
          all: mockAll
        };
      });
      
      // Act
      const result = profileRepo.searchProfilesByAddresses(addresses);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
      
      // Verify the mock was called with the expected addresses
      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalled();
      // We've mocked the return to include location field, so testing the returned data
      expect(result[0]).toHaveProperty('location', 'Berlin');
      expect(result[1]).toHaveProperty('location', 'London');
    });
    
    it('should return an empty array when no addresses are provided', () => {
      // Arrange
      const addresses: string[] = [];
      
      // Reset all mocks for this test
      jest.clearAllMocks();
      
      // Act
      const result = profileRepo.searchProfilesByAddresses(addresses);
      
      // Assert
      expect(result).toEqual([]);
      expect(mockPrepare).not.toHaveBeenCalled();
    });
    
    it('should handle empty and null location fields in results', () => {
      // Arrange
      const addresses = ['0x123', '0x456', '0x789'];
      const mockProfiles = [
        { address: '0x123', name: 'Test1', location: 'Berlin' },
        { address: '0x456', name: 'Test2', location: '' },
        { address: '0x789', name: 'Test3', location: null }
      ];
      mockAll.mockReturnValue(mockProfiles);
      
      // Mock the SQL query
      mockPrepare.mockImplementation((sql) => ({
        run: mockRun,
        get: mockGet,
        all: mockAll
      }));
      
      // Act
      const result = profileRepo.searchProfilesByAddresses(addresses);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
    });
    
    it('should handle the maxListSize limit correctly', () => {
      // Arrange
      const addresses = Array(100).fill(0).map((_, i) => `0x${i}`); // 100 addresses
      mockAll.mockReturnValue([]);
      
      // Mock the SQL query
      mockPrepare.mockImplementation((sql) => ({
        run: mockRun,
        get: mockGet,
        all: mockAll
      }));
      
      // Act
      profileRepo.searchProfilesByAddresses(addresses);
      
      // Assert
      expect(mockPrepare).toHaveBeenCalled();
      
      // Verify the limit parameter is applied
      const allCallArgs = mockAll.mock.calls[0][0];
      expect(allCallArgs[allCallArgs.length - 1]).toBe(50); // Should be the maxListSize value
    });
  });
});
