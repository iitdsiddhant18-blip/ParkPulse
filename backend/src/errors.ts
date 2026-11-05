import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

interface MysqlLikeError {
  errno?: number;
  code?: string;
  sqlState?: string;
  sqlMessage?: string;
  message?: string;
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues
      .map((i) => `${i.path.join('.') || 'body'}:${i.message}`)
      .join('; ');
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: details },
    });
    return;
  }

  const dbErr = err as MysqlLikeError;
  if (typeof dbErr?.errno === 'number') {
    const msg = dbErr.sqlMessage || dbErr.message || 'Database error';

    if (dbErr.errno === 1062) {
      res.status(409).json({
        error: { code: 'DUPLICATE_ENTRY', message: msg },
      });
      return;
    }

    if (dbErr.errno === 1451) {
      res.status(409).json({
        error: {
          code: 'RESOURCE_IN_USE',
          message: 'Cannot delete record because it is referenced by existing records',
        },
      });
      return;
    }

    if (dbErr.errno === 1452) {
      res.status(400).json({
        error: {
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Referenced parent record does not exist',
        },
      });
      return;
    }

    if (dbErr.errno === 3819 || dbErr.errno === 1265) {
      res.status(400).json({
        error: { code: 'CONSTRAINT_VIOLATION', message: msg },
      });
      return;
    }

    if (dbErr.errno === 1644 || dbErr.sqlState === '45000') {
      const isConflict = msg.toLowerCase().includes('overlapping');
      res.status(isConflict ? 409 : 400).json({
        error: {
          code: isConflict ? 'SLOT_OVERLAP' : 'BUSINESS_RULE_VIOLATION',
          message: msg,
        },
      });
      return;
    }
  }

  const fallbackMsg = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: fallbackMsg },
  });
}

