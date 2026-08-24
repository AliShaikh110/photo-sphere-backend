import pino from 'pino';
import { config } from './index';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'sphere-backend', environment: config.nodeEnv },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      '*.token',
      '*.secret'
    ],
    censor: '[REDACTED]'
  },
  timestamp: pino.stdTimeFunctions.isoTime
});
