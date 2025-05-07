export default {
  up(db: any) {
    // 1) Drop existing FTS table and its triggers
      db.exec(`
        DROP TRIGGER IF EXISTS profiles_ai;
        DROP TRIGGER IF EXISTS profiles_ad;
        DROP TRIGGER IF EXISTS profiles_au;
        DROP TABLE IF EXISTS profiles_fts;
      `);

      // 2) Create new FTS5 virtual table with all searchable columns
      db.exec(`
        CREATE VIRTUAL TABLE profiles_fts USING fts5(
          name,
          description,
          location,
          content='profiles',
          content_rowid='rowid'
        );
      `);

      // 3) Seed the FTS table with existing data, handling NULLs
      db.exec(`
        INSERT INTO profiles_fts(rowid, name, description, location)
        SELECT 
          rowid,
          COALESCE(name, ''),
          COALESCE(description, ''),
          COALESCE(location, '')
        FROM profiles;
      `);

      // 4) Create improved triggers with NULL handling
      db.exec(`
        CREATE TRIGGER profiles_ai AFTER INSERT ON profiles BEGIN
          INSERT INTO profiles_fts(rowid, name, description, location)
          VALUES (
            new.rowid,
            COALESCE(new.name, ''),
            COALESCE(new.description, ''),
            COALESCE(new.location, '')
          );
        END;
      `);

      db.exec(`
        CREATE TRIGGER profiles_ad AFTER DELETE ON profiles BEGIN
          INSERT INTO profiles_fts(profiles_fts, rowid, name, description, location)
          VALUES('delete', old.rowid, old.name, old.description, old.location);
        END;
      `);

      db.exec(`
        CREATE TRIGGER profiles_au AFTER UPDATE ON profiles BEGIN
          INSERT INTO profiles_fts(profiles_fts, rowid, name, description, location)
          VALUES(
            'delete',
            old.rowid,
            old.name,
            old.description,
            old.location
          );
          INSERT INTO profiles_fts(rowid, name, description, location)
          VALUES (
            new.rowid,
            COALESCE(new.name, ''),
            COALESCE(new.description, ''),
            COALESCE(new.location, '')
          );
        END;
      `);

  }
};
