import type { WorkspaceRole } from '@prisma/client';

export interface AuthContext {
  readonly userId: string;
  readonly email: string;
}

/** The workspace a request resolves to, together with the caller's role in it. */
export interface WorkspaceContext {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      workspace?: WorkspaceContext;
    }
  }
}

export {};
