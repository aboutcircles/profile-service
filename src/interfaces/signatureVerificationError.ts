/**
 * The errors that can occur during signature verification.
 */
export type SignatureVerificationError =
    | 'InvalidSignatureFormat'
    | 'KeyNotFound'
    | 'KeyExpired'
    | 'KeyNotYetValid'
    | 'KeyRevoked'
    | 'SignatureMismatch'
    | 'MessageTampered'
    | 'AlgorithmMismatch'
    | 'InvalidNonce'
    | 'InvalidTimestamp'
    | 'PublicKeyMismatch'
    | 'UnsupportedAlgorithm'
    | 'VerificationFailed'
    | 'DeserializationError';