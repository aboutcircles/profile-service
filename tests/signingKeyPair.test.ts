import { ECDSASigningKeyPair } from "../src/implementations/ecdsaSigningKeyPair";
import { ECDSAPublicKey } from "../src/implementations/ecdsaPublicKey";
import { ethers } from 'ethers';
import { Message } from '../src/implementations/message';
import {privateKey} from "./consts";

describe('ECDSASigningKeyPair', () => {
    const wallet = new ethers.Wallet(privateKey);
    const publicKeyData = wallet.signingKey.publicKey;
    const fingerprint = ethers.keccak256(publicKeyData);

    const publicKey = new ECDSAPublicKey(
        fingerprint,
        Date.now() - 1000, // validFrom
        Date.now() + 100000, // validTo
        publicKeyData,
        null // revokedAt
    );

    const signingKeyPair = new ECDSASigningKeyPair(publicKey, privateKey);

    test('should sign message correctly', async () => {
        const message = new Message(
            wallet.address,
            Date.now(),
            1,
            { data: 'test' }
        );

        const signature = await signingKeyPair.sign(message);

        expect(signature.keyFingerprint).toBe(fingerprint);
        expect(signature.r).toBeDefined();
        expect(signature.s).toBeDefined();
        expect(signature.v).toBeDefined();

        // Verify the signature
        const sig = ethers.Signature.from({
            r: signature.r,
            s: signature.s,
            v: signature.v,
        });

        const recoveredAddress = ethers.recoverAddress(message.messageHash, sig);
        expect(recoveredAddress.toLowerCase()).toBe(wallet.address.toLowerCase());
    });
});
