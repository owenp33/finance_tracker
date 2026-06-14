# ── Stage 1: build React ──────────────────────────────────────────────────────
FROM node:18-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# REACT_APP_API_URL is intentionally left empty — nginx proxies /api/* to Flask
# so the app uses relative URLs and works without CORS configuration.
RUN npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
