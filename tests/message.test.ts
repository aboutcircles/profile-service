import {keccak256} from "@ethersproject/keccak256";
import {canonicalize} from 'json-canonicalize';
import {Message} from "../src/implementations/message";

describe('Message', () => {
    const message = new Message(
        '0x1234567890abcdef',
        1609459200, // Jan 1, 2021
        1,
        {data: 'test'}
    );

    const expectedCanonicalJson = canonicalize({
        nonce: 1,
        payload: {data: 'test'},
        sender: '0x1234567890abcdef',
        timestamp: 1609459200
    });

    test('should compute messageHash correctly', () => {
        const dataToHash = Buffer.from(expectedCanonicalJson, 'utf8');
        const expectedHash = keccak256(dataToHash);

        expect(message.messageHash).toBe(expectedHash);
    });

    test('should return a canonical JSON string as messageJson', () => {
        expect(message.messageJson).toBe(expectedCanonicalJson);
    });
});
