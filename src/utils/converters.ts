import multihashes from 'multihashes';

export function convertMetadataDigestToCID(metadataDigest: string): string {
  const uint8Array = hexStringToUint8Array(remove0xPrefix(metadataDigest));

  return uint8ArrayToCidV0(uint8Array);
}

export function remove0xPrefix(hexString: string): string {
  return hexString.replace(/^0x/, '');
}

/**
 * Converts a hex string to a Uint8Array.
 * @param {string} hexString - The hex string to convert.
 * @returns {Uint8Array} - The resulting Uint8Array.
 */
export function hexStringToUint8Array(hexString: string): Uint8Array {
  const bytes = [];
  for (let i = 0; i < hexString.length; i += 2) {
    bytes.push(parseInt(hexString.substr(i, 2), 16));
  }
  return new Uint8Array(bytes);
}

/**
 * Converts a 32-byte UInt8Array back to a CIDv0 string by adding the hashing algorithm identifier.
 * @param {Uint8Array} uint8Array - The 32-byte hash digest.
 * @returns {string} - The resulting CIDv0 string (e.g., Qm...).
 */
export function uint8ArrayToCidV0(uint8Array: Uint8Array): string {
  if (uint8Array.length !== 32) {
    throw new Error('Invalid array length. Expected 32 bytes.');
  }

  // Recreate the Multihash (prefix with SHA-256 code and length)
  const multihashBytes = multihashes.encode(uint8Array, 'sha2-256');

  // Encode the Multihash as a base58 CIDv0 string
  return multihashes.toB58String(multihashBytes);
}

export function convertBigIntToString(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  } else if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, convertBigIntToString(value)])
    );
  }

  return obj;
}
