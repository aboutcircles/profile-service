import {SignatureVerificationError} from "./signatureVerificationError";

/**
 * Carries the result of a signature verification.
 */
export interface SignatureVerificationResult {
    /**
     * Whether the signature is valid.
     */
    isValid: boolean;
    /**
     * The errors that occurred during signature verification.
     */
    errors?: SignatureVerificationError[];
}