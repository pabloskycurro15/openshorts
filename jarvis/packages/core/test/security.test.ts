import { describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { scopeMatches } from '../src/security/permissions';
import { makeJarvis } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const AGENT: Principal = { kind: 'agent', id: 'research' };

describe('scopeMatches', () => {
  it.each([
    ['system.info.read', 'system.info.read', true],
    ['system.*', 'system.info.read', true],
    ['fs.*', 'fs.read:/home/a', true],
    ['fs.read:/home/a/*', 'fs.read:/home/a/b/c.txt', true],
    ['fs.read:/home/a/*', 'fs.read:/home/ab/x', false],
    ['fs.read:/home/a/*', 'fs.write:/home/a/x', false],
    ['fs.read', 'fs.read:/x', false],
    ['system.info.read', 'system.info.write', false],
    ['sys.*', 'system.info.read', false],
  ])('%s cubre %s → %s', (g, r, expected) => {
    expect(scopeMatches(g, r)).toBe(expected);
  });
});

describe('PermissionEngine', () => {
  it('el usuario: permitido en riesgo bajo, confirmación en alto/crítico', async () => {
    const j = await makeJarvis();
    const base = { principal: USER, scopes: ['x.y'], sideEffects: true };
    expect(j.permissions.check({ ...base, risk: 'low' }).decision).toBe('allow');
    expect(j.permissions.check({ ...base, risk: 'medium' }).decision).toBe('allow');
    expect(j.permissions.check({ ...base, risk: 'high' }).decision).toBe('ask');
    expect(j.permissions.check({ ...base, risk: 'critical' }).decision).toBe('ask');
  });

  it('un agente sin concesión es denegado; con concesión, permitido; alto/crítico siempre pregunta', async () => {
    const j = await makeJarvis();
    const req = { principal: AGENT, scopes: ['web.search'], risk: 'low' as const, sideEffects: false };
    expect(j.permissions.check(req).decision).toBe('deny');
    j.permissions.grant(USER, AGENT, 'web.*');
    expect(j.permissions.check(req).decision).toBe('allow');
    expect(j.permissions.check({ ...req, risk: 'high' }).decision).toBe('ask');
    expect(j.permissions.check({ ...req, risk: 'critical' }).decision).toBe('ask');
    j.permissions.revoke(USER, AGENT);
    expect(j.permissions.check(req).decision).toBe('deny');
  });

  it('necesita concesión para TODOS los ámbitos', async () => {
    const j = await makeJarvis();
    j.permissions.grant(USER, AGENT, 'web.search');
    expect(j.permissions.check({ principal: AGENT, scopes: ['web.search', 'fs.write:/x'], risk: 'low', sideEffects: true }).decision).toBe('deny');
  });

  it('nadie salvo el usuario puede conceder permisos (sin escalada) y el intento se audita', async () => {
    const j = await makeJarvis();
    expect(() => j.permissions.grant(AGENT, AGENT, 'fs.*')).toThrow(/Solo el usuario/);
    expect(() => j.permissions.setLockdown(AGENT, false)).toThrow(/Solo el usuario/);
    expect(j.audit.list().some((e) => e.action === 'permission.escalation_attempt' && e.outcome === 'denied')).toBe(true);
    expect(j.permissions.listGrants(AGENT)).toHaveLength(0);
  });

  it('modo emergencia bloquea operaciones con efectos, incluso del usuario', async () => {
    const j = await makeJarvis();
    j.permissions.setLockdown(USER, true);
    expect(j.permissions.check({ principal: USER, scopes: [], risk: 'low', sideEffects: true }).decision).toBe('deny');
    expect(j.permissions.check({ principal: USER, scopes: [], risk: 'low', sideEffects: false }).decision).toBe('allow');
  });
});

describe('AuditLog', () => {
  it('encadena hashes y verifica la integridad', async () => {
    const j = await makeJarvis();
    j.audit.append({ principal: USER, action: 'test.a', outcome: 'success' });
    j.audit.append({ principal: USER, action: 'test.b', outcome: 'success', details: { n: 1 } });
    const v = j.audit.verify();
    expect(v.ok).toBe(true);
  });

  it('es de solo inserción (UPDATE/DELETE bloqueados por la base de datos)', async () => {
    const j = await makeJarvis();
    j.audit.append({ principal: USER, action: 'test.a', outcome: 'success' });
    expect(() => j.db.prepare(`UPDATE audit_log SET action = 'x'`).run()).toThrow(/solo inserción/);
    expect(() => j.db.prepare('DELETE FROM audit_log').run()).toThrow(/solo inserción/);
  });

  it('detecta manipulación aunque se salten los triggers', async () => {
    const j = await makeJarvis();
    j.audit.append({ principal: USER, action: 'test.a', outcome: 'success' });
    const target = j.audit.append({ principal: USER, action: 'test.b', outcome: 'success' });
    j.audit.append({ principal: USER, action: 'test.c', outcome: 'success' });
    j.db.exec('DROP TRIGGER audit_no_update');
    j.db.prepare(`UPDATE audit_log SET outcome = 'failure' WHERE seq = ?`).run(target.seq);
    expect(j.audit.verify()).toEqual({ ok: false, brokenAt: target.seq });
  });
});
