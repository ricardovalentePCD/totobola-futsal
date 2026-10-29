import { getStore } from '@netlify/blobs';

const mem = new Map();

// Pequena camada sobre o Netlify Blobs (ou memória, para testes locais)
export function db() {
  if (process.env.TOTOBOLA_MEM) {
    return {
      get: async (k) => (mem.has(k) ? structuredClone(mem.get(k)) : null),
      set: async (k, v) => void mem.set(k, structuredClone(v)),
      list: async (p) => [...mem.keys()].filter((k) => k.startsWith(p)),
    };
  }
  const s = getStore({ name: 'totobola', consistency: 'strong' });
  return {
    get: (k) => s.get(k, { type: 'json' }),
    set: (k, v) => s.setJSON(k, v),
    list: async (p) => {
      const { blobs } = await s.list({ prefix: p });
      return blobs.map((b) => b.key);
    },
  };
}
