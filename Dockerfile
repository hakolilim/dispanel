# ---------- Build stage ----------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build client + server
COPY . .
RUN npm run build

# Remove devDependencies; Vite is loaded dynamically only in development.
RUN npm prune --omit=dev

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
