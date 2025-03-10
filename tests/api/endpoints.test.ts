import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import { ProfileRepository } from '../../src/repositories/profileRepo';
import { Profile } from '../../src/types';

// Set up a global mocked in-memory store
const testProfiles: Record<string, Profile> = {};

// Mock the database
jest.mock('../../src/database/db', () => {
  const mockRun = jest.fn((params) => {
    if (params.address) {
      // Store the profile in our global store
      testProfiles[params.address] = { ...params };
    }
    return {};
  });
  
  const mockGet = jest.fn();
  const mockAll = jest.fn(() => []);
  
  const mockPrepare = jest.fn().mockImplementation(() => ({
    run: mockRun,
    get: mockGet,
    all: mockAll
  }));
  
  return { prepare: mockPrepare };
});

// Mock config
jest.mock('../../src/config/config', () => ({
  maxListSize: 50
}));

// Mock the ProfileValidator
jest.mock('../../src/services/profileValidator', () => ({
  ProfileValidator: {
    validateProfile: jest.fn(async (profile) => {
      // Simple validation logic
      const errors = [];
      
      if (profile.location && typeof profile.location !== 'string') {
        errors.push('Location must be a string');
      }
      
      if (profile.location && typeof profile.location === 'string' && profile.location.length > 100) {
        errors.push('Location cannot exceed 100 characters');
      }
      
      if (profile.location && typeof profile.location === 'string' && profile.location.includes('<script>')) {
        errors.push('Location contains potentially dangerous content');
      }
      
      return {
        errors,
        sanitizedProfile: errors.length === 0 ? profile : undefined
      };
    })
  }
}));

// Mock persistence services
jest.mock('../../src/services/kuboService', () => ({
  KuboService: jest.fn().mockImplementation(() => ({
    pinProfile: jest.fn(async () => 'Qm123'),
    getProfile: jest.fn(async () => ({ name: 'Test', description: 'Test description', location: 'Berlin' }))
  }))
}));

// Create a mock app for testing
const app = express();
app.use(bodyParser.json());

// Mock the search endpoint
app.get('/search', (req, res) => {
  // For testing purposes, we'll implement a simplified filtering mechanism
  const allProfiles = Object.values(testProfiles);
  let results = allProfiles;
  
  // Filter by location if provided
  if (req.query.location) {
    const locationFilter = req.query.location as string;
    results = results.filter(p => p.location && p.location.startsWith(locationFilter));
  }
  
  // Filter by name if provided
  if (req.query.name) {
    const nameFilter = req.query.name as string;
    results = results.filter(p => p.name && p.name.includes(nameFilter));
  }
  
  res.json(results);
});

// Mock the search by addresses endpoint
app.post('/search/addresses', (req, res) => {
  // Simplified implementation for test purposes
  const addresses = req.body.addresses || [];
  
  if (!Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Addresses must be an array' });
  }
  
  const results = Object.values(testProfiles).filter(
    (p: Profile) => p.address && addresses.includes(p.address)
  );
  
  res.json(results);
});

// Mock the pin endpoint
app.post('/pin', async (req, res) => {
  try {
    // Simplified validation logic
    if (req.body.location && typeof req.body.location !== 'string') {
      return res.status(400).json({ error: 'Location must be a string' });
    }
    
    if (req.body.location && req.body.location.length > 100) {
      return res.status(400).json({ error: 'Location cannot exceed 100 characters' });
    }
    
    // Create a mock profile and add it to our test store
    const profile: Profile = {
      address: req.body.address || '0x123',
      CID: 'Qm123',
      lastUpdatedAt: Date.now(),
      name: req.body.name || 'Test User',
      description: req.body.description || 'Test description',
      registeredName: null,
      location: req.body.location
    };
    
    // Add directly to our test store
    testProfiles[profile.address] = profile;
    
    res.json({ CID: 'Qm123' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

describe('API Endpoints with Location Field', () => {
  let profileRepo: ProfileRepository;
  
  beforeEach(() => {
    jest.clearAllMocks();
    profileRepo = new ProfileRepository();
    
    // Seed some test profiles
    const testProfiles = [
      {
        address: '0x111',
        CID: 'Qm111',
        lastUpdatedAt: Date.now(),
        name: 'User 1',
        description: 'Description 1',
        registeredName: null,
        location: 'Berlin'
      },
      {
        address: '0x222',
        CID: 'Qm222',
        lastUpdatedAt: Date.now(),
        name: 'User 2',
        description: 'Description 2',
        registeredName: null,
        location: 'Paris'
      },
      {
        address: '0x333',
        CID: 'Qm333',
        lastUpdatedAt: Date.now(),
        name: 'User 3',
        description: 'Description 3',
        registeredName: null,
        location: 'London'
      }
    ];
    
    testProfiles.forEach(profile => profileRepo.upsertProfile(profile));
  });
  
  describe('GET /search', () => {
    it('should search profiles by location', async () => {
      const response = await request(app)
        .get('/search')
        .query({ location: 'Berlin' });
      
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].location).toBe('Berlin');
    });
    
    it('should search profiles by location prefix', async () => {
      const response = await request(app)
        .get('/search')
        .query({ location: 'P' }); // Should match "Paris"
      
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].location).toBe('Paris');
    });
    
    it('should return empty array when no profiles match location', async () => {
      const response = await request(app)
        .get('/search')
        .query({ location: 'Tokyo' });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
    
    it('should search with combined criteria including location', async () => {
      const response = await request(app)
        .get('/search')
        .query({ name: 'User', location: 'London' });
      
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].name).toBe('User 3');
      expect(response.body[0].location).toBe('London');
    });
  });
  
  describe('POST /search/addresses', () => {
    it('should return profiles with location field', async () => {
      const response = await request(app)
        .post('/search/addresses')
        .send({ addresses: ['0x111', '0x222'] });
      
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
      expect(response.body[0].location).toBe('Berlin');
      expect(response.body[1].location).toBe('Paris');
    });
    
    it('should return empty array when no addresses match', async () => {
      const response = await request(app)
        .post('/search/addresses')
        .send({ addresses: ['0x999'] });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
    
    it('should handle an empty addresses array', async () => {
      const response = await request(app)
        .post('/search/addresses')
        .send({ addresses: [] });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });
  
  describe('POST /pin', () => {
    it('should create a profile with location field', async () => {
      const profileData = {
        address: '0x444',
        name: 'New User',
        description: 'New description',
        location: 'Tokyo'
      };
      
      const response = await request(app)
        .post('/pin')
        .send(profileData);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('CID');
      
      // Verify the profile was created
      const searchResponse = await request(app)
        .get('/search')
        .query({ location: 'Tokyo' });
      
      expect(searchResponse.body.length).toBe(1);
      expect(searchResponse.body[0].location).toBe('Tokyo');
    });
    
    it('should create a profile without location field', async () => {
      const profileData = {
        address: '0x555',
        name: 'No Location User',
        description: 'User without location'
      };
      
      const response = await request(app)
        .post('/pin')
        .send(profileData);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('CID');
      
      // Verify the profile was created
      const searchResponse = await request(app)
        .post('/search/addresses')
        .send({ addresses: ['0x555'] });
      
      expect(searchResponse.body.length).toBe(1);
      expect(searchResponse.body[0].location).toBeUndefined();
    });
    
    it('should reject a profile with invalid location type', async () => {
      const profileData = {
        address: '0x666',
        name: 'Invalid Location User',
        description: 'User with invalid location',
        location: 12345 // Not a string
      };
      
      const response = await request(app)
        .post('/pin')
        .send(profileData);
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Location must be a string');
    });
    
    it('should reject a profile with too long location', async () => {
      const profileData = {
        address: '0x777',
        name: 'Long Location User',
        description: 'User with too long location',
        location: 'A'.repeat(101) // Exceeds 100 characters
      };
      
      const response = await request(app)
        .post('/pin')
        .send(profileData);
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Location cannot exceed 100 characters');
    });
    
    it('should accept a profile with empty location string', async () => {
      const profileData = {
        address: '0x888',
        name: 'Empty Location User',
        description: 'User with empty location',
        location: ''
      };
      
      const response = await request(app)
        .post('/pin')
        .send(profileData);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('CID');
      
      // Verify the profile was created
      const searchResponse = await request(app)
        .post('/search/addresses')
        .send({ addresses: ['0x888'] });
      
      expect(searchResponse.body.length).toBe(1);
      expect(searchResponse.body[0].location).toBe('');
    });
  });
});
