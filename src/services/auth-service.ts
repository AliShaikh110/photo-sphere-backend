import bcrypt from 'bcryptjs';
import { AppError } from '../errors/app-error';
import { User } from '../models/user.model';
import { createAccessToken } from '../auth/tokens';
import { sanitizeRequiredPlainText } from './content-service';

export type AuthResult = {
  user: { id: string; email: string; displayName: string; status: string };
  accessToken: string;
  tokenType: 'Bearer';
};

function publicUser(user: User): AuthResult['user'] {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new AppError('EMAIL_ALREADY_REGISTERED', 'An account already exists for that email address.', {
      status: 409,
      path: 'email'
    });
  }
  const displayName = sanitizeRequiredPlainText(input.displayName, 'displayName');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    email,
    passwordHash,
    displayName,
    status: 'active'
  });
  return {
    user: publicUser(user),
    accessToken: createAccessToken(user),
    tokenType: 'Bearer'
  };
}

export async function loginUser(input: { email: string; password: string }): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const user = await User.findOne({ where: { email } });
  const valid = user?.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !valid || user.status !== 'active') {
    throw new AppError('INVALID_CREDENTIALS', 'The email address or password is incorrect.', { status: 401 });
  }
  return {
    user: publicUser(user),
    accessToken: createAccessToken(user),
    tokenType: 'Bearer'
  };
}
