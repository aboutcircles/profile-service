import type { Statement } from 'better-sqlite3';

import db from '../database/db';

export interface Profile {
  address: string;
  CID: string;
  lastUpdatedAt: number;
  name: string;
  description?: string;
  registeredName: string | null;
}

class ProfileRepository {
  private insertOrUpdateProfileStmt = db.prepare(`
        INSERT INTO profiles (address, CID, lastUpdatedAt, name, description, registeredName)
        VALUES (@address, @CID, @lastUpdatedAt, @name, @description, @registeredName)
        ON CONFLICT(address) DO UPDATE SET 
        lastUpdatedAt = excluded.lastUpdatedAt,
        CID = COALESCE(NULLIF(excluded.CID, ''), profiles.CID),
        name = COALESCE(NULLIF(excluded.name, ''), profiles.name),
        description = COALESCE(NULLIF(excluded.description, ''), profiles.description),
        registeredName = COALESCE(excluded.registeredName, profiles.registeredName);
    `);

  private updateProfileStmt = db.prepare(`
        UPDATE profiles 
        SET 
            lastUpdatedAt = @lastUpdatedAt,
            CID = COALESCE(NULLIF(@CID, ''), CID),
            name = COALESCE(NULLIF(@name, ''), name),
            description = COALESCE(NULLIF(@description, ''), description),
            registeredName = COALESCE(@registeredName, registeredName)
        WHERE address = @address;
    `);

  private getLastProcessedBlockStmt: Statement<any[], { lastProcessed: number }> = db.prepare(`
        SELECT MAX(lastUpdatedAt) AS lastProcessed FROM profiles;
    `);

  private deleteOlderThanBlockStmt = db.prepare(`
        DELETE FROM profiles WHERE lastUpdatedAt >= ?;
    `);

  private searchProfilesStmt = db.prepare(`
        SELECT address, name, description, CID, lastUpdatedAt, registeredName
        FROM profiles
        WHERE 
            (@name IS NULL OR name LIKE '%' || @name || '%') AND
            (@description IS NULL OR description LIKE '%' || @description || '%') AND
            (@address IS NULL OR address = @address) AND
            (@CID IS NULL OR CID = @CID) AND
            (@registeredName IS NULL OR registeredName = @registeredName)
    `);

  getLastProcessedBlock(): number {
    return this.getLastProcessedBlockStmt.get()?.lastProcessed || 0;
  }

  upsertProfile(profile: Profile): void {
    this.insertOrUpdateProfileStmt.run(profile);
  }

  deleteDataOlderThanBlock(blockNumber: number): void {
    this.deleteOlderThanBlockStmt.run(blockNumber);
  }

  searchProfiles(filters: { name?: string; description?: string; address?: string; CID?: string, registeredName?: string }): any[] {
    return this.searchProfilesStmt.all(filters);
  }

  updateProfile(profile: Profile): void {
    this.updateProfileStmt.run(profile);
  }
}

export default new ProfileRepository();
