/**
 * Represents a signature of a message.
 */
export class Signature {
    /**
     * The fingerprint of the key that signed the message.
     */
    keyFingerprint: string;

    // r and s are hex strings
    r: string;
    s: string;
    v: number;

    constructor(keyFingerprint: string, r: string, s: string, v: number) {
        this.keyFingerprint = keyFingerprint;
        this.r = r;
        this.s = s;
        this.v = v;
    }
}