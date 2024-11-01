import {MemoryNonceManager} from "../src/implementations/nonceManager/memoryNonceManager";
import {FileNonceManager} from "../src/implementations/nonceManager/fileNonceManager";
import fs from "fs";

describe('MemoryNonceManager', () => {
    const nonceManager = new MemoryNonceManager();

    test('should generate unique nonces sequentially', async () => {
        const nonce1 = await nonceManager.getNonce();
        const nonce2 = await nonceManager.getNonce();
        const nonce3 = await nonceManager.getNonce();

        expect(nonce1).toBe(1);
        expect(nonce2).toBe(2);
        expect(nonce3).toBe(3);
    });
});

describe('FileNonceManager', () => {
    const fileNonceManager = new FileNonceManager("testNonceFile.json");

    afterAll(() => {
        fs.rmSync("testNonceFile.json");
    });

    beforeEach(() => {
        if (fs.existsSync("testNonceFile.json")) {
            fs.rmSync("testNonceFile.json");
        }
    });

    test('It should generate unique nonces sequentially and persist the last nonce to the file', async () => {
        await fileNonceManager.getNonce();
        await fileNonceManager.getNonce();
        await fileNonceManager.getNonce();

        const fileContent = fs.readFileSync("testNonceFile.json", "utf-8");
        const nonceObj = JSON.parse(fileContent);

        expect(nonceObj.nonce).toBe(3);
    });
});

