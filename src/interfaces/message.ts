/**
 * A message that can be signed by the operator organization.
 * Will be serialized to a Canonical JSON string and hashed with keccak before signing.
 */
export interface IMessage {
    /**
     * The ethereum address of the operator organization that sent the message.
     */
    sender: string;
    /**
     * The creation timestamp of the message.
     */
    timestamp: number;
    /**
     * The nonce of the message. This is a number that increments by one for each message sent by the sender.
     */
    nonce: number;
    /**
     * The payload of the message.
     */
    payload: unknown;

    /**
     * Gets the message as a Canonical JSON string.
     */
    get messageJson(): string;

    /**
     * Gets the Keccak-256 hash of the message.
     * First serializes the message to a Canonical JSON string, then hashes it.
     * @returns The Keccak-256 hash of the message as hex string.
     */
    get messageHash(): string;
}