import { logError } from '../utils/logger';

class EventQueue<T> {
  private queue: T[] = [];
  private isProcessing: boolean = false;

  public enqueue(event: T): void {
    this.queue.push(event);
  }

  public async process(processEvent: (event: T) => Promise<void>): Promise<void> {
    if (this.isProcessing) {
      // If already processing, return to avoid duplicate handling
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift(); // Remove the first event
        if (event) {
          try {
            await processEvent(event); // Process the event
          } catch (err) {
            logError("Error processing event:", err);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

export default EventQueue;
