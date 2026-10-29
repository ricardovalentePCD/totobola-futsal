// Lê o zerozero (a partir deste computador, que não é bloqueado) e envia jogos e resultados para o site.
// Config: ~/.config/totobola/sync.json  { "url": "https://....netlify.app", "key": "<SYNC_KEY>" }
//   node scripts/sync.mjs          jornada actual ± 1 de cada divisão
//   node scripts/sync.mjs --all    todas as jornadas (primeira vez / reparar)
//   node scripts/sync.mjs --auto   só corre quando a agenda manda (usado pelo launchd, de 15 em 15 min):
//                                  segunda 10:00 -> carga completa (recupera se o Mac estava adormecido)
//                                  sábado e domingo 10:00-22:00 -> jornada actual ± 1
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import divisions from '../netlify/functions/lib/divisions.json' with { type: 'json' };
import { fetchRound } from '../netlify/functions/lib/zerozero.mjs';

// Decide o que fazer agora: 'full' | 'normal' | null (hora local do computador).
export function planAuto(now, lastFull) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 10, 0, 0);
  if (now >= monday && (!lastFull || lastFull < monday)) return 'full';
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (weekend && mins >= 10 * 60 && mins < 22 * 60 + 15) return 'normal';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Devolve o payload de uma divisão: jornada actual e as jornadas pedidas.
export async function collectDivision(div, { all = false, delay = 600 } = {}) {
  const first = await fetchRound(div.edition, null);
  const wanted = all
    ? first.rounds
    : first.rounds.filter((n) => Math.abs(n - first.round) <= 1);
  const data = [];
  for (const n of wanted) {
    if (n === first.round) { data.push({ round: n, games: first.games }); continue; }
    await sleep(delay);
    const r = await fetchRound(div.edition, n);
    data.push({ round: n, games: r.games });
  }
  return { div: div.id, title: first.title, current: first.round, rounds: first.rounds, data };
}

async function main() {
  const cfg = JSON.parse(await readFile(join(homedir(), '.config/totobola/sync.json'), 'utf8'));
  if (!/^[0-9a-f]{48}$/.test(cfg.key ?? '')) {
    console.error('A chave em ~/.config/totobola/sync.json é inválida (devem ser 48 caracteres 0-9 a-f). Volta a correr scripts/install-sync.sh.');
    process.exit(1);
  }
  const stateFile = join(homedir(), '.config/totobola/state.json');
  let all = process.argv.includes('--all');
  if (process.argv.includes('--auto')) {
    const state = await readFile(stateFile, 'utf8').then(JSON.parse, () => ({}));
    const plan = planAuto(new Date(), state.lastFull ? new Date(state.lastFull) : null);
    if (!plan) process.exit(0);
    all = plan === 'full';
  }
  let failed = 0;
  for (const div of divisions) {
    try {
      const payload = await collectDivision(div, { all });
      const res = await fetch(cfg.url.replace(/\/$/, '') + '/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': cfg.key },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`site ${res.status}: ${await res.text()}`);
      console.log(`${new Date().toISOString()} ok  ${div.id} (jornada ${payload.current}, ${payload.data.length} jornadas)`);
    } catch (e) {
      failed++;
      console.error(`${new Date().toISOString()} ERRO ${div.id}: ${e.message}`);
    }
    await sleep(600);
  }
  if (all && !failed) await writeFile(stateFile, JSON.stringify({ lastFull: new Date().toISOString() }));
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
