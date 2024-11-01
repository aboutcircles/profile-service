import {Config} from "./config";
import {isValidCid} from "./httpApi/isValidCid";
import {ethers} from "ethers";
import {IProfileValidator} from "./interfaces/profileValidator";
import {isProfile} from "./interfaces/profile";
import {validateImage} from "./validateImage";

export class ProfileValidator implements IProfileValidator {
    private config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    public async validate(profile: any): Promise<string[]> {
        const errors: string[] = [];

        // Ensure profile is an object
        if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
            errors.push("Profile must be an object.");
            return errors;
        }

        // Validate required fields before type checking
        // Validate name
        if (typeof profile.name !== "string" || profile.name.trim().length === 0) {
            errors.push(
                `Name is required and must be a string with a maximum length of ${this.config.maxNameLength} characters.`
            );
        } else if (profile.name.length > this.config.maxNameLength) {
            errors.push(
                `Name must not exceed ${this.config.maxNameLength} characters.`
            );
        }

        // Validate description length if present
        if (profile.description !== undefined && typeof profile.description === "string") {
            if (profile.description.length > this.config.descriptionLength) {
                errors.push(
                    `Description cannot exceed ${this.config.descriptionLength} characters.`
                );
            }
        }

        // Now perform type checking using isProfile
        if (!isProfile(profile)) {
            errors.push("Invalid profile object.");
            return errors;
        }

        // Validate previewImageUrl
        if (profile.previewImageUrl) {
            const isValidImage = await validateImage(
                this.config,
                profile.previewImageUrl
            );
            if (!isValidImage) {
                errors.push(
                    `Invalid preview image data URL, dimensions not ${this.config.imageDimension}x${this.config.imageDimension}, or size exceeds ${this.config.maxImageSizeKB}KB.`
                );
            }
        }

        // Validate imageUrl length
        if (profile.imageUrl && profile.imageUrl.length > this.config.imageUrlLength) {
            errors.push(
                `Image URL cannot exceed ${this.config.imageUrlLength} characters.`
            );
        }

        // Validate customDataLinks
        if (profile.customDataLinks) {
            for (const [address, dataLinks] of Object.entries(profile.customDataLinks)) {
                if (!ethers.isAddress(address)) {
                    errors.push(`Address keys in customDataLinks must be valid addresses.`);
                    continue;
                }

                dataLinks.forEach((entry: any, index: number) => {
                    const entryPath = `customDataLinks["${address}"][${index}]`;

                    // Validate cid
                    if (!isValidCid(entry.cid)) {
                        errors.push(`${entryPath}.cid is required and must be a valid CID.`);
                    }
                });
            }
        }

        return errors;
    }
}