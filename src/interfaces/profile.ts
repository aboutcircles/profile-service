/**
 * Represents a user profile.
 *
 * @interface Profile
 *
 * @property {string} name - The name of the profile.
 * @property {string} [description] - An optional description of the profile.
 * @property {string} [previewImageUrl] - An optional URL to a preview image for the profile.
 * @property {string} [imageUrl] - An optional URL to an image for the profile.
 * @property {Record<string, DataLinkEntry[]>} [customDataLinks] - An optional record of custom data links associated with the profile.
 */
export interface Profile {
    name: string;
    description?: string;
    previewImageUrl?: string;
    imageUrl?: string;
    customDataLinks?: Record<string, DataLinkEntry[]>;
}

/**
 * Determines if the given object is a valid Profile.
 *
 * @param {any} profile - The object to be checked.
 * @return {profile is Profile} - Returns true if the object is a valid Profile; otherwise, false.
 */
export function isProfile(profile: any): profile is Profile {
    return !(!profile ||
        typeof profile.name !== 'string' ||
        (profile.description && typeof profile.description !== 'string') ||
        (profile.previewImageUrl && typeof profile.previewImageUrl !== 'string') ||
        (profile.imageUrl && typeof profile.imageUrl !== 'string') ||
        (profile.customDataLinks &&
            (typeof profile.customDataLinks !== 'object' ||
                Array.isArray(profile.customDataLinks) ||
                !Object.entries(profile.customDataLinks).every(([address, dataLinks]) =>
                    typeof address === 'string' &&
                    Array.isArray(dataLinks) &&
                    dataLinks.every(entry => isDataLinkEntry(entry))
                ))));
}

/**
 * Represents a link entry pointing to data stored in IPFS with associated metadata.
 *
 * @interface
 * @property {string} name - The name of the data link entry.
 * @property {string} cid - The ipfs CIDv0 that identifies the data.
 * @property {string} signature - The signature to verify the data integrity.
 * @property {boolean} encrypted - Indicates if the data is encrypted.
 * @property {string} [encryptionKeyFingerprint] - An optional fingerprint of the encryption key used.
 */
export interface DataLinkEntry {
    name: string;
    cid: string;
    signature: string;
    encrypted: boolean;
    encryptionKeyFingerprint?: string;
}

/**
 * Checks if the provided entry is a valid DataLinkEntry.
 *
 * @param entry - The entry to be checked.
 * @return True if the entry is a DataLinkEntry, false otherwise.
 */
export function isDataLinkEntry(entry: any): entry is DataLinkEntry {
    return !(!entry ||
        typeof entry.name !== 'string' ||
        typeof entry.cid !== 'string' ||
        typeof entry.signature !== 'string' ||
        typeof entry.encrypted !== 'boolean' ||
        (entry.encrypted && typeof entry.encryptionKeyFingerprint !== 'string'));
}