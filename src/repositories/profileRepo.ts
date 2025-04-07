import type { Statement } from 'better-sqlite3';
import db from '../database/db';
import config from '../config/config';
import { Profile } from '../types';

export class ProfileRepository {
  // Common column selection for all queries
  private readonly PROFILE_COLUMNS = 'p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName, p.location, p.longitude, p.latitude';

  // Prepared statements
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

  // Helper methods for data transformation
  private convertToDbProfile(profile: Profile): any {
    return {
      ...profile,
      longitude: profile.geoLocation ? profile.geoLocation[0] : null,
      latitude: profile.geoLocation ? profile.geoLocation[1] : null
    };
  }

  private mapRowToProfile(row: any): Profile {
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
  }

  // Repository methods
  getLastProcessedBlock(): number {
    return this.getLastProcessedBlockStmt.get()?.lastProcessed || 0;
  }

  upsertProfile(profile: Profile): void {
    this.insertOrUpdateProfileStmt.run(this.convertToDbProfile(profile));
  }

  updateProfile(profile: Profile): void {
    this.updateProfileStmt.run(this.convertToDbProfile(profile));
  }

  deleteDataOlderThanBlock(blockNumber: number): void {
    this.deleteOlderThanBlockStmt.run(blockNumber);
  }

  searchProfilesByAddresses(addresses: string[]): Profile[] {
    if (!addresses.length) return [];
    
    const placeholders = addresses.map(() => '?').join(',');
    
    const sql = `
      SELECT ${this.PROFILE_COLUMNS}
      FROM profiles p
      WHERE p.address IN (${placeholders})
      LIMIT ?
    `;
    
    const results = db.prepare(sql).all([...addresses, config.maxListSize]);
    return results.map(this.mapRowToProfile);
  }

  checkProfilesCidsExist(cids: string[]): boolean[] {
    if (!cids.length) return [];

    const placeholders = cids.map(cid => `('${cid}')`).join(',');
    
    const sql = `
    WITH input_cids(cid) AS (
        VALUES
            ${placeholders}
    )
    SELECT
        CAST(profiles.cid IS NOT NULL AS INTEGER) AS cidExists
    FROM
        input_cids
    LEFT JOIN
        profiles ON input_cids.cid = profiles.cid
    LIMIT ?
    `;

    const results: any[] = db.prepare(sql).all([config.maxListSize]);

    return results.map(result => !!result.cidExists);
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
  }): Profile[] {
    const hasFts = !!(filters.name || filters.description || filters.location);
    const conditions: string[] = [];
    const params: any[] = [];

    // Build common filter conditions
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

    let sql;
    
    if (!hasFts) {
      // -- CASE 1: No FTS-based filtering --
      sql = `
        SELECT ${this.PROFILE_COLUMNS}
        FROM profiles p
      `;

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
    } else {
      // -- CASE 2: At least one FTS filter (name, description, or location) --
      sql = `
        SELECT ${this.PROFILE_COLUMNS}
        FROM profiles_fts f
        JOIN profiles p ON p.rowid = f.rowid
        WHERE
      `;

      // Add FTS conditions
      if (filters.name) {
        conditions.push('f.name MATCH ?');
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

      // Join all conditions with AND
      sql += conditions.join(' AND ');
    }

    // Add limit to all queries
    sql += ' LIMIT ?';
    params.push(config.maxListSize);

    const results = db.prepare(sql).all(params);
    return results.map(row => this.mapRowToProfile(row));
  }
}