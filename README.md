# Totobola Futsal

Palpites vitória/empate/derrota (da equipa da casa) por jornada, com classificação geral por nick.
Jogos e resultados vêm do zerozero.pt. Como o zerozero recusa (403) os servidores do Netlify, um script (`scripts/sync.mjs`) corre num Mac e envia os dados para o site (`POST /api/sync`, protegido por `SYNC_KEY`). Tudo fica em Netlify Blobs.

## Regras
- Nick + PIN (4–6 números) no primeiro acesso: cria o registo. O nick **não pode ser alterado** e é único (sem distinguir maiúsculas/acentos).
- Palpite alterável até ao início do jogo; depois fica fechado (validado no servidor).
- 1 ponto por resultado certo. Os resultados entram quando o script os apanha no zerozero (de 15 em 15 min, com o Mac ligado).
- Classificação geral ou por divisão.

## Adicionar uma divisão
Editar `netlify/functions/lib/divisions.json` e acrescentar `{ "id": "...", "name": "...", "edition": <id da edição no zerozero> }`.
O id da edição está no URL (`/edicao/.../223798`) ou em `id_edicao=` nos links da página da competição.
Quando uma competição muda de fase (ex.: 2ª fase), o zerozero cria uma nova edição: acrescentar com o novo id.

## Sincronização (obrigatória)
1. Netlify → Project configuration → Environment variables → criar `SYNC_KEY` com um valor secreto (`openssl rand -hex 24`) e fazer novo deploy.
2. No Mac: `./scripts/install-sync.sh https://o-teu-site.netlify.app` (pede a mesma chave). Agenda o sync de 15 em 15 min.
3. Primeira vez: `node scripts/sync.mjs --all` para carregar todas as jornadas.
Log: `~/Library/Logs/totobola-sync.log`. Só actualiza com o Mac ligado e acordado.

## Publicar
1. Pôr esta pasta num repositório GitHub.
2. Netlify → Add new project → Import from Git → escolher o repositório (sem build command; `netlify.toml` já define tudo).
3. Cada `git push` publica automaticamente.

## Testar localmente
- `npm install && npm test` — teste de fumo da API (usa o zerozero real, dados em memória).
- `node scripts/dev.mjs` — abre http://localhost:8888 com dados em memória (perdem-se ao parar).
- `netlify dev` (Netlify CLI) — igual ao de produção, com Blobs reais de sandbox.
