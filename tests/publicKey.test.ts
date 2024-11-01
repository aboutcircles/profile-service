import {ECDSAPublicKey} from "../src/implementations/ecdsaPublicKey";
import {Signature} from "../src/implementations/signature";
import {Message} from "../src/implementations/message";
import {ECDSASigningKeyPair} from "../src/implementations/ecdsaSigningKeyPair";
import {ethers} from 'ethers';
import {privateKey} from "./consts";

describe('ECDSAPublicKey', () => {
    const wallet = new ethers.Wallet(privateKey);
    const publicKeyData = wallet.signingKey.publicKey;
    const fingerprint = ethers.keccak256(publicKeyData);

    const validFrom = Date.now() - 1000;
    const validTo = Date.now() + 100000;
    const revokedAt = null;

    const publicKey = new ECDSAPublicKey(
        fingerprint,
        validFrom,
        validTo,
        publicKeyData,
        revokedAt
    );

    const signingKeyPair = new ECDSASigningKeyPair(publicKey, privateKey);

    const message = new Message(
        wallet.address,
        Date.now(),
        1,
        {data: 'test'}
    );

    test('should verify signature successfully with valid key', async () => {
        const signature = await signingKeyPair.sign(message);

        const result = await publicKey.verify(message, signature);
        expect(result.isValid).toBe(true);
        expect(result.errors).toBeUndefined();
    });

    test('should fail verification if key is revoked', async () => {
        const revokedPublicKey = new ECDSAPublicKey(
            fingerprint,
            validFrom,
            validTo,
            publicKeyData,
            Date.now() - 1000 // Revoked in the past
        );

        const signature = await signingKeyPair.sign(message);

        const result = await revokedPublicKey.verify(message, signature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('KeyRevoked');
    });

    test('should fail verification if key is expired', async () => {
        const expiredPublicKey = new ECDSAPublicKey(
            fingerprint,
            validFrom,
            Date.now() - 1000, // Expired in the past
            publicKeyData,
            revokedAt
        );

        const signature = await signingKeyPair.sign(message);

        const result = await expiredPublicKey.verify(message, signature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('KeyExpired');
    });

    test('should fail verification if key is not yet valid', async () => {
        const notYetValidPublicKey = new ECDSAPublicKey(
            fingerprint,
            Date.now() + 10000, // Valid in the future
            validTo,
            publicKeyData,
            revokedAt
        );

        const signature = await signingKeyPair.sign(message);

        const result = await notYetValidPublicKey.verify(message, signature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('KeyNotYetValid');
    });

    test('should fail verification if algorithm mismatches', async () => {
        const publicKeyInstance = new ECDSAPublicKey(
            fingerprint,
            validFrom,
            validTo,
            publicKeyData,
            revokedAt
        );

        // Intentionally set an incorrect algorithm
        (publicKeyInstance as any).algorithm = 'RSA';

        const signature = await signingKeyPair.sign(message);

        const result = await publicKeyInstance.verify(message, signature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('AlgorithmMismatch');
    });

    test('should fail verification if key fingerprint mismatches', async () => {
        const differentFingerprint = ethers.keccak256('0xabcdef'); // Different fingerprint
        const publicKeyInstance = new ECDSAPublicKey(
            differentFingerprint,
            validFrom,
            validTo,
            publicKeyData,
            revokedAt
        );

        const signature = await signingKeyPair.sign(message);

        const result = await publicKeyInstance.verify(message, signature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('PublicKeyMismatch');
    });

    test('should fail verification if signature is invalid (tampered message)', async () => {
        const signature = await signingKeyPair.sign(message);

        // Tamper with the message payload
        const tamperedMessage = new Message(
            wallet.address,
            message.timestamp,
            message.nonce,
            {data: 'tampered data'}
        );

        const result = await publicKey.verify(tamperedMessage, signature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('SignatureMismatch');
    });

    test('should fail verification if signature is malformed', async () => {
        const signature = await signingKeyPair.sign(message);

        // Malform the signature by altering the 'r' component
        const malformedSignature = new Signature(
            signature.keyFingerprint,
            '0x0', // Invalid 'r' value
            signature.s,
            signature.v
        );

        const result = await publicKey.verify(message, malformedSignature);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('VerificationFailed');
    });
});
