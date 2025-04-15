import type { Statement } from 'better-sqlite3';
import db from '../database/db';
import { Profile } from '../types';

export class ProfileWriter {
    private insertOrUpdateProfileStmt: Statement<Profile> = db.prepare(`
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

    private deleteOlderThanBlockStmt = db.prepare(`
        DELETE
        FROM profiles
        WHERE lastUpdatedAt >= ?;
    `);

    /**
     * Inserts or updates a profile in the database.
     * If the address already exists, it updates the existing record.
     */
    upsertProfile(profile: Profile): void {
        const dbProfile: Profile = {
            ...profile,
            longitude: profile.geoLocation ? profile.geoLocation[0] : undefined,
            latitude: profile.geoLocation ? profile.geoLocation[1] : undefined
        };

        this.insertOrUpdateProfileStmt.run(dbProfile);
    }

    /**
     * Deletes all profile entries older than or equal to the given block number.
     */
    deleteDataOlderThanBlock(blockNumber: number): void {
        this.deleteOlderThanBlockStmt.run(blockNumber);
    }
}
