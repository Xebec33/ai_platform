FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
COPY 前端/package.json 前端/package.json
COPY 后端/package.json 后端/package.json
COPY 共享类型/package.json 共享类型/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace=@ai-workflow/shared-types \
  && npm run build --workspace=@ai-workflow/frontend

FROM nginx:1.27-alpine
COPY Docker/前端/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/前端/dist /usr/share/nginx/html
EXPOSE 80
