import {getConfig} from "../src/config";
import fs from "fs";
import path from "path";
import {validateImage} from "../src/validateImage";

describe("validateImage", () => {
    const config = getConfig();

    test("Valid image data URL", async () => {
        const imagePath = path.join(__dirname, "test-images", "valid.png");
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64Data}`;

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(true);
    });

    test("Invalid data URL pattern", async () => {
        const dataUrl = "invalidDataUrl";

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(false);
    });

    test("Image size exceeds limit", async () => {
        const imagePath = path.join(__dirname, "test-images", "large.png");
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString("base64");
        const dataUrl = `data:image/jpg;base64,${base64Data}`;

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(false);
    });

    test("Image has incorrect dimensions", async () => {
        const imagePath = path.join(__dirname, "test-images", "wrong-dimensions.png");
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64Data}`;

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(false);
    });

    test("Image has unsupported format", async () => {
        const imagePath = path.join(__dirname, "test-images", "unsupported.bmp");
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64Data}`;

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(false);
    });

    test("Image format is missing in data URL", async () => {
        const imagePath = path.join(__dirname, "test-images", "valid.png");
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Data = imageBuffer.toString("base64");
        // Omitting the image format in the data URL
        const dataUrl = `data:image;base64,${base64Data}`;

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(false);
    });

    test("Corrupted image data", async () => {
        const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAUA"; // Incomplete base64 data
        const dataUrl = `data:image/png;base64,${base64Data}`;

        const isValid = await validateImage(config, dataUrl);
        expect(isValid).toBe(false);
    });
});
