import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/kernel/events';
import { ModuleRegistry, type JarvisModule } from '../src/kernel/modules';
import { createLogger } from '../src/kernel/logger';
import { makeJarvis } from './helpers';

const mod = (id: string, dependsOn: string[] = [], start: JarvisModule['start'] = () => {}): JarvisModule => ({
  manifest: { id, name: id, version: '0.0.1', description: '', dependsOn },
  start,
});

describe('EventBus', () => {
  it('entrega eventos tipados y permite desuscribirse', () => {
    const bus = new EventBus();
    const h = vi.fn();
    const off = bus.on('assistant.state', h);
    bus.emit('assistant.state', { state: 'listening' });
    off();
    bus.emit('assistant.state', { state: 'idle' });
    expect(h).toHaveBeenCalledTimes(1);
    expect(h.mock.calls[0]![0]).toEqual({ state: 'listening' });
  });

  it('aísla los errores de un suscriptor', () => {
    const onErr = vi.fn();
    const bus = new EventBus(onErr);
    const ok = vi.fn();
    bus.on('assistant.state', () => { throw new Error('boom'); });
    bus.on('assistant.state', ok);
    bus.emit('assistant.state', { state: 'idle' });
    expect(ok).toHaveBeenCalled();
    expect(onErr).toHaveBeenCalledOnce();
  });
});

describe('ModuleRegistry', () => {
  const reg = () => new ModuleRegistry(new EventBus(), createLogger('silent'));

  it('ordena por dependencias', () => {
    const r = reg();
    r.register(mod('voice', ['ai']));
    r.register(mod('ai', ['memory']));
    r.register(mod('memory'));
    expect(r.resolveOrder()).toEqual(['memory', 'ai', 'voice']);
  });

  it('detecta dependencias circulares', () => {
    const r = reg();
    r.register(mod('a', ['b']));
    r.register(mod('b', ['a']));
    expect(() => r.resolveOrder()).toThrow(/circular/);
  });

  it('detecta dependencias ausentes', () => {
    const r = reg();
    r.register(mod('a', ['zzz']));
    expect(() => r.resolveOrder()).toThrow(/ausente/);
  });

  it('rechaza ids duplicados o no válidos', () => {
    const r = reg();
    r.register(mod('a'));
    expect(() => r.register(mod('a'))).toThrow(/duplicado/);
    expect(() => r.register(mod('Mal Id'))).toThrow(/no válido/);
  });

  it('un módulo que falla no tumba el núcleo y bloquea a sus dependientes', async () => {
    const j = await makeJarvis([
      mod('broken', [], () => { throw new Error('sin conexión'); }),
      mod('dependent', ['broken']),
      mod('fine'),
    ]);
    const byId = Object.fromEntries(j.modules.list().map((m) => [m.id, m]));
    expect(byId.broken!.status).toBe('failed');
    expect(byId.broken!.error).toBe('sin conexión');
    expect(byId.dependent!.status).toBe('failed');
    expect(byId.fine!.status).toBe('running');
    expect(byId.system!.status).toBe('running');
    await j.stop();
  });
});
