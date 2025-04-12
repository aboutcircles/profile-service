import {logInfo} from "../../utils/logger";

export default {
  up(db: any) {
    // Get the list of existing columns in the profiles table
    const tableInfo = db.prepare(`PRAGMA table_info(profiles)`).all();
    const existingColumns = tableInfo.map((col: any) => col.name);
    
    // Add columns that don't already exist
    if (!existingColumns.includes('location')) {
      db.prepare(`ALTER TABLE profiles ADD COLUMN location TEXT`).run();
      logInfo('Added location column to profiles table');
    }
    
    if (!existingColumns.includes('longitude')) {
      db.prepare(`ALTER TABLE profiles ADD COLUMN longitude REAL`).run();
      logInfo('Added longitude column to profiles table');
    }
    
    if (!existingColumns.includes('latitude')) {
      db.prepare(`ALTER TABLE profiles ADD COLUMN latitude REAL`).run();
      logInfo('Added latitude column to profiles table');
    }
    
    // Create an index on latitude and longitude for efficient geospatial queries
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_profiles_coordinates ON profiles(latitude, longitude)`).run();

    // Save existing FTS data
    db.prepare('CREATE TEMPORARY TABLE fts_backup(rowid INTEGER PRIMARY KEY, name TEXT, description TEXT)').run();
    db.prepare('INSERT INTO fts_backup SELECT rowid, name, description FROM profiles_fts').run();
    
    // Drop existing triggers
    db.prepare(`DROP TRIGGER IF EXISTS profiles_ai`).run();
    db.prepare(`DROP TRIGGER IF EXISTS profiles_au`).run();
    db.prepare(`DROP TRIGGER IF EXISTS profiles_ad`).run();
    
    // Drop the existing FTS table
    db.prepare('DROP TABLE profiles_fts').run();
    
    // Create a new FTS table with location column and tokenizer configuration
    db.prepare(`
      CREATE VIRTUAL TABLE profiles_fts USING fts5(
        name,
        description,
        location,
        content='profiles',
        content_rowid='rowid',
        tokenize="unicode61 tokenchars '-,'"
      )
    `).run();
    
    // Restore the data with location values from profiles table
    db.prepare(`
      INSERT INTO profiles_fts(rowid, name, description, location)
      SELECT b.rowid, b.name, b.description, p.location
      FROM fts_backup b
      LEFT JOIN profiles p ON b.rowid = p.rowid
    `).run();
    
    // Drop the temporary backup table
    db.prepare('DROP TABLE fts_backup').run();
    
    // Create the updated triggers
    db.prepare(`
      CREATE TRIGGER profiles_ai
      AFTER INSERT ON profiles
      BEGIN
        INSERT INTO profiles_fts(rowid, name, description, location)
        VALUES (new.rowid, new.name, new.description, new.location);
      END
    `).run();
    
    db.prepare(`
      CREATE TRIGGER profiles_au
      AFTER UPDATE ON profiles
      BEGIN
        DELETE FROM profiles_fts WHERE rowid = old.rowid;
        INSERT INTO profiles_fts(rowid, name, description, location)
        VALUES (new.rowid, new.name, new.description, new.location);
      END
    `).run();
    
    db.prepare(`
      CREATE TRIGGER profiles_ad
      AFTER DELETE ON profiles
      BEGIN
        DELETE FROM profiles_fts WHERE rowid = old.rowid;
      END
    `).run();
  
    logInfo('Location-related migration with improved symbol support completed successfully');
  }
};
