# FIX_MASTER API image.
#   docker build -t fix-master-api .
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so this layer is cached until package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY database ./database

# Never run the app as root inside the container.
USER node

EXPOSE 5000

# Liveness only: /api/health/live does not touch the database, so a database
# blip doesn't get a healthy API container killed and restarted.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Apply pending migrations, then start. `exec` makes node PID 1 so it receives
# SIGTERM directly and runs its graceful shutdown. Concurrent replicas are
# safe: the migration runner holds a database advisory lock.
CMD ["sh", "-c", "node scripts/migrate.js && exec node src/server.js"]
