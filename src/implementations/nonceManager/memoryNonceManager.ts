import {INonceManager} from "../../interfaces/nonceManager";

export class MemoryNonceManager implements INonceManager {
    private currentNonce: number;

    constructor(initialNonce: number = 0) {
        this.currentNonce = initialNonce;
    }

    async getNonce(): Promise<number> {
        this.currentNonce += 1;
        return this.currentNonce;
    }
}
