class EventQueue<T> {
  private queue: T[] = [];

  public enqueue(event: T): void {
    this.queue.push(event);
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  dequeue() {
    return this.queue.shift();
  }
}

export default EventQueue;
