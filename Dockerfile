FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000

# Copia primeiro os arquivos de dependências para aproveitar o cache de camadas.
COPY package*.json ./

# Sem --mount: essa sintaxe estava sendo rejeitada pelo builder do Railway.
RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

COPY . .

# O serviço permanece como root para conseguir escrever no Volume montado em /data.
RUN mkdir -p /data/baileys && chmod -R 0777 /data

EXPOSE 3000

CMD ["npm", "start"]
