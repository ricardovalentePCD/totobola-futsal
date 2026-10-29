// Teste de fumo: corre a API em memória contra o zerozero real.
process.env.TOTOBOLA_MEM = '1';
import assert from 'node:assert/strict';
import api from '../netlify/functions/api.mjs';
import { db } from '../netlify/functions/lib/store.mjs';

const call = async (method, path, body) => {
  const res = await api(new Request('http://x' + path, { method, body: body && JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
};

// divisões
const divs = await call('GET', '/api/divisions');
assert.equal(divs.data.length, 6);

// jornada actual
const cur = await call('GET', '/api/round?div=sub17-sul');
assert.equal(cur.status, 200);
assert.ok(cur.data.games.length > 0 && cur.data.rounds.length === 14);
const open = cur.data.games.find((g) => !g.locked);
assert.ok(open, 'devia haver um jogo por começar');

// registo + validações
assert.equal((await call('POST', '/api/login', { nick: 'a', pin: '1234' })).status, 400);
assert.equal((await call('POST', '/api/login', { nick: 'Rui', pin: '12' })).status, 400);
const reg = await call('POST', '/api/login', { nick: 'Rui', pin: '1234' });
assert.ok(reg.data.created);
assert.equal((await call('POST', '/api/login', { nick: 'rui', pin: '9999' })).status, 401, 'nick igual (case-insens.) com PIN errado');
assert.equal((await call('POST', '/api/login', { nick: 'RUI', pin: '1234' })).data.created, false);

// voto válido, alterável, e rejeição de palpite inválido
let v = await call('POST', '/api/vote', { nick: 'Rui', pin: '1234', gameId: open.id, pick: '1' });
assert.deepEqual(v.data.picks, { [open.id]: '1' });
v = await call('POST', '/api/vote', { nick: 'Rui', pin: '1234', gameId: open.id, pick: 'X' });
assert.equal(v.data.picks[open.id], 'X');
assert.equal((await call('POST', '/api/vote', { nick: 'Rui', pin: '1234', gameId: open.id, pick: '3' })).status, 400);
assert.equal((await call('POST', '/api/vote', { nick: 'Rui', pin: '0000', gameId: open.id, pick: '1' })).status, 401);

// jornada 1 já jogada: tem resultado, voto fechado
const j1 = await call('GET', '/api/round?div=sub17-sul&round=1');
assert.ok(j1.data.games.every((g) => g.locked && g.score && g.outcome));
assert.equal((await call('POST', '/api/vote', { nick: 'Rui', pin: '1234', gameId: j1.data.games[0].id, pick: '1' })).status, 409);

// classificação: injecta votos na jornada 1 (como se tivessem sido feitos antes) e confere pontos
const store = db();
const [g0, g1] = j1.data.games;
await store.set('votes/ana', { nick: 'Ana', picks: { [g0.id]: g0.outcome, [g1.id]: g1.outcome } }); // 2/2
await store.set('votes/bia', { nick: 'Bia', picks: { [g0.id]: g0.outcome, [g1.id]: g1.outcome === '1' ? '2' : '1' } }); // 1/2
const lb = await call('GET', '/api/leaderboard?div=all');
const row = (n) => lb.data.rows.find((r) => r.nick === n);
assert.equal(row('Ana').pts, 2); assert.equal(row('Ana').rank, 1);
assert.equal(row('Bia').pts, 1); assert.equal(row('Bia').played, 2);
assert.equal(row('Rui').pts, 0); assert.equal(row('Rui').open, 1);
const lbOther = await call('GET', '/api/leaderboard?div=jun-b-1');
assert.equal(row('Ana') && lbOther.data.rows.find((r) => r.nick === 'Ana').played, 0, 'filtro por divisão');

console.log('OK — todos os testes passaram');
