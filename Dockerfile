FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY bot.cjs ./
COPY kyro_settings.json ./
COPY monitored_group.json ./

ENV NODE_ENV=production
ENV BOT_PORT=3001

EXPOSE 3001

CMD ["node", "bot.cjs"]
