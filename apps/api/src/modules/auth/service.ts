import { randomBytes } from 'node:crypto';

import type { Database } from '../../db/client';
import type { User, Workspace } from '../../db/schema';
import { conflict, notFound, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { hashToken, type TokenService } from '../../lib/tokens';
import {
  claimRefreshToken,
  createWorkspaceForOwner,
  findMemberships,
  findRefreshTokenByHash,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  insertUser,
  revokeRefreshToken,
  revokeTokenFamily,
} from './repository';
import type { LoginInput, RegisterInput } from './schemas';

export interface AuthServiceDependencies {
  db: Database;
  tokens: TokenService;
}

export interface RequestContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: PublicUser;
  workspace: Workspace | null;
  session: SessionTokens;
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` and keeps the original
 * `pg` error on `cause`, so the SQLSTATE is not necessarily on the outer object.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && (current as { code?: unknown }).code === PG_UNIQUE_VIOLATION) {
      return true;
    }

    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }

  return false;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDependencies) {}

  private get db(): Database {
    return this.deps.db;
  }

  private get tokens(): TokenService {
    return this.deps.tokens;
  }

  async register(input: RegisterInput, context: RequestContext = {}): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);

    let user: User;
    let workspace: Workspace;

    try {
      const created = await this.db.transaction(async (tx) => {
        const newUser = await insertUser(tx, {
          email: input.email,
          passwordHash,
          name: input.name,
        });

        const slug = `${slugify(input.name) || 'workspace'}-${randomBytes(4).toString('hex')}`;
        const newWorkspace = await createWorkspaceForOwner(tx, {
          ownerId: newUser.id,
          name: `${input.name}'s workspace`,
          slug,
        });

        return { newUser, newWorkspace };
      });

      user = created.newUser;
      workspace = created.newWorkspace;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
      }

      throw error;
    }

    const session = await this.issueSession(user.id, context);

    return { user: toPublicUser(user), workspace, session };
  }

  async login(input: LoginInput, context: RequestContext = {}): Promise<AuthResult> {
    const user = await findUserByEmail(this.db, input.email);

    if (!user) {
      // Spend comparable time on misses so response timing does not reveal
      // whether an account exists. Failed logins are rate limited at the edge.
      await hashPassword(input.password);
      throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);

    if (!valid) {
      throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    const memberships = await findMemberships(this.db, user.id);
    const session = await this.issueSession(user.id, context);

    return {
      user: toPublicUser(user),
      workspace: memberships[0]?.workspace ?? null,
      session,
    };
  }

  /**
   * Rotates a refresh token.
   *
   * Presenting a token that was already used means it leaked: the legitimate
   * client would have moved on to the replacement. The whole family is revoked
   * rather than just the token, which logs the attacker and the victim out and
   * forces a fresh login.
   */
  async refresh(rawToken: string, context: RequestContext = {}): Promise<AuthResult> {
    const row = await findRefreshTokenByHash(this.db, hashToken(rawToken));

    if (!row) {
      throw unauthorized('Invalid refresh token.', 'INVALID_REFRESH_TOKEN');
    }

    if (row.revokedAt) {
      await revokeTokenFamily(this.db, row.familyId);
      throw unauthorized('Session has been revoked. Please sign in again.', 'SESSION_REVOKED');
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw unauthorized('Session has expired. Please sign in again.', 'SESSION_EXPIRED');
    }

    const user = await findUserById(this.db, row.userId);

    if (!user) {
      await revokeTokenFamily(this.db, row.familyId);
      throw unauthorized('Session is no longer valid.', 'SESSION_REVOKED');
    }

    const next = this.tokens.createRefreshToken(row.familyId);

    const rotated = await this.db.transaction(async (tx) => {
      const inserted = await insertRefreshToken(tx, {
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
      });

      const claimed = await claimRefreshToken(tx, row.id, inserted.id);

      if (!claimed) {
        // Another request consumed this token between our read and our write.
        throw unauthorized('Session has been revoked. Please sign in again.', 'SESSION_REVOKED');
      }

      return inserted;
    });

    if (!rotated) {
      throw unauthorized('Session has been revoked. Please sign in again.', 'SESSION_REVOKED');
    }

    const accessToken = await this.tokens.issueAccessToken(user.id);
    const memberships = await findMemberships(this.db, user.id);

    return {
      user: toPublicUser(user),
      workspace: memberships[0]?.workspace ?? null,
      session: { accessToken, refreshToken: next.token },
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }

    const row = await findRefreshTokenByHash(this.db, hashToken(rawToken));

    if (row) {
      await revokeRefreshToken(this.db, row.id);
    }
  }

  async getProfile(userId: string): Promise<{ user: PublicUser; workspaces: Workspace[] }> {
    const user = await findUserById(this.db, userId);

    if (!user) {
      throw unauthorized('Session is no longer valid.', 'SESSION_REVOKED');
    }

    const memberships = await findMemberships(this.db, user.id);

    if (memberships.length === 0) {
      throw notFound('No workspace is associated with this account.');
    }

    return {
      user: toPublicUser(user),
      workspaces: memberships.map((membership) => membership.workspace),
    };
  }

  private async issueSession(userId: string, context: RequestContext): Promise<SessionTokens> {
    const accessToken = await this.tokens.issueAccessToken(userId);
    const refresh = this.tokens.createRefreshToken();

    await insertRefreshToken(this.db, {
      userId,
      familyId: refresh.familyId,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return { accessToken, refreshToken: refresh.token };
  }
}
