export interface AuthConfig {
  /** HMAC secret for access tokens. Must be at least 32 characters in production. */
  readonly accessSecret: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlDays: number;
  readonly passwordResetTtlMinutes: number;
  readonly issuer: string;
  readonly audience: string;
}

const DEVELOPMENT_SECRET = 'goflow-development-only-secret-do-not-use-in-production';
const MIN_SECRET_LENGTH = 32;

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} "${raw}". Expected a positive integer.`);
  }

  return value;
}

/**
 * Authentication configuration is loaded separately from the base config so
 * that health checks and pure unit tests never need JWT secrets.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const configuredSecret = env.JWT_ACCESS_SECRET;
  const isProduction = nodeEnv === 'production';

  if (
    isProduction &&
    (configuredSecret === undefined || configuredSecret.length < MIN_SECRET_LENGTH)
  ) {
    throw new Error(
      `JWT_ACCESS_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production.`,
    );
  }

  return {
    accessSecret: configuredSecret ?? DEVELOPMENT_SECRET,
    accessTtlSeconds: parsePositiveInt(env.JWT_ACCESS_TTL_SECONDS, 900, 'JWT_ACCESS_TTL_SECONDS'),
    refreshTtlDays: parsePositiveInt(env.REFRESH_TTL_DAYS, 30, 'REFRESH_TTL_DAYS'),
    passwordResetTtlMinutes: parsePositiveInt(
      env.PASSWORD_RESET_TTL_MINUTES,
      60,
      'PASSWORD_RESET_TTL_MINUTES',
    ),
    issuer: 'goflow-api',
    audience: 'goflow-web',
  };
}
