export default {
  up(db: any) {
    // 1) Create an FTS5 virtual table referencing the same data as `profiles`
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS profiles_fts USING fts5(
        name,
        description,
        location,
        content='profiles',
        content_rowid='rowid'
      );
    `);

    // 2) Seed the FTS table with existing data
    db.exec(`
      INSERT INTO profiles_fts(rowid, name, description, location)
      SELECT rowid, name, description, location FROM profiles;
    `);

    // 3) Create triggers so `profiles_fts` stays in sync with `profiles`
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS profiles_ai
      AFTER INSERT ON profiles
      BEGIN
        INSERT INTO profiles_fts(rowid, name, description, location)
        VALUES (new.rowid, new.name, new.description, new.location);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS profiles_ad
      AFTER DELETE ON profiles
      BEGIN
        DELETE FROM profiles_fts
        WHERE rowid = old.rowid;
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS profiles_au
      AFTER UPDATE ON profiles
      BEGIN
        UPDATE profiles_fts
        SET name = new.name,
            description = new.description,
            location = new.location
        WHERE rowid = old.rowid;
      END;
    `);
  }
};
