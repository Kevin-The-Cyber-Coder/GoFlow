import { describe, expect, it } from '@jest/globals';

import { can, permissionMatrix, ROLE_PERMISSIONS } from './permissions';

describe('role permission matrix', () => {
  it('gives the owner every permission in the catalogue', () => {
    const owner = ROLE_PERMISSIONS.OWNER;
    for (const role of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of role) {
        expect(owner.has(permission)).toBe(true);
      }
    }
  });

  it('keeps destructive workspace operations owner-only', () => {
    expect(can('OWNER', 'workspace:delete')).toBe(true);
    expect(can('ADMIN', 'workspace:delete')).toBe(false);
    expect(can('ADMIN', 'workspace:transfer')).toBe(false);
    expect(can('ACCOUNTANT', 'workspace:transfer')).toBe(false);
  });

  it('limits viewers to read permissions', () => {
    const viewer = [...ROLE_PERMISSIONS.VIEWER];
    expect(viewer.every((permission) => permission.endsWith(':read'))).toBe(true);
  });

  it('lets accountants bill but not manage the team', () => {
    expect(can('ACCOUNTANT', 'invoices:write')).toBe(true);
    expect(can('ACCOUNTANT', 'payments:write')).toBe(true);
    expect(can('ACCOUNTANT', 'members:invite')).toBe(false);
    expect(can('ACCOUNTANT', 'clients:write')).toBe(false);
  });

  it('stops project managers from touching money', () => {
    expect(can('PROJECT_MANAGER', 'projects:write')).toBe(true);
    expect(can('PROJECT_MANAGER', 'invoices:write')).toBe(false);
    expect(can('PROJECT_MANAGER', 'payments:write')).toBe(false);
  });

  it('exposes a stable serialisable matrix', () => {
    const matrix = permissionMatrix();
    expect(matrix).toHaveLength(6);
    const admin = matrix.find((entry) => entry.role === 'ADMIN');
    expect(admin?.permissions).toContain('members:invite');
    expect(admin?.permissions).not.toContain('workspace:transfer');
  });
});
