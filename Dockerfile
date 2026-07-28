FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# O Railway monta o Volume em tempo de execução e esse mount pode substituir
# as permissões preparadas durante o build. O processo precisa conseguir criar
# /data/baileys dentro do Volume persistente.
RUN mkdir -p /data/baileys

EXPOSE 3000
CMD ["npm", "start"]
