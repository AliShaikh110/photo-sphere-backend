import type { Request } from 'express';
import { AppError } from '../errors/app-error';

export function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value === 'string') return value;
  throw new AppError('INVALID_ROUTE_PARAMETER', 'A route parameter is invalid.', {
    status: 400,
    path: `params.${name}`
  });
}
