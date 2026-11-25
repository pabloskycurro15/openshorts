import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '../tools/registry';
import type { ConnectorCtx, ConnectorDef } from './framework';
import { jsonFetch } from './http';

export const SPOTIFY_SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'user-read-recently-played',
  'playlist-read-private', 'playlist-modify-private', 'playlist-modify-public', 'user-library-read',
];
const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const URI = /^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{10,40}$/;

type Track = { name: string; uri: string; artists: { name: string }[]; album?: { name: string }; duration_ms: number };
const fmtTrack = (t: Track) => ({ title: t.name, artists: t.artists.map((a) => a.name).join(', '), album: t.album?.name ?? null, uri: t.uri, duration: Math.round(t.duration_ms / 1000) });

/**
 * Spotify (Web API oficial) con OAuth PKCE: solo hace falta el «Client ID» de una app
 * creada gratis en developer.spotify.com (sin secreto). Controlar la reproducción
 * exige Spotify Premium y un dispositivo con Spotify abierto (limitación de Spotify).
 */
export function spotifyConnector(): ConnectorDef {
  let access: { token: string; exp: number } | null = null;
  const pending = new Map<string, { verifier: string; redirect: string; exp: number }>();
  let account: string | null = null;
  const redirectUri = (ctx: ConnectorCtx) => `${ctx.baseUrl()}/oauth/spotify/callback`;

  async function token(ctx: ConnectorCtx): Promise<string> {
    if (access && access.exp > Date.now() + 60_000) return access.token;
    const refresh = ctx.getSecret('refreshToken');
    if (!refresh) throw new Error('Spotify no está autorizado: pulsa «Conectar con Spotify» en Conectores');
    try {
      const r = await jsonFetch<{ access_token: string; expires_in: number; refresh_token?: string }>(ctx.fetch, TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: ctx.get('clientId') ?? '' }).toString(),
      });
      // Spotify puede rotar el token de actualización.
      if (r.refresh_token) ctx.setSecret('refreshToken', r.refresh_token);
      access = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
      return access.token;
    } catch (err) {
      if (/invalid_grant/.test((err as Error).message)) {
        ctx.setSecret('refreshToken', null);
        throw new Error('Spotify retiró la autorización: vuelve a pulsar «Conectar con Spotify»', { cause: err });
      }
      throw err;
    }
  }

  const api = async <T>(ctx: ConnectorCtx, p: string, init: RequestInit = {}): Promise<T> => {
    try {
      return await jsonFetch<T>(ctx.fetch, `${API}${p}`, { ...init, headers: { authorization: `Bearer ${await token(ctx)}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) } });
    } catch (err) {
      const m = (err as Error).message;
      if (/PREMIUM_REQUIRED|Premium required/i.test(m)) throw new Error('Controlar la reproducción requiere Spotify Premium', { cause: err });
      if (/NO_ACTIVE_DEVICE|No active device/i.test(m) || /HTTP 404/.test(m) && p.startsWith('/me/player')) throw new Error('No hay ningún dispositivo con Spotify abierto. Abre Spotify en el PC o el móvil y vuelve a intentarlo.', { cause: err });
      throw err;
    }
  };

  /** Convierte una búsqueda en una URI (la primera coincidencia). */
  const findUri = async (ctx: ConnectorCtx, query: string, type: 'track' | 'playlist' | 'album' | 'artist') => {
    const r = await api<Record<string, { items: ({ uri: string; name: string } | null)[] }>>(ctx, `/search?type=${type}&limit=1&q=${encodeURIComponent(query)}`);
    const item = r[`${type}s`]?.items.find(Boolean);
    if (!item) throw new Error(`No he encontrado «${query}» en Spotify`);
    return item;
  };

  return {
    id: 'spotify',
    name: 'Spotify',
    description: 'Qué suena, buscar y poner música, controlar la reproducción y gestionar tus listas.',
    official: true,
    warning: 'Crea una app gratis en developer.spotify.com (Dashboard → Create app) y añade como «Redirect URI» la dirección que aparece abajo. Controlar la reproducción requiere Spotify Premium.',
    docsUrl: 'https://developer.spotify.com/dashboard',
    fields: [{ key: 'clientId', label: 'Client ID', secret: false, required: true, placeholder: '32 caracteres', help: 'En tu app de developer.spotify.com → Settings. No hace falta el «Client secret».' }],
    secretKeys: ['refreshToken'],
    async test(ctx) {
      if (!ctx.getSecret('refreshToken')) return { ok: false, detail: 'Falta autorizar: pulsa «Conectar con Spotify»' };
      const me = await api<{ display_name?: string; id: string; product?: string }>(ctx, '/me');
      account = me.display_name ?? me.id;
      return { ok: true, detail: `Conectado como ${account}${me.product === 'premium' ? ' (Premium)' : ' (sin Premium: no podrá controlar la reproducción)'}` };
    },
    status: (ctx) => ({ account, authorized: !!ctx.getSecret('refreshToken'), redirectUri: redirectUri(ctx) }),
    actions: {
      async authorize(ctx) {
        const clientId = ctx.get('clientId');
        if (!clientId) throw new Error('Guarda antes el Client ID');
        const state = b64url(randomBytes(24));
        const verifier = b64url(randomBytes(48));
        const redirect = redirectUri(ctx);
        pending.set(state, { verifier, redirect, exp: Date.now() + 10 * 60_000 });
        const url = new URL('https://accounts.spotify.com/authorize');
        url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: SPOTIFY_SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: b64url(createHash('sha256').update(verifier).digest()) }).toString();
        return { url: url.toString(), redirectUri: redirect };
      },
      async disconnect(ctx) {
        ctx.setSecret('refreshToken', null);
        access = null;
        account = null;
        return { ok: true, note: 'Para retirar el acceso del todo: spotify.com → Cuenta → Apps → Quitar acceso.' };
      },
    },
    async oauthCallback(ctx, q) {
      if (q.error) throw new Error(q.error === 'access_denied' ? 'Has cancelado la autorización en Spotify' : `Spotify respondió: ${q.error}`);
      const p = q.state ? pending.get(q.state) : undefined;
      if (!p || p.exp < Date.now() || !q.code) throw new Error('Solicitud de autorización desconocida o caducada: vuelve a pulsar «Conectar con Spotify»');
      pending.delete(q.state!);
      const r = await jsonFetch<{ access_token: string; expires_in: number; refresh_token: string }>(ctx.fetch, TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: p.redirect, client_id: ctx.get('clientId') ?? '', code_verifier: p.verifier }).toString(),
      });
      ctx.setSecret('refreshToken', r.refresh_token);
      access = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
      return 'Spotify autorizado. Vuelve a JARVIS y pulsa «Activar».';
    },
    tools: (ctx) => [
      defineTool({
        name: 'spotify.now_playing', description: 'Qué está sonando ahora en Spotify y en qué dispositivo.',
        parameters: z.object({}), permissions: ['connector.spotify.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Canción, artistas, dispositivo, si suena y progreso.',
        async execute() {
          const r = await api<{ is_playing: boolean; progress_ms: number; item: Track | null; device: { name: string; volume_percent: number | null } } | null>(ctx, '/me/player');
          if (!r?.item) return { playing: false, note: 'No suena nada ahora mismo' };
          return { playing: r.is_playing, ...fmtTrack(r.item), progress: Math.round(r.progress_ms / 1000), device: r.device.name, volume: r.device.volume_percent };
        },
      }),
      defineTool({
        name: 'spotify.search', description: 'Busca canciones, listas, álbumes o artistas en Spotify.',
        parameters: z.object({ query: z.string().min(1).max(200), type: z.enum(['track', 'playlist', 'album', 'artist']).default('track'), limit: z.number().int().min(1).max(20).default(5) }),
        permissions: ['connector.spotify.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Resultados con nombre y URI.',
        async execute({ query, type, limit }) {
          const r = await api<Record<string, { items: (Record<string, unknown> | null)[] }>>(ctx, `/search?type=${type}&limit=${limit}&q=${encodeURIComponent(query)}`);
          return (r[`${type}s`]?.items ?? []).filter(Boolean).map((i) => (type === 'track' ? fmtTrack(i as unknown as Track) : { name: i!.name, uri: i!.uri, ...(type === 'playlist' ? { owner: (i!.owner as { display_name?: string } | undefined)?.display_name } : {}) }));
        },
      }),
      defineTool({
        name: 'spotify.play', description: 'Pone música: una búsqueda («música para concentrarse», «Bad Bunny») o una URI de Spotify. Sin nada, reanuda.',
        parameters: z.object({ query: z.string().max(200).optional(), uri: z.string().regex(URI).optional(), type: z.enum(['track', 'playlist', 'album', 'artist']).default('track') }),
        permissions: ['connector.spotify.control'], risk: 'low', sideEffects: true, risks: ['Cambia lo que suena en tu Spotify'], returns: 'Qué se ha puesto.',
        async execute({ query, uri, type }) {
          let target = uri ? { uri, name: uri } : query ? await findUri(ctx, query, type) : null;
          const body = !target ? undefined : target.uri.startsWith('spotify:track:') || target.uri.startsWith('spotify:episode:') ? { uris: [target.uri] } : { context_uri: target.uri };
          await api(ctx, '/me/player/play', { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
          if (!target) target = { uri: '', name: 'Reanudado' };
          return { playing: target.name, uri: target.uri || null };
        },
      }),
      defineTool({
        name: 'spotify.control', description: 'Pausa, reanuda, siguiente, anterior, volumen o modo aleatorio.',
        parameters: z.object({ action: z.enum(['pause', 'resume', 'next', 'previous', 'volume', 'shuffle_on', 'shuffle_off']), value: z.number().int().min(0).max(100).optional() }),
        permissions: ['connector.spotify.control'], risk: 'low', sideEffects: true, risks: ['Cambia la reproducción'], returns: 'Confirmación.',
        async execute({ action, value }) {
          const map: Record<string, [string, string]> = {
            pause: ['PUT', '/me/player/pause'], resume: ['PUT', '/me/player/play'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'],
            volume: ['PUT', `/me/player/volume?volume_percent=${value ?? 50}`], shuffle_on: ['PUT', '/me/player/shuffle?state=true'], shuffle_off: ['PUT', '/me/player/shuffle?state=false'],
          };
          const [method, p] = map[action]!;
          await api(ctx, p, { method });
          return { ok: true, action };
        },
      }),
      defineTool({
        name: 'spotify.playlists', description: 'Tus listas de reproducción.',
        parameters: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
        permissions: ['connector.spotify.read'], risk: 'low', sideEffects: false, risks: [], returns: 'Nombre, id, URI y número de canciones.',
        async execute({ limit }) {
          const r = await api<{ items: { id: string; name: string; uri: string; tracks: { total: number } }[] }>(ctx, `/me/playlists?limit=${limit}`);
          return r.items.map((p) => ({ id: p.id, name: p.name, uri: p.uri, tracks: p.tracks.total }));
        },
      }),
      defineTool({
        name: 'spotify.add_to_playlist', description: 'Añade una canción (por búsqueda o URI) a una de tus listas.',
        parameters: z.object({ playlistId: z.string().regex(/^[A-Za-z0-9]{10,40}$/), query: z.string().max(200).optional(), uri: z.string().regex(URI).optional() }).refine((a) => a.query || a.uri, 'Indica query o uri'),
        permissions: ['connector.spotify.write'], risk: 'medium', sideEffects: true, risks: ['Modifica una de tus listas de Spotify'], returns: 'Canción añadida.',
        async execute({ playlistId, query, uri }) {
          const track = uri ? { uri, name: uri } : await findUri(ctx, query!, 'track');
          await api(ctx, `/playlists/${playlistId}/tracks`, { method: 'POST', body: JSON.stringify({ uris: [track.uri] }) });
          return { added: track.name, uri: track.uri };
        },
      }),
    ],
  };
}
