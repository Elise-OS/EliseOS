FROM node:24-bookworm-slim

WORKDIR /app

RUN npm install bonjour-service@1.4.2 --omit=dev --no-audit --no-fund

COPY docker/mdns/publisher.cjs /app/publisher.cjs

ENTRYPOINT ["node", "/app/publisher.cjs"]
