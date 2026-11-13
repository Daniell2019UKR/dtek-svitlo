# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --omit=dev \
    && npm cache clean --force \
    && mkdir /app/data && chown node:node /app/data
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production PORT=3000 CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
