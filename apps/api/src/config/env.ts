export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];

const MIN_SECRET_LENGTH = 32;

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined || raw === '') {
    return 'development';
  }

  if (!NODE_ENVS.includes(raw as NodeEnv)) {
    throw new Error(`Invalid NODE_ENV "${raw}". Expected one of: ${NODE_ENVS.join(', ')}.`);
  }

  return raw as NodeEnv;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return 3000;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT "${raw}". Expected an integer between 1 and 65535.`);
  }

  return port;
}

function parseTtl(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} "${raw}". Expected a positive integer number of seconds.`);
  }

  return value;
}

function requireString(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    throw new Error(`${name} is required. See .env.example for the expected format.`);
  }

  return raw;
}

/**
 * Reads and validates process configuration once at startup so that
 * misconfiguration fails fast instead of surfacing later in a request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = requireString('JWT_SECRET', env.JWT_SECRET);

  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -base64 48`,
    );
  }

  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    port: parsePort(env.PORT),
    databaseUrl: requireString('DATABASE_URL', env.DATABASE_URL),
    jwtSecret,
    accessTokenTtlSeconds: parseTtl('ACCESS_TOKEN_TTL_SECONDS', env.ACCESS_TOKEN_TTL_SECONDS, 900),
    refreshTokenTtlSeconds: parseTtl(
      'REFRESH_TOKEN_TTL_SECONDS',
      env.REFRESH_TOKEN_TTL_SECONDS,
      60 * 60 * 24 * 30,
    ),
  };
}
