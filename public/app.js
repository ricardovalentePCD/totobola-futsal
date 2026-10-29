const $ = (id) => document.getElementById(id);
const LS = 'totobola-user';
const state = { user: null, picks: {}, divisions: [], div: null, round: null, data: null };

const store = {
  get() { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } },
  set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch {} },
  del() { try { localStorage.removeItem(LS); } catch {} },
};

async function api(path, body) {
  const res = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erro'), { status: res.status });
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtWhen = (g) => {
  const d = new Date(g.kickoff);
  const day = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Lisbon' }).format(d);
  const time = g.timeKnown ? new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' }).format(d) : 'hora por definir';
  return `${day} · ${time}`;
};

// ---------- sessão ----------
function renderWho() {
  const w = $('who');
  w.innerHTML = state.user ? `<span>👤 <b>${esc(state.user.nick)}</b></span><button id="logout">Sair</button>` : '';
  if (state.user) $('logout').onclick = () => { store.del(); state.user = null; state.picks = {}; renderWho(); showLogin(); renderGames(); };
}

function showLogin() { $('login').hidden = !!state.user; }

async function login(nick, pin) {
  const r = await api('login', { nick, pin });
  state.user = { nick: r.nick, pin };
  state.picks = r.picks;
  store.set(state.user);
  renderWho(); showLogin(); renderGames();
  toast(r.created ? `Bem-vindo, ${r.nick}! Registo criado.` : `Olá de novo, ${r.nick}!`);
}

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try { await login($('nick').value, $('pin').value); }
  catch (err) { $('loginErr').textContent = err.message; }
};

// ---------- jogos ----------
const LABELS = { '1': 'Vitória', X: 'Empate', '2': 'Derrota' };

function renderGames() {
  const d = state.data;
  const list = $('gameList');
  if (!d) { list.innerHTML = '<p class="muted">A carregar…</p>'; return; }
  if (!d.games.length) { list.innerHTML = '<p class="muted">Sem jogos nesta jornada.</p>'; return; }
  list.innerHTML = d.games.map((g) => {
    const mine = state.picks[g.id];
    const score = g.score ? `<span class="score">${g.score[0]} – ${g.score[1]}</span>` : '<span>vs</span>';
    let status = '';
    if (g.outcome && mine) status = mine === g.outcome ? '<span class="badge ok">✓ acertaste</span>' : '<span class="badge bad">✗ falhaste</span>';
    else if (g.locked && !g.score) status = '<span>em jogo / a aguardar resultado</span>';
    const buttons = ['1', 'X', '2'].map((p) => {
      const cls = [mine === p ? 'sel' : '', g.outcome ? (g.outcome === p ? 'real' : '') : '', g.outcome && mine === p ? (mine === g.outcome ? 'right' : 'wrong') : ''].join(' ');
      return `<button data-game="${g.id}" data-pick="${p}" class="${cls}" ${g.locked ? 'disabled' : ''}>${LABELS[p]}</button>`;
    }).join('');
    return `<article class="game"><div class="when"><span>${fmtWhen(g)}</span>${status}</div>
      <div class="teams"><span>${esc(g.home)}</span>${score}<span>${esc(g.away)}</span></div>
      <div class="picks">${buttons}</div></article>`;
  }).join('');
}

$('gameList').onclick = async (e) => {
  const b = e.target.closest('button[data-pick]');
  if (!b) return;
  if (!state.user) { showLogin(); $('login').scrollIntoView({ behavior: 'smooth' }); toast('Entra primeiro para votares.'); return; }
  const prev = state.picks[b.dataset.game];
  state.picks[b.dataset.game] = b.dataset.pick;
  renderGames();
  try {
    const r = await api('vote', { nick: state.user.nick, pin: state.user.pin, gameId: b.dataset.game, pick: b.dataset.pick });
    state.picks = r.picks;
    toast('Voto guardado ✓');
  } catch (err) {
    if (prev) state.picks[b.dataset.game] = prev; else delete state.picks[b.dataset.game];
    toast(err.message);
    if (err.status === 409) await loadRound(state.round); else renderGames();
  }
};

async function loadRound(round) {
  state.data = null; renderGames();
  try {
    const d = await api(`round?div=${state.div}` + (round ? `&round=${round}` : ''));
    state.data = d; state.round = d.round;
    $('round').innerHTML = d.rounds.map((n) => `<option value="${n}" ${n === d.round ? 'selected' : ''}>Jornada ${n}</option>`).join('');
    const i = d.rounds.indexOf(d.round);
    $('prev').disabled = i <= 0; $('next').disabled = i < 0 || i >= d.rounds.length - 1;
    renderGames();
  } catch (err) {
    $('gameList').innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}

$('division').onchange = () => { state.div = $('division').value; state.round = null; loadRound(null); };
$('round').onchange = () => loadRound(+$('round').value);
$('prev').onclick = () => loadRound(state.data.rounds[state.data.rounds.indexOf(state.round) - 1]);
$('next').onclick = () => loadRound(state.data.rounds[state.data.rounds.indexOf(state.round) + 1]);

// ---------- classificação ----------
async function loadBoard() {
  const box = $('boardList');
  box.innerHTML = '<p class="muted">A carregar…</p>';
  try {
    const { rows } = await api('leaderboard?div=' + $('boardDiv').value);
    if (!rows.length) { box.innerHTML = '<p class="muted">Ainda ninguém votou.</p>'; return; }
    box.innerHTML = `<table><thead><tr><th>#</th><th class="nick">Nick</th><th>Pts</th><th>Jogos</th><th>%</th><th>Por jogar</th></tr></thead><tbody>${rows.map((r) =>
      `<tr class="${state.user && r.nick.toLowerCase() === state.user.nick.toLowerCase() ? 'me' : ''}"><td>${r.rank}</td><td class="nick">${esc(r.nick)}</td><td class="pts">${r.pts}</td><td>${r.played}</td><td>${r.pct}</td><td>${r.open}</td></tr>`).join('')}</tbody></table>`;
  } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}
$('boardDiv').onchange = loadBoard;

document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
  $('games').hidden = b.dataset.tab !== 'games';
  $('board').hidden = b.dataset.tab !== 'board';
  if (b.dataset.tab === 'board') loadBoard();
}));

// ---------- arranque ----------
(async () => {
  state.divisions = await api('divisions');
  $('division').innerHTML = state.divisions.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  $('boardDiv').innerHTML = '<option value="all">Todas as divisões</option>' + $('division').innerHTML;
  state.div = state.divisions[0].id;

  const saved = store.get();
  if (saved) { try { await login(saved.nick, saved.pin); } catch { store.del(); } }
  renderWho(); showLogin();
  loadRound(null);
})();
