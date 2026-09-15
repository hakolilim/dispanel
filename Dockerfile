# ---------- Build stage ----------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build client + server
COPY . .
RUN npm run build

# Remove devDependencies, keep production node_modules for the runtime image
# (the server bundle is built with --packages=external so deps are required at runtime).
# NOTE: server/index.ts statically imports ./vite.ts which imports "vite", so vite
# must remain installed even though it is a devDependency.
RUN npm prune --omit=dev && npm install --no-save "vite@^5.4.19"

# ---------- Runtime stage ----------
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Run as non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

# Copy production dependencies and build output
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

USER nodejs

EXPOSE 5000

CMD ["node", "dist/index.js"]
