import type {Statement} from 'better-sqlite3';
import db from '../database/db';
import config from '../config/config';
import {Profile} from '../types';

/**
 * Helper function to sanitize FTS input.
 * It removes double quotes which can break the intended quoting in the FTS MATCH clause.
 * You can expand this function to remove or escape other characters if needed.
 */
function sanitizeFtsInput(input: string): string {
    return input.replace(/"/g, '');
}

export class ProfileRepository {
    private insertOrUpdateProfileStmt = db.prepare(`
        INSERT INTO profiles (address, CID, lastUpdatedAt, name, description, registeredName, location, longitude,
                              latitude)
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

    private getLastProcessedBlockStmt: Statement<any[], { lastProcessed: number }> = db.prepare(`
        SELECT MAX(lastUpdatedAt) AS lastProcessed
        FROM profiles;
    `);

    private deleteOlderThanBlockStmt = db.prepare(`
        DELETE
        FROM profiles
        WHERE lastUpdatedAt >= ?;
    `);

    private hasProfileStmt = db.prepare(`
        SELECT 1
        FROM profiles
        WHERE address = ?
        LIMIT 1;
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

        this.insertOrUpdateProfileStmt.run(dbProfile);
    }

    deleteDataOlderThanBlock(blockNumber: number): void {
        this.deleteOlderThanBlockStmt.run(blockNumber);
    }

    hasProfile(address: string): boolean {
        return this.hasProfileStmt.get(address) !== undefined;
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

    searchProfilesByAddresses(addresses: string[]): Profile[] {
        if (!addresses.length) return [];

        const placeholders = addresses.map(() => '?').join(',');

        const sql = `
            SELECT p.address,
                   p.name,
                   p.description,
                   p.CID,
                   p.lastUpdatedAt,
                   p.registeredName,
                   p.location,
                   p.longitude,
                   p.latitude
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
                SELECT p.address,
                       p.name,
                       p.description,
                       p.CID,
                       p.lastUpdatedAt,
                       p.registeredName,
                       p.location,
                       p.longitude,
                       p.latitude
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
                SELECT p.address,
                       p.name,
                       p.description,
                       p.CID,
                       p.lastUpdatedAt,
                       p.registeredName,
                       p.location,
                       p.longitude,
                       p.latitude
                FROM profiles_fts f
                         JOIN profiles p ON p.rowid = f.rowid
                WHERE
            `;

            const conditions: string[] = [];
            const params: any[] = [];

            // FTS conditions first
            if (filters.name) {
                conditions.push('f.name MATCH ?');
                // Sanitize and append "*" for prefix searching
                const sanitized = sanitizeFtsInput(filters.name);
                params.push(`"${sanitized}"*`);
            }
            if (filters.description) {
                conditions.push('f.description MATCH ?');
                const sanitized = sanitizeFtsInput(filters.description);
                params.push(`"${sanitized}"*`);
            }
            if (filters.location) {
                conditions.push('f.location MATCH ?');
                const sanitized = sanitizeFtsInput(filters.location);
                params.push(`"${sanitized}"*`);
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