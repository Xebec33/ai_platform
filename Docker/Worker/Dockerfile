FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY 前端/package.json 前端/package.json
COPY 后端/package.json 后端/package.json
COPY 共享类型/package.json 共享类型/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace=@ai-workflow/shared-types \
  && npm run build --workspace=@ai-workflow/backend

WORKDIR /app
ENV NODE_ENV=production
CMD ["node", "后端/dist/server.js"]
