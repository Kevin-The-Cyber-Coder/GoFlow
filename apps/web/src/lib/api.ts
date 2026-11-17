/**
 * A deliberately small API client. It covers authentication plus the read-only
 * endpoints the signed-in dashboard needs. Mutating endpoints are added one
 * screen at a time, so the client never grows ahead of the UI.
 */

const API_BASE = '/api/v1';
const STORAGE_KEY = 'goflow.session';
const WORKSPACE_KEY = 'goflow.workspace';

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

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
}

export interface AuthProfile {
  user: User;
  memberships: Membership[];
}

export interface RegisterResult {
  user: User;
  workspace: {
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    role: string;
  };
  tokens: TokenPair;
}

export interface Session {
  user: User;
  tokens: TokenPair;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  createdAt: string;
  role: string;
  memberCount: number;
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  invoicePrefix: string;
  defaultTaxRateBps: number;
  createdAt: string;
  counts: {
    members: number;
    clients: number;
    projects: number;
    invoices: number;
  };
}

export interface ReportSummary {
  currency: string;
  from: string;
  to: string;
  incomeMinor: string;
  expensesMinor: string;
  netMinor: string;
  outstandingMinor: string;
  paymentCount: number;
  expenseCount: number;
  outstandingInvoiceCount: number;
}

export type InvoiceStatus =
  'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'VOID';

export interface InvoiceListItem {
  id: string;
  number: string;
  status: InvoiceStatus;
  isOverdue: boolean;
  currency: string;
  issueDate: string;
  dueDate: string;
  client: { id: string; name: string; company: string | null; email: string | null };
  project: { id: string; name: string } | null;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
  paidMinor: string;
  dueMinor: string;
  notes: string | null;
  terms: string | null;
  template: string;
  sentAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    description: string;
    quantityMilli: number;
    unitPriceMinor: string;
    discountMinor: string;
    taxRateBps: number;
    totalMinor: string;
    position: number;
  }>;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface InvoiceList {
  data: InvoiceListItem[];
  meta: PageMeta;
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

/** Rotates a refresh token. The old token stops working once this succeeds. */
export function refreshTokens(refreshToken: string): Promise<TokenPair> {
  return request<TokenPair>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

function authHeaders(accessToken: string, workspaceId?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(workspaceId === undefined ? {} : { 'X-Workspace-Id': workspaceId }),
  };
}

export function listWorkspaces(accessToken: string): Promise<{ workspaces: WorkspaceSummary[] }> {
  return request<{ workspaces: WorkspaceSummary[] }>('/workspaces', {
    headers: authHeaders(accessToken),
  });
}

export async function getWorkspace(
  accessToken: string,
  workspaceId: string,
): Promise<WorkspaceDetail> {
  const result = await request<{ workspace: WorkspaceDetail }>(
    `/workspaces/${encodeURIComponent(workspaceId)}`,
    { headers: authHeaders(accessToken, workspaceId) },
  );
  return result.workspace;
}

export function reportSummary(
  accessToken: string,
  workspaceId: string,
  range: { from: string; to: string },
): Promise<ReportSummary> {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  return request<ReportSummary>(`/reports/summary?${query.toString()}`, {
    headers: authHeaders(accessToken, workspaceId),
  });
}

export function listInvoices(
  accessToken: string,
  workspaceId: string,
  query: {
    pageSize?: number;
    sort?: 'issueDate' | 'dueDate' | 'number' | 'createdAt';
    order?: 'asc' | 'desc';
  } = {},
): Promise<InvoiceList> {
  const params = new URLSearchParams({
    pageSize: String(query.pageSize ?? 5),
    sort: query.sort ?? 'issueDate',
    order: query.order ?? 'desc',
  });
  return request<InvoiceList>(`/invoices?${params.toString()}`, {
    headers: authHeaders(accessToken, workspaceId),
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

/** Remembers the last workspace so a reload lands on the same business. */
export function readStoredWorkspaceId(): string | null {
  try {
    const value = window.localStorage.getItem(WORKSPACE_KEY);
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function storeWorkspaceId(workspaceId: string): void {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, workspaceId);
  } catch {
    // The switcher still works for this visit if storage is blocked.
  }
}
