import type { Response } from 'express';

export function sendData(
  response: Response,
  data: unknown,
  options: { status?: number; message?: string } = {}
): void {
  response.status(options.status ?? 200).json({
    success: true,
    data,
    ...(options.message === undefined ? {} : { message: options.message })
  });
}
