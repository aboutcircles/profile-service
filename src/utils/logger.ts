export const logError = (description: string, error: any) => {
  console.error(`${description}:`, error);
};
export const logInfo = (description: string, error: any) => {
  console.info(`${description}:`, error.message);
};
