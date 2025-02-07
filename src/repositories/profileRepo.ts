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

  /**
   * Minimal single-quote escape to prevent straightforward SQL injection.
   */
  private escapeSingleQuotes(str: string): string {
    // replace every ' with ''
    return str.replace(/'/g, "''");
  }

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
   *  - If user provides `name` or `description`, we do a FTS join (on `profiles_fts`)
   *    and check each column separately with `f.name MATCH ...`, `f.description MATCH ...`.
   *  - If no name or description is given, skip FTS entirely and just filter by address/CID/registeredName.
   */
  searchProfiles(filters: {
    name?: string;
    description?: string;
    address?: string;
    CID?: string;
    registeredName?: string;
  }): any[] {
    // Collect the optional equality filters (on the main "profiles" table).
    const mainWhereClauses: string[] = [];
    if (filters.address) {
      mainWhereClauses.push(`p.address = '${this.escapeSingleQuotes(filters.address)}'`);
    }
    if (filters.CID) {
      mainWhereClauses.push(`p.CID = '${this.escapeSingleQuotes(filters.CID)}'`);
    }
    if (filters.registeredName) {
      mainWhereClauses.push(`p.registeredName = '${this.escapeSingleQuotes(filters.registeredName)}'`);
    }

    // Collect FTS MATCH clauses, one per FTS column (name, description).
    const ftsClauses: string[] = [];
    if (filters.name) {
      const escapedName = this.escapeSingleQuotes(filters.name);
      // for prefix searching, append '*'
      ftsClauses.push(`f.name MATCH '${escapedName}*'`);
    }
    if (filters.description) {
      const escapedDesc = this.escapeSingleQuotes(filters.description);
      ftsClauses.push(`f.description MATCH '${escapedDesc}*'`);
    }

    // If no name/description provided, we skip FTS entirely
    if (ftsClauses.length === 0) {
      let sql = `
          SELECT p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName
          FROM profiles p
      `;
      if (mainWhereClauses.length > 0) {
        sql += ' WHERE ' + mainWhereClauses.join(' AND ');
      }
      sql += ` LIMIT ${config.maxListSize}`;
      return db.prepare(sql).all();
    }

    // We have at least one FTS column to search -> join with `profiles_fts f`.
    let sql = `
      SELECT p.address, p.name, p.description, p.CID, p.lastUpdatedAt, p.registeredName
        FROM profiles_fts f
        JOIN profiles p ON p.rowid = f.rowid
       WHERE
    `;
    // Insert all the FTS column matches with AND
    sql += ftsClauses.join(' AND ');

    // Also append any equality filters
    if (mainWhereClauses.length > 0) {
      sql += ' AND ' + mainWhereClauses.join(' AND ');
    }

    sql += ` LIMIT ${config.maxListSize}`;

    return db.prepare(sql).all();
  }
}
