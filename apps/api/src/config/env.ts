export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];

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

/**
 * Reads and validates process configuration once at startup so that
 * misconfiguration fails fast instead of surfacing later in a request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    port: parsePort(env.PORT),
  };
}
