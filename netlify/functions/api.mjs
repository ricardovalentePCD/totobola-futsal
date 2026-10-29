import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import divisions from './lib/divisions.json' with { type: 'json' };
import { db } from './lib/store.mjs';
import { fetchRound, outcomeOf } from './lib/zerozero.mjs';

export const config = { path: '/api/*' };

const RESULT_DELAY_MS = 75 * 60 * 1000; // só confiar no resultado depois do jogo acabar
const RECHECK_MS = 5 * 60 * 1000;
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

// guarda/actualiza os jogos de uma jornada (mantém resultados já conhecidos)
async function saveGames(store, div, round, games) {
  await Promise.all(
    games.map(async (g) => {
      const prev = await store.get(`games/${g.id}`);
      const score = g.score ?? prev?.score ?? null;
      await store.set(`games/${g.id}`, { ...g, score, div: div.id, round });
    })
  );
}

async function getRound(store, divId, roundWanted) {
  const div = divisionById(divId);
  if (!div) return null;
  const data = await fetchRound(div.edition, roundWanted);
  await saveGames(store, div, data.round, data.games);
  const merged = await Promise.all(data.games.map(async (g) => ({ ...g, score: g.score ?? (await store.get(`games/${g.id}`))?.score ?? null })));
  return { div, ...data, games: merged };
}

// vai buscar os resultados dos jogos votados que já terminaram mas ainda não têm resultado
async function resolveResults(store) {
  const now = Date.now();
  const voteKeys = await store.list('votes/');
  const gids = new Set();
  for (const k of voteKeys) {
    const v = await store.get(k);
    Object.keys(v?.picks ?? {}).forEach((g) => gids.add(g));
  }
  const pending = new Map(); // "div|round" -> true
  for (const gid of gids) {
    const g = await store.get(`games/${gid}`);
    if (g && !g.score && now > new Date(g.kickoff).getTime() + RESULT_DELAY_MS) pending.set(`${g.div}|${g.round}`, true);
  }
  await Promise.all(
    [...pending.keys()].map(async (k) => {
      const checkKey = `meta/check-${k.replace('|', '-')}`;
      const last = await store.get(checkKey);
      if (last && now - last.t < RECHECK_MS) return;
      await store.set(checkKey, { t: now });
      const [divId, round] = k.split('|');
      try { await getRound(store, divId, +round); } catch { /* zerozero em baixo: tenta na próxima */ }
    })
  );
}

async function leaderboard(store, divFilter) {
  await resolveResults(store);
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
      const roundWanted = +url.searchParams.get('round') || null;
      const r = await getRound(store, url.searchParams.get('div'), roundWanted);
      if (!r) return fail(404, 'Divisão desconhecida.');
      const now = Date.now();
      return json({ div: r.div.id, title: r.title, round: r.round, rounds: r.rounds, games: r.games.map((g) => publicGame(g, now)) });
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
        // confirma a hora actual do jogo no zerozero (pode ter sido adiado)
        let kickoff = new Date(g.kickoff).getTime();
        try {
          const fresh = (await getRound(store, g.div, g.round)).games.find((x) => x.id === gameId);
          if (fresh) kickoff = new Date(fresh.kickoff).getTime();
        } catch { /* usa a hora guardada */ }
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
