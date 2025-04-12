export const logError = (description: string, error?: any) => {
  console.error(`[ERROR] ${description}:`, error);
};
export const logWarn = (...logs: string[]) => {
  console.warn('[WARN]   ', ...logs);
}
export const logInfo = (...logs: string[]) => {
  console.log('[INFO]    ',...logs);
};
export const logDebug = (...logs: string[]) => {
  console.log('[DEBUG]   ',...logs);
};
