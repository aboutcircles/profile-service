import type { Statement } from 'better-sqlite3';
import db from '../database/db';
import config from '../config/config';

export interface Profile {
  address: string;
  CID: string;
  lastUpdatedAt: number;
  name: string;
  description?: string;
  registeredName: string | null;
}

export class ProfileRepository {
  private insertOrUpdateProfileStmt = db.prepare(`
      INSERT INTO profiles (address, CID, lastUpdatedAt, name, description, registeredName)
      VALUES (@address, @CID, @lastUpdatedAt, @name, @description, @registeredName)
          ON CONFLICT(address) DO UPDATE
                                      SET lastUpdatedAt  = excluded.lastUpdatedAt,
                                      CID            = COALESCE(NULLIF(excluded.CID, ''), profiles.CID),
                                      name           = COALESCE(NULLIF(excluded.name, ''), profiles.name),
                                      description    = COALESCE(NULLIF(excluded.description, ''), profiles.description),
                                      registeredName = COALESCE(excluded.registeredName, profiles.registeredName);
  `);

  private updateProfileStmt = db.prepare(`
      UPDATE profiles
      SET lastUpdatedAt  = @lastUpdatedAt,
          CID            = COALESCE(NULLIF(@CID, ''), CID),
          name           = COALESCE(NULLIF(@name, ''), name),
          description    = COALESCE(NULLIF(@description, ''), description),
          registeredName = COALESCE(@registeredName, registeredName)
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
    this.insertOrUpdateProfileStmt.run(profile);
  }

  updateProfile(profile: Profile): void {
    this.updateProfileStmt.run(profile);
  }

  deleteDataOlderThanBlock(blockNumber: number): void {
    this.deleteOlderThanBlockStmt.run(blockNumber);
  }

  /**
   * searchProfiles:
   *  - If user provides `name` or `description`, we do an FTS join (on `profiles_fts`)
   *    and match each column separately (`f.name MATCH ...`, `f.description MATCH ...`).
   *  - If no name or description is given, we skip the FTS join and just filter by address/CID/registeredName.
   */
  searchProfiles(filters: {
    name?: string;
    description?: string;
    address?: string;
    CID?: string;
    registeredName?: string;
  }): any[] {
    // If no FTS filters are given, run a simpler query directly on `profiles`.
    const hasFts = !!(filters.name || filters.description);

    if (!hasFts) {
      // -- CASE 1: No FTS-based filtering --
      let sql = `
        SELECT
          p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName
        FROM profiles p
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters.address) {
        conditions.push('p.address = ?');
        params.push(filters.address);
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

      return db.prepare(sql).all(params);
    } else {
      // -- CASE 2: At least one FTS filter (name or description) --
      let sql = `
        SELECT
          p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName
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
        params.push(filters.name + '*');
      }
      if (filters.description) {
        conditions.push('f.description MATCH ?');
        params.push(filters.description + '*');
      }

      // Non-FTS equality conditions (address, CID, registeredName)
      if (filters.address) {
        conditions.push('p.address = ?');
        params.push(filters.address);
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

      return db.prepare(sql).all(params);
    }
  }
}
