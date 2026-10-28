FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production DB_PATH=/data/tetradochka.db
CMD ["node", "src/main.ts"]
