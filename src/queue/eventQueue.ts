import Queue from 'bull';

interface EventJob {
  event: any;
  processEvent: (event: any) => Promise<void>;
}

const eventQueue = new Queue<EventJob>('eventQueue');

eventQueue.process(async (job) => {
  const { event, processEvent } = job.data;
  await processEvent(event);
});

export default eventQueue;
