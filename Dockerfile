FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/baileys && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["npm", "start"]
