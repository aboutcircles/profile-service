import {Config} from "./config";
import sharp from "sharp";

export const validateImage = async (config: Config, dataUrl: string): Promise<boolean> => {
    const dataUrlPattern = /^data:image\/(png|jpeg|jpg|gif);base64,/;
    if (!dataUrlPattern.test(dataUrl)) {
        console.error('Invalid data URL pattern');
        return false;
    }

    const base64Data = dataUrl.replace(dataUrlPattern, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > config.maxImageSizeKB * 1024) {
        console.error('Image size exceeds limit');
        return false;
    }

    try {
        const image = sharp(buffer);
        const {width, height, format} = await image.metadata();
        return !(width !== config.imageDimension || height !== config.imageDimension || !['png', 'jpeg', 'gif'].includes(format ?? ''));
    } catch (error) {
        console.error('Failed to read image metadata', error);
        return false;
    }
};