import { Request, Response, NextFunction } from 'express';
import { logError } from './logger';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  logError(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
}
