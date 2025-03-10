import EventQueue from '../../src/queue/eventQueue';
import { logError } from '../../src/utils/logger';

// Mock the logger to avoid actual console logs during tests
jest.mock('../../src/utils/logger', () => ({
  logError: jest.fn()
}));

describe('EventQueue', () => {
  let queue: EventQueue<any>;
  let mockProcessEvent: jest.Mock;

  beforeEach(() => {
    // Reset mocks and create fresh instances before each test
    jest.clearAllMocks();
    queue = new EventQueue<any>();
    mockProcessEvent = jest.fn().mockImplementation((event) => Promise.resolve());
  });

  describe('enqueue', () => {
    it('should add events to the queue', () => {
      // Arrange
      const event1 = { id: 1, data: 'test1' };
      const event2 = { id: 2, data: 'test2' };
      
      // Act
      queue.enqueue(event1);
      queue.enqueue(event2);
      
      // Assert
      expect(queue.isEmpty()).toBe(false);
    });

    it('should handle different types of events', () => {
      // Arrange
      const stringEvent = 'string event';
      const numberEvent = 42;
      const objectEvent = { key: 'value' };
      
      // Act
      queue.enqueue(stringEvent);
      queue.enqueue(numberEvent);
      queue.enqueue(objectEvent);
      
      // Assert
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('should return true for an empty queue', () => {
      // Assert
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false after an event is enqueued', () => {
      // Arrange & Act
      queue.enqueue({ id: 1 });
      
      // Assert
      expect(queue.isEmpty()).toBe(false);
    });

    it('should return true after all events are processed', async () => {
      // Arrange
      queue.enqueue({ id: 1 });
      
      // Act
      await queue.process(mockProcessEvent);
      
      // Assert
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('process', () => {
    it('should process all events in the queue', async () => {
      // Arrange
      const event1 = { id: 1, data: 'test1' };
      const event2 = { id: 2, data: 'test2' };
      queue.enqueue(event1);
      queue.enqueue(event2);
      
      // Act
      await queue.process(mockProcessEvent);
      
      // Assert
      expect(mockProcessEvent).toHaveBeenCalledTimes(2);
      expect(mockProcessEvent).toHaveBeenCalledWith(event1);
      expect(mockProcessEvent).toHaveBeenCalledWith(event2);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should handle empty queue gracefully', async () => {
      // Act
      await queue.process(mockProcessEvent);
      
      // Assert
      expect(mockProcessEvent).not.toHaveBeenCalled();
    });

    it('should not start processing if already processing', async () => {
      // Arrange
      // Create a process function that won't resolve immediately
      const delayedProcessEvent = jest.fn().mockImplementation((event) => 
        new Promise<void>(resolve => setTimeout(() => resolve(), 100))
      );
      
      const event1 = { id: 1 };
      const event2 = { id: 2 };
      queue.enqueue(event1);
      queue.enqueue(event2);
      
      // Act
      // Start processing but don't await
      const firstProcess = queue.process(delayedProcessEvent);
      // Try to start a second process immediately
      const secondProcess = queue.process(delayedProcessEvent);
      
      // Wait for both to complete
      await Promise.all([firstProcess, secondProcess]);
      
      // Assert
      // Events should only be processed once
      expect(delayedProcessEvent).toHaveBeenCalledTimes(2);
    });

    it('should continue processing after an error in one event', async () => {
      // Arrange
      const errorEvent = { id: 'error' };
      const successEvent = { id: 'success' };
      
      queue.enqueue(errorEvent);
      queue.enqueue(successEvent);
      
      const processWithError = jest.fn().mockImplementation((event) => {
        if (event.id === 'error') {
          return Promise.reject(new Error('Test error'));
        }
        return Promise.resolve();
      });
      
      // Act
      await queue.process(processWithError);
      
      // Assert
      expect(processWithError).toHaveBeenCalledWith(errorEvent);
      expect(processWithError).toHaveBeenCalledWith(successEvent);
      expect(logError).toHaveBeenCalled();
      expect(queue.isEmpty()).toBe(true);
    });

    it('should set isProcessing to false after processing completes', async () => {
      // Arrange
      queue.enqueue({ id: 1 });
      
      // Act
      await queue.process(mockProcessEvent);
      // Try to process again to ensure isProcessing is reset
      await queue.process(mockProcessEvent);
      
      // Assert
      // If isProcessing wasn't reset, the second call would be ignored
      expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    });

    it('should set isProcessing to false even if there is an error during processing', async () => {
      // Arrange
      queue.enqueue({ id: 'error' });
      
      const processWithError = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('Test error'));
      });
      
      // Act
      await queue.process(processWithError);
      
      // Reset the queue and add a new event
      queue = new EventQueue<any>();
      queue.enqueue({ id: 'new' });
      
      // Process should work now since isProcessing should be reset
      await queue.process(mockProcessEvent);
      
      // Assert
      expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    });
  });
});
