import db from '../database/db';
import config from "../config/config";

export type DownloadQueueItem = {
    rowid: number;
    cid: string;
    status: string;
    tries: number;
    createdAt: number;
};

export class DownloadQueue {
    private insertStmt = db.prepare(`
        INSERT INTO download_queue (address, cid)
        VALUES (?, ?)
    `);

    private getAndMarkInProgressStmt = db.prepare(`
        UPDATE download_queue
        SET status = 'in_progress'
        WHERE rowid = (SELECT rowid
                       FROM download_queue
                       WHERE status = 'pending'
                       ORDER BY rowid ASC
                       LIMIT 1)
          AND status = 'pending'
        RETURNING rowid, address, cid, status, tries, createdAt
    `);

    private markSuccessStmt = db.prepare(`
        UPDATE download_queue
        SET status = 'success'
        WHERE rowid = ?
    `);

    private markFailedStmt = db.prepare(`
        UPDATE download_queue
        SET status = 'failed'
        WHERE rowid = ?
    `);

    private incrementTriesStmt = db.prepare(`
        UPDATE download_queue
        SET tries  = tries + 1,
            status = 'pending'
        WHERE rowid = ?
    `);

    constructor(
        private maxRetries: number = config.maxProfileFetchRetries
    ) {
    }

    /**
     * Retrieves and atomically marks the next pending task as "in_progress."
     * Returns null if no pending tasks remain.
     */
    public getNext(): DownloadQueueItem | null {
        const item = this.getAndMarkInProgressStmt.get() as DownloadQueueItem | undefined;
        return item || null;
    }

    /**
     * Enqueues a new task identified by its CID, initially in "pending" status.
     */
    public enqueue(cid: string): void {
        this.insertStmt.run(cid);
    }

    /**
     * Marks a task as successfully processed.
     */
    public markSuccess(rowid: number): void {
        this.markSuccessStmt.run(rowid);
    }

    /**
     * Marks a task as errored. If the maximum number of retries has not been reached,
     * the task is returned to "pending" status with an incremented attempt count.
     * Otherwise, it is marked as "failed."
     */
    public markError(rowid: number, currentTries: number): void {
        const newTries = currentTries + 1;
        if (newTries < this.maxRetries) {
            this.incrementTriesStmt.run(rowid);
        } else {
            this.markFailedStmt.run(rowid);
        }
    }
}
