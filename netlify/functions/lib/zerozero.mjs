// Lê jornadas do zerozero.pt (HTML público). Corre só no servidor.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const clean = (s) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();

function tzOffsetMs(ts, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ts)).map((x) => [x.type, x.value])
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

// hora "de parede" em Lisboa -> instante UTC
export function lisbonToDate(y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - tzOffsetMs(wall, 'Europe/Lisbon');
  t = wall - tzOffsetMs(t, 'Europe/Lisbon');
  return new Date(t);
}

export function parseRound(html, wantedRound) {
  const title = clean((html.match(/<title>([^<]*)/) || [, ''])[1]).split(' - ')[0];

  const rounds = [];
  let current = null;
  const sel = html.match(/<select[^>]*name="jornada_in"[^>]*>([\s\S]*?)<\/select>/);
  if (sel) {
    for (const m of sel[1].matchAll(/<option value="(\d+)"\s*(selected)?\s*>/g)) {
      const n = +m[1];
      if (!n) continue;
      rounds.push(n);
      if (m[2]) current = n;
    }
  }
  const round = wantedRound || current || rounds[0] || null;

  // segmento da jornada pedida: do cabeçalho "JORNADA n" até ao próximo
  const heads = [...html.matchAll(/<h3[^>]*>\s*JORNADA (\d+)\s*<\/h3>/g)];
  let seg = '';
  for (let i = 0; i < heads.length; i++) {
    if (+heads[i][1] === round) {
      seg = html.slice(heads[i].index, i + 1 < heads.length ? heads[i + 1].index : undefined);
      break;
    }
  }

  const games = [];
  const rowRe = /<td class="text"[^>]*>\s*<a [^>]*>([\s\S]*?)<\/a><\/td>\s*<td><a [^>]*><img[^>]*><\/a><\/td>\s*<td id="tdl_(\d+)" class="([^"]*)"><a href="\/jogo\/(\d{4})-(\d\d)-(\d\d)-[^"]*">([^<]*)<\/a><\/td>\s*<td><a [^>]*><img[^>]*><\/a><\/td>\s*<td class="text"[^>]*>\s*<a [^>]*>([\s\S]*?)<\/a>/g;
  for (const m of seg.matchAll(rowRe)) {
    const [, home, id, cls, y, mo, d, txt, away] = m;
    const text = clean(txt);
    const time = text.match(/^(\d{1,2}):(\d{2})$/);
    const score = text.match(/^(\d+)\s*-\s*(\d+)$/);
    const kickoff = lisbonToDate(+y, +mo, +d, time ? +time[1] : 0, time ? +time[2] : 0);
    games.push({
      id,
      home: clean(home),
      away: clean(away),
      kickoff: kickoff.toISOString(),
      timeKnown: !!time,
      // resultado só conta se o zerozero o marca como "result" (não ao vivo)
      score: score && /\bresult\b/.test(cls) ? [+score[1], +score[2]] : null,
      live: !!score && !/\bresult\b/.test(cls),
    });
  }
  return { title, round, rounds, games };
}

export async function fetchRound(edition, round) {
  const url = `https://www.zerozero.pt/edition.php?id_edicao=${edition}` + (round ? `&jornada_in=${round}` : '');
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'pt-PT,pt;q=0.9' } });
  if (!res.ok) throw new Error(`zerozero ${res.status}`);
  return parseRound(await res.text(), round);
}

export const outcomeOf = ([h, a]) => (h > a ? '1' : h < a ? '2' : 'X');
