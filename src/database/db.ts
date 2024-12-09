import Database from 'better-sqlite3';

import config from '../config/config';

const db = new Database(config.databasePath);

db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
        address TEXT PRIMARY KEY,
        CID TEXT,
        lastUpdatedAt INTEGER,
        name TEXT,
        description TEXT
    );
`);

db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS profiles_search USING FTS5(
        name,
        description,
        content='profiles'
    );
`);

export default db;
