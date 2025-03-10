-- Migration: Add location column to profiles table
-- This migration adds an optional 'location' column (max 100 characters) to the profiles table.
-- It is reversible via the down migration below.

-- Up Migration
BEGIN TRANSACTION;
ALTER TABLE profiles ADD COLUMN location VARCHAR(100);
COMMIT;

-- Down Migration
-- SQLite does not support DROP COLUMN directly.
-- The following steps recreate the original table without the 'location' column.
BEGIN TRANSACTION;
CREATE TABLE profiles_temp (
  address TEXT PRIMARY KEY,
  CID TEXT,
  lastUpdatedAt INTEGER,
  name TEXT,
  description TEXT,
  registeredName TEXT
);
INSERT INTO profiles_temp (address, CID, lastUpdatedAt, name, description, registeredName)
  SELECT address, CID, lastUpdatedAt, name, description, registeredName FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_temp RENAME TO profiles;
COMMIT;
