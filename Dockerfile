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

# Validar la config en el build. Sin esto, una directiva mal escrita (o un map fuera de contexto)
# recién se ve en produccion: nginx falla con [emerg], el arranque muere con el PID 1 (o deja la API
# sin proxy) y el contenedor entra en crash-loop con 502 en todo el dominio.
RUN nginx -t

EXPOSE 80 3000

# migrate deploy (no "db push"): db push altera el esquema sin dejar registro en
# _prisma_migrations, así que dos contenedores con imágenes distintas pueden dejar la base en un
# estado que nadie puede reproducir. El seed es idempotente y no pisa contraseñas existentes.
#
# El arranque vive en docker-entrypoint.sh, no en una cadena && del CMD: con la cadena, un error de
# Prisma o del seed mataba al contenedor entero y Traefik devolvía 502 en todo el dominio.
#
# Si esta base ya se creó con "db push", migrate deploy falla con P3005 ("schema is not empty") y
# hay que baseliniar UNA vez. Dos caminos, el primero no depende de la UI de Dokploy:
#   a) agregar PRISMA_BASELINE=1 al servicio, redeployar una vez, y quitarla (el entrypoint hace el
#      `migrate resolve --applied` y reintenta el deploy); o
#   b) correr a mano en el contenedor:
#        npx prisma migrate resolve --applied 20260810000000_init
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

CMD ["/app/docker-entrypoint.sh"]
