import type { Statement } from 'better-sqlite3';
import db from '../database/db';

export class DbMetadata {
    private getLastProcessedBlockStmt: Statement<any[], { lastProcessed: number }> = db.prepare(`
        SELECT MAX(lastUpdatedAt) AS lastProcessed
        FROM profiles;
    `);

    private getLastProcessedBlockForAddressStmt: Statement<any[], { lastProcessed: number }> = db.prepare(`
        SELECT MAX(lastUpdatedAt) AS lastProcessed
        FROM profiles
        WHERE address = ?;
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

    getLastProcessedBlockForAddress(address: string): number {
        return this.getLastProcessedBlockForAddressStmt.get(address)?.lastProcessed || 0;
    }

    hasProfile(address: string): boolean {
        return this.hasProfileStmt.get(address) !== undefined;
    }
}
