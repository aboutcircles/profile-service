export const logError = (description: string, error?: any) => {
  console.error(`${description}:`, error);
};
export const logInfo = (...logs: string[]) => {
  console.log(...logs);
};
