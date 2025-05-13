export const logError = (description: string, error?: any) => {
  console.error(`[ERROR] ${description}:`, error);
};
export const logWarn = (...logs: any[]) => {
  console.warn('[WARN]   ', ...logs);
}
export const logInfo = (...logs: any[]) => {
  console.log('[INFO]    ',...logs);
};
export const logDebug = (...logs: any[]) => {
  console.log('[DEBUG]   ',...logs);
};
