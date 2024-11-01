/**
 * Generates sequence nonces for messages sent by the operator organization.
 * Nonces must be stored reliably and must be unique for each message sent by the operator organization.
 */
export interface INonceManager {
    /**
     * Returns a sequence nonce for a message sent by the operator organization.
     */
    getNonce(): Promise<number>;
}