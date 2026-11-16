/**
 * A deliberately small API client for the public landing page. The dashboard
 * will grow a richer client later; this one only covers the endpoints the
 * sign-in/sign-up dialog needs.
 */

const API_BASE = '/api/v1';
const STORAGE_KEY = 'goflow.session';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  timezone: string;
  currency: string;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthProfile {
  user: User;
  memberships: Array<{
    id: string;
    role: string;
    workspace: { id: string; name: string; slug: string } | null;
  }>;
}

export interface RegisterResult {
  user: User;
  workspace: unknown;
  tokens: TokenPair;
}

export interface Session {
  user: User;
  tokens: TokenPair;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the GoFlow API. Check your connection and try again.',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? null,
      error?.message ?? 'Something went wrong. Please try again.',
    );
  }

  return body as T;
}

export function login(input: { email: string; password: string }): Promise<TokenPair> {
  return request<TokenPair>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function register(input: {
  name: string;
  email: string;
  password: string;
  businessName?: string;
}): Promise<RegisterResult> {
  return request<RegisterResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function profile(accessToken: string): Promise<AuthProfile> {
  return request<AuthProfile>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function logout(refreshToken: string): Promise<void> {
  return request<void>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function readStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.user?.email !== 'string' ||
      typeof parsed.tokens?.accessToken !== 'string' ||
      typeof parsed.tokens?.refreshToken !== 'string'
    ) {
      return null;
    }

    return parsed as Session;
  } catch {
    return null;
  }
}

export function storeSession(session: Session): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A blocked storage quota must not break sign-in; the session stays in memory.
  }
}

export function clearStoredSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: private-mode storage can throw on access.
  }
}
