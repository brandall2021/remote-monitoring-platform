# ==== Build del servidor (Node + Prisma) ====
FROM node:20-alpine AS server-builder

WORKDIR /app
RUN apk add --no-cache openssl
COPY server/package*.json ./
RUN npm ci
COPY server/prisma ./prisma
RUN npx prisma generate
COPY server/ ./
RUN npm run build && npm run build:seed

# ==== Build del cliente (React + Vite) ====
FROM node:20-alpine AS client-builder

WORKDIR /app
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ==== Runtime: servidor (API :3000) + frontend (nginx :80) ====
FROM node:20-alpine

RUN apk add --no-cache nginx openssl

WORKDIR /app
COPY --from=server-builder /app/dist ./dist
COPY --from=server-builder /app/node_modules ./node_modules
COPY --from=server-builder /app/package.json ./
COPY --from=server-builder /app/prisma ./prisma

COPY --from=client-builder /app/dist /usr/share/nginx/html

RUN mkdir -p /app/uploads/screenshots

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 3000

# migrate deploy (no "db push"): db push altera el esquema sin dejar registro en
# _prisma_migrations, así que dos contenedores con imágenes distintas pueden dejar la base en un
# estado que nadie puede reproducir. El seed es idempotente y no pisa contraseñas existentes.
#
# Si esta base ya se creó con "db push", hay que baseliniar UNA vez antes del primer deploy:
#   npx prisma migrate resolve --applied 20260810000000_init
CMD ["sh", "-c", "nginx && npx prisma migrate deploy && node dist/prisma/seed.js && node dist/server.js"]
