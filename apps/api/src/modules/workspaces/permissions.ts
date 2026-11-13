import type { WorkspaceRole } from '@prisma/client';

/**
 * Permission catalogue.
 *
 * Permissions are named after the operation (verb last) so guards read as
 * `requirePermission('invoices:write')`. Adding a permission requires adding
 * it to at least one role here — the matrix is the single source of truth and
 * is exposed to the web client so it can hide unavailable actions.
 */
export type Permission =
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'workspace:transfer'
  | 'members:read'
  | 'members:invite'
  | 'members:update'
  | 'members:remove'
  | 'clients:read'
  | 'clients:write'
  | 'clients:delete'
  | 'projects:read'
  | 'projects:write'
  | 'projects:delete'
  | 'time:read'
  | 'time:write'
  | 'invoices:read'
  | 'invoices:write'
  | 'invoices:send'
  | 'invoices:delete'
  | 'payments:read'
  | 'payments:write'
  | 'payments:reverse'
  | 'expenses:read'
  | 'expenses:write'
  | 'expenses:approve'
  | 'reports:read'
  | 'reports:export'
  | 'audit:read'
  | 'settings:update';

/** Every permission, used only to build the OWNER row. */
export const ALL_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'clients:read',
  'clients:write',
  'clients:delete',
  'projects:read',
  'projects:write',
  'projects:delete',
  'time:read',
  'time:write',
  'invoices:read',
  'invoices:write',
  'invoices:send',
  'invoices:delete',
  'payments:read',
  'payments:write',
  'payments:reverse',
  'expenses:read',
  'expenses:write',
  'expenses:approve',
  'reports:read',
  'reports:export',
  'audit:read',
  'settings:update',
];

const ADMIN_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (permission) => permission !== 'workspace:delete' && permission !== 'workspace:transfer',
);

const ACCOUNTANT_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'members:read',
  'clients:read',
  'projects:read',
  'time:read',
  'invoices:read',
  'invoices:write',
  'invoices:send',
  'payments:read',
  'payments:write',
  'payments:reverse',
  'expenses:read',
  'expenses:write',
  'expenses:approve',
  'reports:read',
  'reports:export',
  'audit:read',
];

const PROJECT_MANAGER_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'members:read',
  'clients:read',
  'clients:write',
  'projects:read',
  'projects:write',
  'projects:delete',
  'time:read',
  'time:write',
  'expenses:read',
  'expenses:write',
  'invoices:read',
  'reports:read',
];

const EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'clients:read',
  'projects:read',
  'projects:write',
  'time:read',
  'time:write',
  'expenses:read',
  'expenses:write',
  'invoices:read',
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'members:read',
  'clients:read',
  'projects:read',
  'time:read',
  'invoices:read',
  'payments:read',
  'expenses:read',
  'reports:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, ReadonlySet<Permission>>> = {
  OWNER: new Set(ALL_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  ACCOUNTANT: new Set(ACCOUNTANT_PERMISSIONS),
  PROJECT_MANAGER: new Set(PROJECT_MANAGER_PERMISSIONS),
  EMPLOYEE: new Set(EMPLOYEE_PERMISSIONS),
  VIEWER: new Set(VIEWER_PERMISSIONS),
};

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Serialisable matrix for the API and the web client. */
export function permissionMatrix(): Array<{ role: WorkspaceRole; permissions: Permission[] }> {
  return (Object.keys(ROLE_PERMISSIONS) as WorkspaceRole[]).map((role) => ({
    role,
    permissions: [...ROLE_PERMISSIONS[role]].sort(),
  }));
}
