import db from '../database/db';
import {Profile} from '../types';
import config from "../config/config";

export class DbReader {
    sanitizeFtsInput(input: string): string {
        return input.replace(/"/g, '');
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
    }): Profile[] {
        const hasFts = !!(filters.name || filters.description || filters.location);

        if (!hasFts) {
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

            sql += ' LIMIT ?';
            params.push(config.maxListSize);

            const results = db.prepare(sql).all(params);

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

                if (row.longitude !== null && row.latitude !== null) {
                    profile.geoLocation = [row.longitude, row.latitude];
                }

                return profile;
            });
        } else {
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

            if (filters.name) {
                conditions.push('f.name MATCH ?');
                const sanitized = this.sanitizeFtsInput(filters.name);
                params.push(`"${sanitized}"*`);
            }
            if (filters.description) {
                conditions.push('f.description MATCH ?');
                const sanitized = this.sanitizeFtsInput(filters.description);
                params.push(`"${sanitized}"*`);
            }
            if (filters.location) {
                conditions.push('f.location MATCH ?');
                const sanitized = this.sanitizeFtsInput(filters.location);
                params.push(`"${sanitized}"*`);
            }

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

            sql += conditions.join(' AND ');
            sql += ' LIMIT ?';
            params.push(config.maxListSize);

            const results = db.prepare(sql).all(params);

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

                if (row.longitude !== null && row.latitude !== null) {
                    profile.geoLocation = [row.longitude, row.latitude];
                }

                return profile;
            });
        }
    }
}