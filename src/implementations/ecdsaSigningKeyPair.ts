import {IPublicKey} from "../interfaces/publicKey";
import {ISigningKeyPair} from "../interfaces/signingKeyPair";
import {Signature} from "./signature";
import {IMessage} from "../interfaces/message";
import {ethers} from "ethers";

export class ECDSASigningKeyPair implements ISigningKeyPair {
    readonly publicKey: IPublicKey;
    private readonly privateKey: string;

    constructor(publicKey: IPublicKey, privateKey: string) {
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }

    async sign(message: IMessage): Promise<Signature> {
        const wallet = new ethers.Wallet(this.privateKey);
        const signature = wallet.signingKey.sign(message.messageHash);

        // Split the signature into r, s, and v components
        const {r, s, v} = ethers.Signature.from(signature);

        return new Signature(
            this.publicKey.fingerprint,
            r,
            s,
            v
        );
    }
}
