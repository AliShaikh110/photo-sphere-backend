import type { Request, Response } from 'express';
import { loginUser, registerUser } from '../services/auth-service';
import { sendData } from '../utils/http-response';

export async function register(request: Request, response: Response): Promise<void> {
  const result = await registerUser(request.body as { email: string; password: string; displayName: string });
  sendData(response, result, { status: 201, message: 'Account created.' });
}

export async function login(request: Request, response: Response): Promise<void> {
  const result = await loginUser(request.body as { email: string; password: string });
  sendData(response, result, { message: 'Signed in.' });
}
