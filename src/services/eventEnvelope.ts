export interface EventEnvelope<TEvent = any> {
    event: TEvent;
    retries: number; // how many times we've *attempted* to process this event
}