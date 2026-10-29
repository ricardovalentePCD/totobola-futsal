import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import divisions from './lib/divisions.json' with { type: 'json' };
import { db } from './lib/store.mjs';
import { outcomeOf } from './lib/zerozero.mjs';

export const config = { path: '/api/*' };

const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status, error) => json({ error }, status);

// ---------- utilizadores ----------
const NICK_RE = /^[\p{L}\p{N}_\- ]{2,20}$/u;
const nickKey = (nick) =>
  nick.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '-');
const hashPin = (pin, salt) => scryptSync(pin, salt, 32);

// Cria o nick se não existir; senão valida o PIN. Devolve { user } ou { error, status }.
async function authenticate(store, nickRaw, pin) {
  const nick = String(nickRaw ?? '').trim().replace(/\s+/g, ' ');
  pin = String(pin ?? '');
  if (!NICK_RE.test(nick)) return { status: 400, error: 'Nick inválido (2 a 20 letras, números, espaço, _ ou -).' };
  if (!/^\d{4,6}$/.test(pin)) return { status: 400, error: 'O PIN tem de ter 4 a 6 números.' };

  const key = nickKey(nick);
  const user = await store.get(`users/${key}`);

  if (!user) {
    const salt = randomBytes(16).toString('hex');
    const created = { nick, salt, hash: hashPin(pin, salt).toString('hex'), fails: 0, lockUntil: 0, createdAt: new Date().toISOString() };
    await store.set(`users/${key}`, created);
    return { user: created, key, created: true };
  }

  if (user.lockUntil > Date.now()) return { status: 429, error: 'Demasiadas tentativas. Tenta mais tarde.' };
  const ok = timingSafeEqual(hashPin(pin, user.salt), Buffer.from(user.hash, 'hex'));
  if (!ok) {
    user.fails = (user.fails || 0) + 1;
    if (user.fails >= MAX_FAILS) { user.lockUntil = Date.now() + LOCK_MS; user.fails = 0; }
    await store.set(`users/${key}`, user);
    return { status: 401, error: 'Este nick já existe e o PIN não corresponde.' };
  }
  if (user.fails) { user.fails = 0; await store.set(`users/${key}`, user); }
  return { user, key, created: false };
}

// ---------- jogos ----------
const divisionById = (id) => divisions.find((d) => d.id === id);

const publicGame = (g, now) => ({
  id: g.id,
  home: g.home,
  away: g.away,
  kickoff: g.kickoff,
  timeKnown: g.timeKnown,
  locked: now >= new Date(g.kickoff).getTime(),
  score: g.score ?? null,
  outcome: g.score ? outcomeOf(g.score) : null,
});

// O zerozero bloqueia os servidores do Netlify, por isso os jogos chegam por /api/sync
// (enviados pelo script scripts/sync.mjs, que corre num computador não bloqueado).
const rkey = (div, n) => `rounds/${div}-${n}`;

// guarda os jogos de uma jornada (um resultado já conhecido nunca é apagado)
async function saveRound(store, div, round, games) {
  await Promise.all(
    games.map(async (g) => {
      const prev = await store.get(`games/${g.id}`);
      await store.set(`games/${g.id}`, { ...g, score: g.score ?? prev?.score ?? null, div, round });
    })
  );
  await store.set(rkey(div, round), { gids: games.map((g) => g.id) });
}

async function getRound(store, divId, roundWanted) {
  const meta = await store.get(`meta/${divId}`);
  if (!meta) return { empty: true };
  const round = roundWanted || meta.current;
  const entry = await store.get(rkey(divId, round));
  const games = (await Promise.all((entry?.gids ?? []).map((id) => store.get(`games/${id}`)))).filter(Boolean);
  games.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return { title: meta.title, round, rounds: meta.rounds, games, updatedAt: meta.updatedAt };
}

async function sync(store, body) {
  const div = divisionById(body.div);
  if (!div) return { status: 404, error: 'Divisão desconhecida.' };
  const rounds = (body.data ?? []).filter((r) => Number.isInteger(r.round) && Array.isArray(r.games));
  for (const r of rounds) await saveRound(store, div.id, r.round, r.games);
  await store.set(`meta/${div.id}`, {
    title: String(body.title ?? div.name),
    current: body.current,
    rounds: body.rounds,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, rounds: rounds.length };
}

async function leaderboard(store, divFilter) {
  const rows = [];
  const cache = new Map();
  const game = async (gid) => {
    if (!cache.has(gid)) cache.set(gid, await store.get(`games/${gid}`));
    return cache.get(gid);
  };
  for (const k of await store.list('votes/')) {
    const v = await store.get(k);
    if (!v) continue;
    let pts = 0, played = 0, open = 0;
    for (const [gid, pick] of Object.entries(v.picks ?? {})) {
      const g = await game(gid);
      if (!g || (divFilter !== 'all' && g.div !== divFilter)) continue;
      if (!g.score) { open++; continue; }
      played++;
      if (pick === outcomeOf(g.score)) pts++;
    }
    rows.push({ nick: v.nick, pts, played, open, pct: played ? Math.round((pts / played) * 100) : 0 });
  }
  rows.sort((a, b) => b.pts - a.pts || b.pct - a.pct || a.played - b.played || a.nick.localeCompare(b.nick, 'pt'));
  let rank = 0;
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    if (!p || p.pts !== r.pts || p.pct !== r.pct || p.played !== r.played) rank = i + 1;
    r.rank = rank;
  });
  return rows;
}

// ---------- rotas ----------
export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '');
  const store = db();

  try {
    if (req.method === 'GET' && route === 'divisions') {
      return json(divisions.map(({ id, name }) => ({ id, name })));
    }

    if (req.method === 'GET' && route === 'round') {
      const divId = url.searchParams.get('div');
      if (!divisionById(divId)) return fail(404, 'Divisão desconhecida.');
      const r = await getRound(store, divId, +url.searchParams.get('round') || null);
      if (r.empty) return fail(503, 'Ainda sem jogos desta divisão. Volta daqui a pouco.');
      const now = Date.now();
      return json({ div: divId, title: r.title, round: r.round, rounds: r.rounds, updatedAt: r.updatedAt, games: r.games.map((g) => publicGame(g, now)) });
    }

    if (req.method === 'POST' && route === 'sync') {
      const expected = process.env.SYNC_KEY;
      if (!expected) return fail(503, 'SYNC_KEY não configurada.');
      const got = Buffer.from(req.headers.get('x-sync-key') ?? '');
      const want = Buffer.from(expected);
      if (got.length !== want.length || !timingSafeEqual(got, want)) return fail(401, 'Chave inválida.');
      const r = await sync(store, await req.json().catch(() => ({})));
      return r.error ? fail(r.status, r.error) : json(r);
    }

    if (req.method === 'GET' && route === 'leaderboard') {
      const d = url.searchParams.get('div') || 'all';
      if (d !== 'all' && !divisionById(d)) return fail(404, 'Divisão desconhecida.');
      return json({ div: d, rows: await leaderboard(store, d) });
    }

    if (req.method === 'POST' && (route === 'login' || route === 'vote')) {
      const body = await req.json().catch(() => ({}));
      const auth = await authenticate(store, body.nick, body.pin);
      if (auth.error) return fail(auth.status, auth.error);
      const { user, key } = auth;
      const votes = (await store.get(`votes/${key}`)) ?? { nick: user.nick, picks: {} };

      if (route === 'vote') {
        const { gameId, pick } = body;
        if (!['1', 'X', '2'].includes(pick)) return fail(400, 'Palpite inválido.');
        const g = await store.get(`games/${gameId}`);
        if (!g) return fail(404, 'Jogo desconhecido.');
        const kickoff = new Date(g.kickoff).getTime();
        if (Date.now() >= kickoff) return fail(409, 'Este jogo já começou — votos fechados.');
        votes.picks[gameId] = pick;
        votes.nick = user.nick;
        await store.set(`votes/${key}`, votes);
      } else if (auth.created) {
        await store.set(`votes/${key}`, votes);
      }
      return json({ ok: true, created: !!auth.created, nick: user.nick, picks: votes.picks });
    }

    return fail(404, 'Não encontrado.');
  } catch (e) {
    console.error(e);
    return json({ error: 'Erro a obter dados. Tenta daqui a pouco.', detail: String(e?.message ?? e) }, 502);
  }
};
