# ==== Build del servidor (Node + Prisma) ====
FROM node:20-alpine AS server-builder

WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/prisma ./prisma
RUN npx prisma generate
COPY server/ ./
RUN npm run build

# ==== Build del cliente (React + Vite) ====
FROM node:20-alpine AS client-builder

WORKDIR /app
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ==== Runtime: servidor (API :3000) + frontend (nginx :80) ====
FROM node:20-alpine

RUN apk add --no-cache nginx

WORKDIR /app
COPY --from=server-builder /app/dist ./dist
COPY --from=server-builder /app/node_modules ./node_modules
COPY --from=server-builder /app/package.json ./
COPY --from=server-builder /app/prisma ./prisma

COPY --from=client-builder /app/dist /usr/share/nginx/html

RUN mkdir -p /app/uploads/screenshots

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 3000

CMD ["sh", "-c", "nginx && npx prisma migrate deploy && npx prisma db seed && node dist/server.js"]
