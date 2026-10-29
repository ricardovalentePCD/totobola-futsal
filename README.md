# Totobola Futsal

Palpites vitória/empate/derrota (da equipa da casa) por jornada, com classificação geral por nick.
Jogos e resultados vêm do zerozero.pt, lidos no servidor (Netlify Functions). Dados guardados em Netlify Blobs.

## Regras
- Nick + PIN (4–6 números) no primeiro acesso: cria o registo. O nick **não pode ser alterado** e é único (sem distinguir maiúsculas/acentos).
- Palpite alterável até ao início do jogo; depois fica fechado (validado no servidor).
- 1 ponto por resultado certo. Resultado entra sozinho ~75 min após o início (verificado no máximo de 5 em 5 min).
- Classificação geral ou por divisão.

## Adicionar uma divisão
Editar `netlify/functions/lib/divisions.json` e acrescentar `{ "id": "...", "name": "...", "edition": <id da edição no zerozero> }`.
O id da edição está no URL (`/edicao/.../223798`) ou em `id_edicao=` nos links da página da competição.
Quando uma competição muda de fase (ex.: 2ª fase), o zerozero cria uma nova edição: acrescentar com o novo id.

## Publicar
1. Pôr esta pasta num repositório GitHub.
2. Netlify → Add new project → Import from Git → escolher o repositório (sem build command; `netlify.toml` já define tudo).
3. Cada `git push` publica automaticamente.

## Testar localmente
- `npm install && npm test` — teste de fumo da API (usa o zerozero real, dados em memória).
- `node scripts/dev.mjs` — abre http://localhost:8888 com dados em memória (perdem-se ao parar).
- `netlify dev` (Netlify CLI) — igual ao de produção, com Blobs reais de sandbox.
