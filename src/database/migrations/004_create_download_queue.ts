import {logInfo} from '../../utils/logger';

export default {
    up(db: any) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS download_queue
            (
                rowid     INTEGER PRIMARY KEY AUTOINCREMENT,
                address   TEXT    NOT NULL,
                cid       TEXT    NOT NULL,
                status    TEXT    NOT NULL DEFAULT 'pending',
                tries     INTEGER NOT NULL DEFAULT 0,
                createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            )
        `);

        logInfo('Created download_queue table.');
    }
};
