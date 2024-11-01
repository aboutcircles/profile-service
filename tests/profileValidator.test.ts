import {getConfig} from "../src/config";
import {Config} from "../src/config";
import {jest} from "@jest/globals";
import {ProfileValidator} from "../src/profileValidator";
import {validateImage} from "../src/validateImage";

jest.mock("../src/validateImage");
const mockedValidateImage = validateImage as jest.MockedFunction<typeof validateImage>;

describe("ProfileValidator", () => {
    let config: Config;
    let validator: ProfileValidator;

    beforeAll(() => {
        config = getConfig();
        validator = new ProfileValidator(config);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("Happy paths", () => {
        test("Valid profile without customDataLinks", async () => {
            const profile = {
                name: "Alice",
                description: "A blockchain enthusiast",
                previewImageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
                imageUrl: "https://example.com/image.png",
            };

            mockedValidateImage.mockResolvedValue(true);

            const errors = await validator.validate(profile);
            expect(errors).toEqual([]);
        });

        test("Valid profile with customDataLinks", async () => {
            const profile = {
                name: "Bob",
                customDataLinks: {
                    "0xf060ab3d5dCfdC6a0DFd5ca0645ac569b8f105CA": [
                        {
                            name: "preferences",
                            cid: "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB",
                            signature: "0xabcdef1234567890",
                            encrypted: false,
                        },
                    ],
                    "0x0bf1B3d1e6f78b12f26204348ABfCA9310259FfA": [
                        {
                            name: "personalNotes",
                            cid: "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB",
                            signature: "0x123456abcdef7890",
                            encrypted: true,
                            encryptionKeyFingerprint: "0xabc123def456",
                        },
                    ],
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toEqual([]);
        });
    });

    describe("Error conditions", () => {
        test("Name exceeds maximum length", async () => {
            const longName = "A".repeat(config.maxNameLength + 1);
            const profile = {
                name: longName,
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Name must not exceed ${config.maxNameLength} characters.`
            );
        });

        test("Description exceeds maximum length", async () => {
            const longDescription = "D".repeat(config.descriptionLength + 1);
            const profile = {
                name: "Charlie",
                description: longDescription,
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Description cannot exceed ${config.descriptionLength} characters.`
            );
        });

        test("ImageUrl exceeds maximum length", async () => {
            const longUrl = "http://example.com/" + "a".repeat(config.imageUrlLength);
            const profile = {
                name: "Eve",
                imageUrl: longUrl,
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Image URL cannot exceed ${config.imageUrlLength} characters.`
            );
        });

        test("customDataLinks is not an object", async () => {
            const profile = {
                name: "Frank",
                customDataLinks: "notAnObject",
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain("Invalid profile object.");
        });

        test("customDataLinks address is not a string", async () => {
            const profile = {
                name: "Grace",
                customDataLinks: {
                    12345: [],
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                "Address keys in customDataLinks must be valid addresses."
            );
        });

        test("customDataLinks entry is not an array", async () => {
            const profile = {
                name: "Heidi",
                customDataLinks: {
                    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e": "notAnArray",
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain("Invalid profile object.");
        });

        test("customDataLinks entry is not an object", async () => {
            const profile = {
                name: "Ivan",
                customDataLinks: {
                    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e": ["notAnObject"],
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain("Invalid profile object.");
        });

        test("Missing required fields in customDataLinks entry", async () => {
            const profile = {
                name: "Judy",
                customDataLinks: {
                    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e": [
                        {
                            // Missing name, cid, signature, encrypted
                        },
                    ],
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain("Invalid profile object.");
        });

        test("Invalid CID in customDataLinks entry", async () => {
            const profile = {
                name: "Judy",
                customDataLinks: {
                    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e": [
                        {
                            // Invalid CID
                            name: "settings",
                            cid: "invalidCID",
                            signature: "0xabcdef",
                            encrypted: false,
                        },
                    ],
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain("customDataLinks[\"0x742d35Cc6634C0532925a3b844Bc454e4438f44e\"][0].cid is required and must be a valid CID.");
        });

        test("encrypted is true but encryptionKeyFingerprint is missing", async () => {
            const profile = {
                name: "Niaj",
                customDataLinks: {
                    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e": [
                        {
                            name: "secureData",
                            cid: "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB",
                            signature: "0xabcdef",
                            encrypted: true,
                            // encryptionKeyFingerprint is missing
                        },
                    ],
                },
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain("Invalid profile object.");
        });

        test("Profile is null", async () => {
            const profile = null;

            const errors = await validator.validate(profile);
            expect(errors).toContain("Profile must be an object.");
        });

        test("Profile is a string", async () => {
            const profile = "This is not a profile object";

            const errors = await validator.validate(profile);
            expect(errors).toContain("Profile must be an object.");
        });

        test("Profile is a number", async () => {
            const profile = 42;

            const errors = await validator.validate(profile);
            expect(errors).toContain("Profile must be an object.");
        });

        test("Name is not a string (number)", async () => {
            const profile = {
                name: 12345,
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`
            );
        });

        test("Name is not a string (object)", async () => {
            const profile = {
                name: {firstName: "Alice"},
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`
            );
        });

        test("Name is null", async () => {
            const profile = {
                name: null,
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`
            );
        });

        test("Name is an empty string", async () => {
            const profile = {
                name: "",
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Name is required and must be a string with a maximum length of ${config.maxNameLength} characters.`
            );
        });

        test("Name is too long", async () => {
            const profile = {
                name: "A".repeat(config.maxNameLength + 1),
            };

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Name must not exceed ${config.maxNameLength} characters.`
            );
        });

        test("previewImageUrl is an invalid data URL", async () => {
            const profile = {
                name: "Test User",
                previewImageUrl: "invalidDataUrl",
            };

            mockedValidateImage.mockResolvedValue(false);

            const errors = await validator.validate(profile);
            expect(errors).toContain(
                `Invalid preview image data URL, dimensions not ${config.imageDimension}x${config.imageDimension}, or size exceeds ${config.maxImageSizeKB}KB.`
            );
        });
    });
});
