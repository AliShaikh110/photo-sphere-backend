import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type RequestTarget = 'body' | 'params' | 'query';

export function validate(target: RequestTarget, schema: ZodType): RequestHandler {
  return (request, _response, next) => {
    const parsed = schema.parse(request[target]);
    Object.assign(request[target], parsed);
    next();
  };
}
