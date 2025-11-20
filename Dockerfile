# -------- Stage 1: Build (static assets) --------
FROM node:20-alpine AS builder

# Enable pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Work at repo root (your package.json, vite.config.*, tsconfig*.json live here)
WORKDIR /app

# Root deps + patches (needed before install because of pnpm patchedDependencies)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Root-level configs used by Vite/TS
COPY vite.config.* ./
COPY tsconfig*.json ./

# Client bits (your app code)
COPY client/index.html client/index.html
COPY client/public client/public
COPY client/src client/src

# If you use production env vars for Vite, uncomment the next line:
# COPY .env.production ./

# Build ONLY the client (your package.json should have: "build:client": "vite build")
RUN pnpm run build:client


# -------- Stage 2: Runtime (Nginx serving static) --------
FROM nginx:alpine

# SPA-friendly nginx config with history fallback and long-lived static caching
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / { try_files $uri /index.html; }\n\
    location ~* \\.(?:js|css|woff2?|ttf|eot|png|jpg|jpeg|gif|svg)$ {\n\
    add_header Cache-Control "public, max-age=31536000, immutable";\n\
    }\n\
    }\n' > /etc/nginx/conf.d/default.conf

# IMPORTANT: your Vite outDir currently ends up at /app/dist/public
# so we copy THAT folder into Nginx's web root:
COPY --from=builder /app/dist/public /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
