import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, register } from '../controllers/auth-controller';
import { AppError } from '../errors/app-error';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { loginSchema, registerSchema } from '../validators/request-schemas';

export const authRouter = Router();

authRouter.use(rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, _response, next) => next(
    new AppError('AUTH_RATE_LIMITED', 'Too many authentication attempts.', {
      status: 429,
      retryable: true
    })
  )
}));

authRouter.post('/register', validate('body', registerSchema), asyncHandler(register));
authRouter.post('/login', validate('body', loginSchema), asyncHandler(login));
