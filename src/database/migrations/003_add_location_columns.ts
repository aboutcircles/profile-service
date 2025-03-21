import { Database } from 'better-sqlite3';

export default {
  up: (db: any) => {
    // Check if the location column exists
    const locationExists = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('profiles') 
      WHERE name = 'location'
    `).get().count > 0;

    // Check if the longitude column exists
    const longitudeExists = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('profiles') 
      WHERE name = 'longitude'
    `).get().count > 0;

    // Check if the latitude column exists
    const latitudeExists = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('profiles') 
      WHERE name = 'latitude'
    `).get().count > 0;

    // Add the location column if it doesn't exist
    if (!locationExists) {
      db.prepare(`ALTER TABLE profiles ADD COLUMN location TEXT`).run();
      console.log('Added location column to profiles table');
    }

    // Add the longitude column if it doesn't exist
    if (!longitudeExists) {
      db.prepare(`ALTER TABLE profiles ADD COLUMN longitude REAL`).run();
      console.log('Added longitude column to profiles table');
    }

    // Add the latitude column if it doesn't exist
    if (!latitudeExists) {
      db.prepare(`ALTER TABLE profiles ADD COLUMN latitude REAL`).run();
      console.log('Added latitude column to profiles table');
    }
  }
};
