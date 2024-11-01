import {IMessage} from "../interfaces/message";
import {canonicalize} from "json-canonicalize";
import {keccak256} from "@ethersproject/keccak256";

export class Message<T> implements IMessage {
    sender: string;
    timestamp: number;
    nonce: number;
    payload: T;

    constructor(
        sender: string,
        timestamp: number,
        nonce: number,
        payload: T
    ) {
        this.sender = sender;
        this.timestamp = timestamp;
        this.nonce = nonce;
        this.payload = payload;
    }

    get messageJson(): string {
        return canonicalize({
            sender: this.sender,
            timestamp: this.timestamp,
            nonce: this.nonce,
            payload: this.payload
        });
    }

    get messageHash(): string {
        const dataToHash = Buffer.from(this.messageJson, 'utf8');
        return keccak256(dataToHash);
    }
}