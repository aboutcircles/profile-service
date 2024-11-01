import {ethers} from 'ethers';
import {IPublicKey} from "../interfaces/publicKey";
import {KeyStatus} from "../interfaces/keyStatus";
import {Signature} from "./signature";
import {SignatureVerificationResult} from "../interfaces/signatureVerificationResult";
import {SignatureVerificationError} from "../interfaces/signatureVerificationError";
import {IMessage} from "../interfaces/message";

export class ECDSAPublicKey implements IPublicKey {
    fingerprint: string;
    validFrom: number;
    validTo: number;
    algorithm: 'ECDSA-secp256k1';
    publicKey: string; // Public key as a hex string
    revokedAt: number | null;

    constructor(
        fingerprint: string,
        validFrom: number,
        validTo: number,
        publicKey: string,
        revokedAt: number | null = null
    ) {
        this.fingerprint = fingerprint;
        this.validFrom = validFrom;
        this.validTo = validTo;
        this.algorithm = 'ECDSA-secp256k1';
        this.publicKey = publicKey;
        this.revokedAt = revokedAt;
    }

    get status(): KeyStatus {
        const now = Date.now();
        if (this.revokedAt && this.revokedAt <= now) {
            return 'revoked';
        } else if (this.validTo && this.validTo <= now) {
            return 'expired';
        } else if (this.validFrom > now) {
            return 'notYetValid';
        } else {
            return 'valid';
        }
    }

    async verify(message: IMessage, signature: Signature): Promise<SignatureVerificationResult> {
        const errors: SignatureVerificationError[] = [];

        // Check key status
        if (this.status === 'revoked') {
            errors.push('KeyRevoked');
        }
        if (this.status === 'expired') {
            errors.push('KeyExpired');
        }
        if (this.status === 'notYetValid') {
            errors.push('KeyNotYetValid');
        }

        // Check algorithm
        if (this.algorithm !== 'ECDSA-secp256k1') {
            errors.push('AlgorithmMismatch');
        }

        // Check key fingerprint
        if (signature.keyFingerprint !== this.fingerprint) {
            errors.push('PublicKeyMismatch');
        }

        // Return early if there are errors
        if (errors.length > 0) {
            return {isValid: false, errors};
        }

        // Verify signature
        try {
            const messageHash = message.messageHash;

            // Split the signature using ethers.Signature.from
            const sig = ethers.Signature.from({
                r: signature.r,
                s: signature.s,
                v: signature.v,
            });

            // Recover address
            const recoveredAddress = ethers.recoverAddress(
                ethers.getBytes(messageHash),
                sig
            );

            // Compute public key address
            const publicKeyAddress = ethers.computeAddress(this.publicKey);

            if (recoveredAddress.toLowerCase() !== publicKeyAddress.toLowerCase()) {
                errors.push('SignatureMismatch');
                return {isValid: false, errors};
            }

            return {isValid: true};
        } catch (e) {
            errors.push('VerificationFailed');
            return {isValid: false, errors};
        }
    }
}
