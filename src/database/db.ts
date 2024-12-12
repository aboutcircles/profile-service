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
    CREATE INDEX IF NOT EXISTS idx_profiles_CID ON profiles (CID);
`);

export default db;
