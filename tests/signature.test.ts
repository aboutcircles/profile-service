import {Signature} from "../src/implementations/signature";

describe('Signature', () => {
    const keyFingerprint = 'testFingerprint';
    const r = '0x' + '1'.repeat(64); // 32 bytes hex string
    const s = '0x' + '2'.repeat(64); // 32 bytes hex string
    const v = 27;

    test('should create a Signature object correctly', () => {
        const signature = new Signature(keyFingerprint, r, s, v);

        expect(signature.keyFingerprint).toBe(keyFingerprint);
        expect(signature.r).toBe(r);
        expect(signature.s).toBe(s);
        expect(signature.v).toBe(v);
    });
});
