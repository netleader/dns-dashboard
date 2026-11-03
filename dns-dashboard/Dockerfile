# Built locally by the Home Assistant Supervisor; the official Node image covers aarch64 and amd64.
FROM node:24-alpine AS build
WORKDIR /src
COPY app/package.json app/package-lock.json ./
COPY app/server/package.json server/
COPY app/web/package.json web/
RUN npm ci --no-audit --no-fund
COPY app/server server
COPY app/web web
RUN npm run build -w web

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY app/package.json app/package-lock.json ./
COPY app/server/package.json server/
COPY app/web/package.json web/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force
COPY app/server/src server/src
COPY --from=build /src/web/dist web/dist

EXPOSE 8099
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
