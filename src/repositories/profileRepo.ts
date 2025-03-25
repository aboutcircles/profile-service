import type { Statement } from 'better-sqlite3';
import db from '../database/db';
import config from '../config/config';
import { Profile } from '../types';

export class ProfileRepository {
  private insertOrUpdateProfileStmt = db.prepare(`
      INSERT INTO profiles (address, CID, lastUpdatedAt, name, description, registeredName, location, longitude, latitude)
      VALUES (@address, @CID, @lastUpdatedAt, @name, @description, @registeredName, @location, @longitude, @latitude)
          ON CONFLICT(address) DO UPDATE
                                      SET lastUpdatedAt  = excluded.lastUpdatedAt,
                                      CID            = COALESCE(NULLIF(excluded.CID, ''), profiles.CID),
                                      name           = COALESCE(NULLIF(excluded.name, ''), profiles.name),
                                      description    = COALESCE(NULLIF(excluded.description, ''), profiles.description),
                                      registeredName = COALESCE(excluded.registeredName, profiles.registeredName),
                                      location       = COALESCE(NULLIF(excluded.location, ''), profiles.location),
                                      longitude      = COALESCE(excluded.longitude, profiles.longitude),
                                      latitude       = COALESCE(excluded.latitude, profiles.latitude);
  `);

  private updateProfileStmt = db.prepare(`
      UPDATE profiles
      SET lastUpdatedAt  = @lastUpdatedAt,
          CID            = COALESCE(NULLIF(@CID, ''), CID),
          name           = COALESCE(NULLIF(@name, ''), name),
          description    = COALESCE(NULLIF(@description, ''), description),
          registeredName = COALESCE(@registeredName, registeredName),
          location       = COALESCE(NULLIF(@location, ''), location),
          longitude      = COALESCE(@longitude, longitude),
          latitude       = COALESCE(@latitude, latitude)
      WHERE address = @address;
  `);

  private getLastProcessedBlockStmt: Statement<any[], { lastProcessed: number }> = db.prepare(`
      SELECT MAX(lastUpdatedAt) AS lastProcessed FROM profiles;
  `);

  private deleteOlderThanBlockStmt = db.prepare(`
      DELETE FROM profiles WHERE lastUpdatedAt >= ?;
  `);

  getLastProcessedBlock(): number {
    return this.getLastProcessedBlockStmt.get()?.lastProcessed || 0;
  }

  upsertProfile(profile: Profile): void {
    // Create a database-ready object with longitude and latitude as separate columns
    const dbProfile = {
      ...profile,
      longitude: profile.geoLocation ? profile.geoLocation[0] : null,
      latitude: profile.geoLocation ? profile.geoLocation[1] : null
    };
    
    // Remove geoLocation from the object as it's not a column in the DB
    if ('geoLocation' in dbProfile) {
      delete (dbProfile as Profile).geoLocation;
    }
    
    this.insertOrUpdateProfileStmt.run(dbProfile);
  }

  updateProfile(profile: Profile): void {
    // Create a database-ready object with longitude and latitude as separate columns
    const dbProfile = {
      ...profile,
      longitude: profile.geoLocation ? profile.geoLocation[0] : null,
      latitude: profile.geoLocation ? profile.geoLocation[1] : null
    };
    
    // Remove geoLocation from the object as it's not a column in the DB
    if ('geoLocation' in dbProfile) {
      delete (dbProfile as Profile).geoLocation;
    }
    
    this.updateProfileStmt.run(dbProfile);
  }

  deleteDataOlderThanBlock(blockNumber: number): void {
    this.deleteOlderThanBlockStmt.run(blockNumber);
  }

  searchProfilesByAddresses(addresses: string[]): Profile[] {
    if (!addresses.length) return [];
    
    const placeholders = addresses.map(() => '?').join(',');
    
    const sql = `
      SELECT 
        p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName, p.location, p.longitude, p.latitude
      FROM profiles p
      WHERE p.address IN (${placeholders})
      LIMIT ?
    `;
    
    const results = db.prepare(sql).all([...addresses, config.maxListSize]);
    
    // Convert DB results to Profile objects with geoLocation array
    return results.map((row: any) => {
      const profile: Profile = {
        address: row.address,
        CID: row.CID,
        lastUpdatedAt: row.lastUpdatedAt,
        name: row.name,
        description: row.description,
        registeredName: row.registeredName,
        location: row.location
      };
      
      // Add geoLocation only if both longitude and latitude exist
      if (row.longitude !== null && row.latitude !== null) {
        profile.geoLocation = [row.longitude, row.latitude];
      }
      
      return profile;
    });
  }

  /**
   * searchProfiles:
   *  - If user provides `name` or `description` or `location`, we do an FTS join (on `profiles_fts`)
   *    and match each column separately (`f.name MATCH ...`, `f.description MATCH ...`).
   *  - If no name or description is given, we skip the FTS join and just filter by address/CID/registeredName.
   */
  searchProfiles(filters: {
    name?: string;
    description?: string;
    address?: string;
    CID?: string;
    registeredName?: string;
    location?: string;
  }): any[] {
    // If no FTS filters are given, run a simpler query directly on `profiles`.
    const hasFts = !!(filters.name || filters.description || filters.location);

    if (!hasFts) {
      // -- CASE 1: No FTS-based filtering --
      let sql = `
        SELECT
          p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName, p.location, p.longitude, p.latitude
        FROM profiles p
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters.address) {
        conditions.push('p.address LIKE ?');
        params.push(`${filters.address}%`);
      }
      if (filters.CID) {
        conditions.push('p.CID = ?');
        params.push(filters.CID);
      }
      if (filters.registeredName) {
        conditions.push('p.registeredName = ?');
        params.push(filters.registeredName);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      // Add a limit placeholder (better-sqlite3 supports LIMIT ?)
      sql += ' LIMIT ?';
      params.push(config.maxListSize);

      const results = db.prepare(sql).all(params);
      
      // Convert DB results to Profile objects with geoLocation array
      return results.map((row: any) => {
        const profile: Profile = {
          address: row.address,
          CID: row.CID,
          lastUpdatedAt: row.lastUpdatedAt,
          name: row.name,
          description: row.description,
          registeredName: row.registeredName,
          location: row.location
        };
        
        // Add geoLocation only if both longitude and latitude exist
        if (row.longitude !== null && row.latitude !== null) {
          profile.geoLocation = [row.longitude, row.latitude];
        }
        
        return profile;
      });
    } else {
      // -- CASE 2: At least one FTS filter (name or description) --
      let sql = `
        SELECT
          p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName, p.location, p.longitude, p.latitude
        FROM profiles_fts f
        JOIN profiles p ON p.rowid = f.rowid
        WHERE
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      // FTS conditions first
      if (filters.name) {
        conditions.push('f.name MATCH ?');
        // For prefix searching: add "*" at the end
        params.push(`"${filters.name}"*`);
      }
      if (filters.description) {
        conditions.push('f.description MATCH ?');
        params.push(`"${filters.description}"*`);
      }
      if (filters.location) {
        conditions.push('f.location MATCH ?');
        params.push(`"${filters.location}"*`);
      }

      // Non-FTS equality conditions (address, CID, registeredName)
      if (filters.address) {
        conditions.push('p.address LIKE ?');
        params.push(`${filters.address}%`);
      }
      if (filters.CID) {
        conditions.push('p.CID = ?');
        params.push(filters.CID);
      }
      if (filters.registeredName) {
        conditions.push('p.registeredName = ?');
        params.push(filters.registeredName);
      }

      // Join all conditions with AND
      sql += conditions.join(' AND ');

      // Add a limit placeholder
      sql += ' LIMIT ?';
      params.push(config.maxListSize);

      const results = db.prepare(sql).all(params);
      
      // Convert DB results to Profile objects with geoLocation array
      return results.map((row: any): Profile => {
        const profile: Profile = {
          address: row.address,
          CID: row.CID,
          lastUpdatedAt: row.lastUpdatedAt,
          name: row.name,
          description: row.description,
          registeredName: row.registeredName,
          location: row.location
        };
        
        // Add geoLocation only if both longitude and latitude exist
        if (row.longitude !== null && row.latitude !== null) {
          profile.geoLocation = [row.longitude, row.latitude];
        }
        
        return profile;
      });
    }
  }
}