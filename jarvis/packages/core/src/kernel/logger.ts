import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    // Nunca registrar secretos aunque aparezcan por error en un objeto.
    redact: { paths: ['*.token', '*.apiKey', '*.password', '*.secret', 'headers.authorization'], censor: '[REDACTED]' },
  });
}
