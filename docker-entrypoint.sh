#!/bin/sh
# Arranque de la imagen combinada (frontend nginx + API Node + seed de Prisma).
#
# Antes esto era una sola cadena en el CMD: "nginx && migrate deploy && seed && server". El problema
# no era el orden, era que cualquier error de Prisma o del seed se llevaba puesto al contenedor
# entero: nginx moria con el PID 1 y Traefik devolvia 502 en TODO el dominio, incluido "/". Paso por
# paso y con el aviso en el log, un 502 como el P3005 de 2026-10-22 se lee en un segundo.
#
# Variables que afectan este script:
#   PRISMA_BASELINE=1  aplica el baseline de la migracion inicial UNA sola vez (ver el bloque P3005).

MIGRATION_BASELINE="20260810000000_init"

echo "[entrypoint] nginx (frontend + proxy a la API)"
nginx || {
  echo "[entrypoint] FALLO nginx. Sin nginx el dominio da 502 aunque la API arranque, y el puerto 80"
  echo "[entrypoint] es el que expone Dokploy: exit para que el log muestre el paso que falla."
  exit 1
}

echo "[entrypoint] prisma migrate deploy"
if npx prisma migrate deploy; then
  echo "[entrypoint] esquema OK"
else
  # P3005 ("The database schema is not empty") significa que la base ya tiene tablas pero la tabla
  # _prisma_migrations no existe o esta vacia. Es el caso tipico de una base que se armo con
  # "prisma db push" (asi venia haciendo esta imagen), y NO es un problema de datos: las tablas y
  # las filas siguen intactas. La unica solucion correcta es decirle a Prisma que la migracion
  # inicial ya esta aplicada (baseliniar), una sola vez.
  #
  # Se hace detras de un flag explicito y solo cuando migrate deploy fallo, asi no puede baseliniar
  # una base vacia por accidente (ahi migrate deploy crea todo y este bloque ni se ejecuta).
  if [ "$PRISMA_BASELINE" = "1" ]; then
    echo "[entrypoint] PRISMA_BASELINE=1: marco $MIGRATION_BASELINE como aplicada"
    npx prisma migrate resolve --applied "$MIGRATION_BASELINE" || {
      echo "[entrypoint] FALLO el baseline. Sin tocar la base, revisa DATABASE_URL y permisos."
      exit 1
    }
    echo "[entrypoint] reintento prisma migrate deploy"
    npx prisma migrate deploy || {
      echo "[entrypoint] el deploy sigue fallando despues del baseline. Leé el error de arriba:"
      echo "[entrypoint] P3008 = la migracion cambio despues de aplicarse; otro codigo = conexion,"
      echo "[entrypoint] permisos o esquema. No levantes la API sobre un esquema sin verificar."
      exit 1
    }
    echo "[entrypoint] esquema OK (baseliniado)"
  else
    echo "[entrypoint] FALLO prisma migrate deploy. Si el error de arriba es P3005, la base se"
    echo "[entrypoint] creo con 'db push' y hay que baseliniarla una sola vez:"
    echo "[entrypoint]   1. Agrega la variable de entorno PRISMA_BASELINE=1 al servicio."
    echo "[entrypoint]   2. Redeploya. El log debe mostrar 'esquema OK' y la API levantando."
    echo "[entrypoint]   3. Quita PRISMA_BASELINE y redeploya (queda como arranque normal)."
    echo "[entrypoint] Comando equivalente, para correrlo dentro del contenedor:"
    echo "[entrypoint]   npx prisma migrate resolve --applied $MIGRATION_BASELINE"
    exit 1
  fi
fi

echo "[entrypoint] seed (idempotente: no pisa contrasenas existentes)"
node dist/prisma/seed.js || {
  echo "[entrypoint] FALLO el seed. La API no arranca sin roles/admin: revisa el error de arriba."
  exit 1
}

echo "[entrypoint] API en el puerto ${PORT:-3000}"
exec node dist/server.js
