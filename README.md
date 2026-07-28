# Consulta Paraguai WhatsApp

MVP em Node.js 20 com Baileys, Axios, Cheerio, Express e PostgreSQL. O usuário pesquisa produtos pelo WhatsApp e recebe produtos, ofertas e dados das lojas encontrados no Compras Paraguai.

## Recursos

- Comando `menu` e pesquisa direta pelo nome do produto.
- Seleção numerada de produto, oferta e loja.
- Estado de conversa, cache e logs no PostgreSQL.
- Painel protegido em `/admin`.
- QR Code do WhatsApp exibido no navegador.
- Reinício e desconexão da sessão pelo painel.
- Sessão Baileys persistida em Railway Volume.
- Healthcheck em `/health`.

## Rodar localmente

1. Tenha Node.js 20+ e PostgreSQL.
2. Copie `.env.example` para `.env`.
3. Preencha `DATABASE_URL`, `ADMIN_PASSWORD` e `SESSION_SECRET`.
4. Para desenvolvimento local, altere `BAILEYS_AUTH_DIR=./data/baileys` e `DATABASE_SSL=false`.
5. Execute:

```bash
npm install
npm start
```

Abra `http://localhost:3000/admin`.

## Deploy no Railway

1. Envie a pasta para um repositório GitHub.
2. No Railway, crie um projeto a partir desse repositório.
3. Adicione um serviço PostgreSQL.
4. Configure as variáveis usando `.env.example` como referência. O Railway normalmente fornece `DATABASE_URL` automaticamente ao referenciar o PostgreSQL.
5. Gere uma senha forte para `ADMIN_PASSWORD` e uma chave longa para `SESSION_SECRET`.
6. Crie um Volume no serviço do bot e monte-o exatamente em `/data`.
7. Gere um domínio público e defina `BASE_URL` com esse endereço.
8. Abra `https://seu-dominio/admin`, entre e leia o QR Code em WhatsApp → Aparelhos conectados → Conectar aparelho.

## Observações importantes

- Baileys é uma integração não oficial com WhatsApp Web. Evite spam e mensagens em massa.
- O parser depende do HTML do Compras Paraguai. Mudanças no site podem exigir atualização dos seletores.
- Preços e estoque devem ser confirmados diretamente com a loja.
- A sessão do painel usa memória do processo, adequada a um único container. Para múltiplas réplicas, troque o armazenamento da sessão por PostgreSQL ou Redis.
- `useMultiFileAuthState` foi usado no Volume para simplificar o MVP. Em uma versão de maior escala, implemente um armazenamento de credenciais dedicado.

## Fluxo do bot

1. Usuário envia `menu` ou o nome de um produto.
2. O bot consulta `/busca/?q=...`.
3. Usuário escolhe o produto.
4. O bot abre a página do produto e lista as ofertas.
5. Usuário escolhe a loja.
6. O bot abre a página da loja e retorna os dados encontrados.
