/**
 * Represents a user profile.
 *
 * @interface Profile
 *
 * @property {string} name - The name of the profile.
 * @property {string} [description] - An optional description of the profile.
 * @property {string} [previewImageUrl] - An optional URL to a preview image for the profile.
 * @property {string} [imageUrl] - An optional URL to an image for the profile.
 */
export interface Profile {
    name: string;
    description?: string;
    previewImageUrl?: string;
    imageUrl?: string;
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
        (profile.imageUrl && typeof profile.imageUrl !== 'string'));
}