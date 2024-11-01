import fs from 'fs';
import {INonceManager} from "../../interfaces/nonceManager";

export class FileNonceManager implements INonceManager {
    private readonly filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    async getNonce(): Promise<number> {
        let fileDescriptor: number;
        let nonce: number;

        if (!fs.existsSync(this.filePath)) {
            // Create and set nonce to 1
            fileDescriptor = fs.openSync(this.filePath, 'wx+');
            nonce = 1;
        } else {
            // Read nonce from file and increment
            fileDescriptor = fs.openSync(this.filePath, 'r+');

            const nonceJsonData = fs.readFileSync(fileDescriptor, 'utf-8');
            const parsedNonceData = JSON.parse(nonceJsonData);
            nonce = parsedNonceData.nonce + 1;
        }

        // clear file and write new nonce
        fs.ftruncateSync(fileDescriptor, 0);
        fs.writeSync(fileDescriptor, JSON.stringify({nonce: nonce}), 0, 'utf-8');
        fs.closeSync(fileDescriptor);

        return nonce;
    }
}
