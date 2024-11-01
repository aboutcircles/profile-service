import {IPublicKey} from "./publicKey";
import {IMessage} from "./message";
import {Signature} from "../implementations/signature";

/**
 * The current full signing key used by the operator organization.
 */
export interface ISigningKeyPair {
    /**
     * The public part of the key pair.
     */
    publicKey: IPublicKey;

    /**
     * Signs a message with the private key of the operator organization.
     * The signature spans the entire message, including the sender, timestamp, nonce, and payload.
     * @param message The message to sign.
     * @returns The signature of the message.
     */
    sign(message: IMessage): Promise<Signature>;
}