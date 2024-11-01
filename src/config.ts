export type Config = {
    maxNameLength: number;
    defaultTimeout: number;
    ipfs: { protocol: string; port: string | number; host: string };
    maxBatchSize: number;
    imageDimension: number;
    maxImageSizeKB: number;
    imageUrlLength: number;
    descriptionLength: number;
    cacheMaxSize: number;
    corsOrigin: string
};

export const getConfig = (): Config => {
    return {
        ipfs: {
            host: process.env.IPFS_HOST || 'localhost',
            port: process.env.IPFS_PORT || 5001,
            protocol: process.env.IPFS_PROTOCOL || 'http',
        },
        corsOrigin: process.env.CORS_ORIGIN || '*',
        maxImageSizeKB: parseInt(process.env.MAX_IMAGE_SIZE_KB || '150'),
        descriptionLength: parseInt(process.env.DESCRIPTION_LENGTH || '500'),
        imageUrlLength: parseInt(process.env.IMAGE_URL_LENGTH || '2000'),
        imageDimension: parseInt(process.env.IMAGE_DIMENSION || '256'),
        defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '1') * 1000,
        maxNameLength: parseInt(process.env.MAX_NAME_LENGTH || '36'),
        maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '50'),
        cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || '200') // New configurable max size for the cache
    };
}