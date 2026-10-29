// Lê o zerozero (a partir deste computador, que não é bloqueado) e envia jogos e resultados para o site.
// Config: ~/.config/totobola/sync.json  { "url": "https://....netlify.app", "key": "<SYNC_KEY>" }
//   node scripts/sync.mjs          jornada actual ± 1 de cada divisão
//   node scripts/sync.mjs --all    todas as jornadas (primeira vez / reparar)
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import divisions from '../netlify/functions/lib/divisions.json' with { type: 'json' };
import { fetchRound } from '../netlify/functions/lib/zerozero.mjs';

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
  const all = process.argv.includes('--all');
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
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
