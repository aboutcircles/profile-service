import {KeyStatus} from "./keyStatus";
import {IMessage} from "./message";
import {Signature} from "../implementations/signature";
import {SignatureVerificationResult} from "./signatureVerificationResult";
import {Algorithm} from "./algorithm";

/**
 * A public key used to verify the authenticity of data signed by the operator organization.
 * The operator organization may have multiple signing keys that are rotated over time.
 * Whenever a new signing key is added, the previous signing key is invalidated.
 */
export interface IPublicKey {
    /**
     * The fingerprint of the public key.
     */
    fingerprint: string;
    /**
     * The key becomes valid at this timestamp.
     */
    validFrom: number;
    /**
     * The key is invalid after this timestamp.
     */
    validTo: number;
    /**
     * The algorithm used to sign messages with this key.
     */
    algorithm: Algorithm;
    /**
     * The actual public key.
     */
    publicKey: string;
    /**
     * Whether the key has been revoked.
     */
    revokedAt: number | null;

    /**
     * The status of the key.
     */
    get status(): KeyStatus;

    /**
     * Verifies the signature of a message.
     * This includes checking:
     * * if the used key was valid at the time of signing
     *   * if the key was revoked
     *   * if the key was expired
     *   * if the key was not yet valid
     *   * if the algorithm used to sign the message matches the algorithm of the key
     * The user of this function must ensure that the nonce of the message has the expected value.
     * @param message The message to verify.
     * @param signature The signature to verify.
     * @returns The result of the signature verification.
     */
    verify(message: IMessage, signature: Signature): Promise<SignatureVerificationResult>;
}