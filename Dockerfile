# -------- Stage 1: Build --------
FROM node:20-alpine AS builder

# Enable pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Root deps + patches
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build both client and server
# "build" script runs: vite build (client) && esbuild (server)
RUN pnpm run build

# -------- Stage 2: Runtime (Node.js) --------
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built assets and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the Node.js server
CMD ["npm", "run", "start"]
