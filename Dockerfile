# -----------------------------
# Étape 1 : Build du backend
# -----------------------------
FROM node:22-trixie-slim AS build

WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip build-essential openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

COPY scripts/entrypoint.sh .
RUN chmod +x entrypoint.sh

# Replace CMD
CMD ["./entrypoint.sh"]