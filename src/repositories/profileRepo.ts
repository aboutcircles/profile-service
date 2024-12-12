import type { Statement } from 'better-sqlite3';

import db from '../database/db';

export interface Profile {
  address: string;
  CID: string;
  lastUpdatedAt: number;
  name: string;
  description: string;
}

class ProfileRepository {
  private insertOrUpdateProfileStmt = db.prepare(`
        INSERT INTO profiles (address, CID, lastUpdatedAt, name, description)
        VALUES (@address, @CID, @lastUpdatedAt, @name, @description)
        ON CONFLICT(address) DO UPDATE SET 
        CID = excluded.CID,
        lastUpdatedAt = excluded.lastUpdatedAt,
        name = excluded.name,
        description = excluded.description;
    `);

  private updateSearchIndexStmt = db.prepare(`
        INSERT INTO profiles_search (rowid, name, description)
        SELECT rowid, @name, @description FROM profiles WHERE address = @address;
    `);

  private getLastProcessedBlockStmt: Statement<any[], { lastProcessed: number }> = db.prepare(`
        SELECT MAX(lastUpdatedAt) AS lastProcessed FROM profiles;
    `);

  private searchProfilesStmt = db.prepare(`
        SELECT name, description FROM profiles_search WHERE profiles_search MATCH ?;
    `);

  private deleteOlderThanBlockStmt = db.prepare(`
        DELETE FROM profiles WHERE lastUpdatedAt < ?;
    `);

  getLastProcessedBlock(): number {
    return this.getLastProcessedBlockStmt.get()?.lastProcessed || 0;
  }

  upsertProfile(profile: Profile): void {
    this.insertOrUpdateProfileStmt.run(profile);
    this.updateSearchIndexStmt.run(profile);
  }

  searchProfiles(query: string): Profile[] {
    return this.searchProfilesStmt.all(query) as Profile[];
  }

  deleteDataOlderThanBlock(blockNumber: number): void {
    this.deleteOlderThanBlockStmt.run(blockNumber);
  }
}

export default new ProfileRepository();
