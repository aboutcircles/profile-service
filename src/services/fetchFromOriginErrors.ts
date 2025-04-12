export class BlacklistedCidError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BlacklistedCidError';
    }
}

export class GatewayError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = 'GatewayError';
        this.statusCode = statusCode;
    }
}

export class FetchTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FetchTimeoutError';
    }
}

export class ResponseSizeExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ResponseSizeExceededError';
    }
}

export class InvalidJSONError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidJSONError';
    }
}

export class ProfileValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProfileValidationError';
    }
}
