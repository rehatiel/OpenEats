# --- OpenEats backend: Express + SQLite (better-sqlite3) ---
FROM node:20-alpine

WORKDIR /app

# better-sqlite3 compiles a native addon at install time; these are needed on alpine.
RUN apk add --no-cache python3 make g++

# Copy manifest first so `npm ci` is cached unless dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Mount point for the named volume that persists the SQLite database file.
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000

CMD ["node", "src/index.js"]
