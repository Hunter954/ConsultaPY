# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Copia primeiro apenas os arquivos de dependências para aproveitar o cache.
COPY package.json .npmrc ./

# Cache do npm reduz downloads repetidos nos próximos builds do Railway.
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

COPY . .

# O processo roda como root dentro do container para conseguir escrever no
# Volume montado pelo Railway em /data, mesmo quando o mount substitui as
# permissões criadas durante o build.
RUN mkdir -p /data/baileys && chmod -R 0777 /data

EXPOSE 3000

CMD ["npm", "start"]
