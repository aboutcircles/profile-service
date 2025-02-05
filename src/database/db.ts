import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { logError } from '../utils/logger';
import config from '../config/config';

const db = new Database(config.databasePath);

// Create migrations table
db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Create initial profiles table
db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
        address TEXT PRIMARY KEY,
        CID TEXT,
        lastUpdatedAt INTEGER,
        name TEXT,
        description TEXT,
        registeredName TEXT
    );
`);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_profiles_CID ON profiles (CID);
`);

// Migration runner
const runMigrations = () => {
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Create migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
        fs.mkdirSync(migrationsDir, { recursive: true });
    }

    type MigrationRecord = {
        name: string;
    };

    // Get list of applied migrations
    const appliedMigrations = db.prepare('SELECT name FROM migrations ORDER BY id').all() as MigrationRecord[];
    const appliedMigrationNames = new Set(appliedMigrations.map(m => m.name));

    // Get all migration files
    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.js'))
        .sort();

    // Run pending migrations
    for (const migrationFile of migrationFiles) {
        if (!appliedMigrationNames.has(migrationFile)) {
            const migration = require(path.join(migrationsDir, migrationFile)).default;
            
            try {
                // Begin transaction
                db.exec('BEGIN TRANSACTION');
                
                // Run migration
                migration.up(db);
                
                // Record migration
                db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationFile);
                
                // Commit transaction
                db.exec('COMMIT');
                
                console.log(`Applied migration: ${migrationFile}`);
            } catch (error) {
                // Rollback on error
                db.exec('ROLLBACK');
                logError(`Failed to apply migration ${migrationFile}:`, error);
                throw error;
            }
        }
    }
};

// Run migrations on startup
runMigrations();

export default db;
