import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@jarvis/shared';
import { createJarvis, type Jarvis } from '../src/app';
import { loadConfig } from '../src/kernel/config';
import { spotifyConnector } from '../src/connectors/spotify';
import { tmpDir } from './helpers';

const USER: Principal = { kind: 'user', id: 'owner' };
const running: Jarvis[] = [];
afterEach(async () => { for (const j of running.splice(0)) await j.stop().catch(() => undefined); });

describe('Spotify (API simulada)', () => {
  it('PKCE sin secreto, token rotado, poner música por búsqueda, controles y errores de Premium/dispositivo', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    let challenge = '';
    let premium = true;
    let refreshes = 0;
    const f = (async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const body = typeof init.body === 'string' ? init.body : '';
      calls.push({ url, method: init.method ?? 'GET', body });
      if (url === 'https://accounts.spotify.com/api/token') {
        const p = new URLSearchParams(body);
        expect(p.get('client_secret')).toBeNull();
        if (p.get('grant_type') === 'authorization_code') {
          expect(createHash('sha256').update(p.get('code_verifier')!).digest('base64url')).toBe(challenge);
          return Response.json({ access_token: 'a1', expires_in: 0, refresh_token: 'r1' });
        }
        refreshes++;
        return Response.json({ access_token: `a${refreshes + 1}`, expires_in: 3600, refresh_token: `r${refreshes + 1}` });
      }
      if (url.endsWith('/v1/me')) return Response.json({ id: 'pablo', display_name: 'Pablo', product: 'premium' });
      if (url.includes('/v1/search?type=playlist')) return Response.json({ playlists: { items: [null, { name: 'Lofi para concentrarse', uri: 'spotify:playlist:37i9dQZF1DWWQRwui0ExPn' }] } });
      if (url.endsWith('/v1/me/player/play')) return premium ? new Response(null, { status: 204 }) : Response.json({ error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }, { status: 403 });
      if (url.endsWith('/v1/me/player/next')) return Response.json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, { status: 404 });
      if (url.endsWith('/v1/me/player')) return new Response(null, { status: 204 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const j = createJarvis(loadConfig({}, { dataDir: tmpDir(), logLevel: 'silent', port: 7777 }), { dbFile: ':memory:', embedder: null, connectors: [spotifyConnector()], fetch: f });
    await j.start();
    running.push(j);
    j.connectors.configure(USER, 'spotify', { clientId: 'abcdef0123456789abcdef0123456789' });
    const { url, redirectUri } = (await j.connectors.action(USER, 'spotify', 'authorize', {})) as { url: string; redirectUri: string };
    expect(redirectUri).toBe('http://127.0.0.1:7777/oauth/spotify/callback');
    const u = new URL(url);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', code_challenge_method: 'S256', redirect_uri: redirectUri });
    challenge = u.searchParams.get('code_challenge')!;
    await j.connectors.oauthCallback('spotify', { code: 'c', state: u.searchParams.get('state')! });
    expect(await j.connectors.enable(USER, 'spotify')).toEqual({ ok: true, detail: 'Conectado como Pablo (Premium)' });
    expect(j.vault.get('connector.spotify.refreshToken')).toBe('r2'); // rotado al renovar

    expect(await j.tools.invoke(USER, 'spotify.now_playing', {})).toMatchObject({ status: 'ok', output: { playing: false } });
    expect(await j.tools.invoke(USER, 'spotify.play', { query: 'lofi concentrarse', type: 'playlist' })).toMatchObject({ status: 'ok', output: { playing: 'Lofi para concentrarse' } });
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/me/player/play'))!.body)).toEqual({ context_uri: 'spotify:playlist:37i9dQZF1DWWQRwui0ExPn' });
    expect(await j.tools.invoke(USER, 'spotify.control', { action: 'next' })).toMatchObject({ status: 'error', error: expect.stringContaining('ningún dispositivo') });
    premium = false;
    expect(await j.tools.invoke(USER, 'spotify.play', {})).toMatchObject({ status: 'error', error: 'Controlar la reproducción requiere Spotify Premium' });
  });
});
