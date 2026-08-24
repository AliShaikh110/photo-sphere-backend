import type { Express } from 'express';
import request from 'supertest';

export type TestIdentity = {
  id: string;
  email: string;
  accessToken: string;
};

export async function registerIdentity(
  app: Express,
  label: string,
  password = 'correct-horse-battery-staple'
): Promise<TestIdentity> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, displayName: label })
    .expect(201);
  return {
    id: response.body.data.user.id as string,
    email,
    accessToken: response.body.data.accessToken as string
  };
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
