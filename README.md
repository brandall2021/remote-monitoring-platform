# Remote Monitoring Platform

Plataforma empresarial de monitoreo remoto autorizado. Sistema cliente-servidor para administracion de equipos corporativos con agentes que ejecutan acciones solicitadas por administradores autenticados.

Interfaz en espanol (footer `softgroup.com.ar`). Incluye capturas de pantalla bajo demanda, **vista en vivo** del escritorio por WebSocket y **grabacion en video** de la vista en vivo desde el navegador.

---

## Funcionalidades

- **Monitoreo de equipos**: los agentes se registran y reportan estado ONLINE/OFFLINE via heartbeat cada 30s.
- **Capturas de pantalla** bajo demanda (`POST /api/screenshots/request`).
- **Vista en vivo**: el agente manda una corriente continua de JPEG (0,25 s / 1 s / 2 s / 5 s por cuadro) al panel, sin un pedido por frame, capturada con un worker persistente (~6 cuadros/s reales).
- **Grabacion de video**: boton Grabar en la vista en vivo; genera un `.webm` descargable (MediaRecorder + canvas).
- **Comandos remotos**: screenshot, informacion del sistema, lista de procesos, bloqueo de pantalla, apagado, reinicio, logout.
- **Auditoria completa**, roles y permisos (RBAC).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DOKPLOY (PaaS)                              │
│                                                                     │
│  ┌────────────────┐        ┌─────────────────────────────────────┐  │
│  │  PostgreSQL 16  │        │  App Custom (server + client)      │  │
│  │ (servicio Dok) │        │  ┌───────────────────────────────┐  │  │
│  │     5432       │        │  │  nginx (80) → SPA React        │  │  │
│  └───────┬────────┘        │  │   ├─ /api ───────────────┐    │  │  │
│          │                 │  │   └─ /socket.io ────────┐│    │  │  │
│  ┌───────┴────────┐        │  │                         ▼▼    │  │  │
│  │    Redis 7      │        │  │  Node.js + Express + Socket.IO  │  │  │
│  │ (servicio Dok) │        │  │  (3000) · migrate deploy + seed │  │  │
│  │     6379       │        │  └───────────────────────────────┘  │  │
│  └───────┬────────┘        │                                      │  │  │
│          │                 │                                      │  │
└──────────┼─────────────────┼──────────────────────────────────────┘
           │                 │ HTTPS
           │                 │
           └────────────┬────┼────────────────────┬─────────────────
                        │    │                    │
                 ┌──────┴────┴──┐        ┌───────┴──────┐
                 │   Agente 1   │        │   Agente N   │
                 │   Windows    │        │   Windows    │
                 │   (PCs)      │        │   (PCs)      │
                 └──────────────┘        └──────────────┘
```

> El server y el client viven en UNA sola imagen: el `Dockerfile` de la raiz
> construye ambos y el contenedor corre nginx (:80) sirviendo el frontend y
> proxyeando `/api` y `/socket.io` a la API Node.js (:3000).
> `/uploads` **ya no existe**: las capturas se piden con `GET /api/screenshots/:id/image`,
> que valida el JWT y el permiso `SCREENSHOTS_VIEW` antes de leer el archivo del disco.
> PostgreSQL y Redis son servicios independientes de Dokploy.
> En el despliegue actual la app se llama `sistema-monitot-cxsbui`.

---

## Stack Tecnologico

| Componente | Tecnologia | Puerto |
|------------|------------|--------|
| **Server** | Node.js + Express + Prisma + Socket.IO | 3000 |
| **Client** | React 18 + Vite + Material UI | 80 (nginx) |
| **Agent** | Node.js + TypeScript (Windows) empaquetado con pkg | - |
| **Database** | PostgreSQL 16 | 5432 |
| **Cache** | Redis 7 | 6379 |
| **Auth** | JWT + Refresh Tokens | - |
| **Realtime** | Socket.IO (namespaces `/admin` y `/agent`) | - |

---

## Desplegar en Dokploy (App unica)

> El proyecto se despliega como UNA sola **Custom App**: el `Dockerfile` de la
> raiz construye server + client en la misma imagen (nginx :80 + API :3000).
> PostgreSQL y Redis se crean como servicios de Dokploy aparte.

### Paso 1: Generar Secrets

```bash
openssl rand -hex 32   # ejecutar 2 veces → JWT_SECRET y JWT_REFRESH_SECRET
openssl rand -hex 16   # AGENT_REGISTRATION_TOKEN
```

### Paso 2: Crear PostgreSQL y Redis en Dokploy

Crear servicios one-click y anotar host interno, usuario y contrasena (ej: `postgres.xxx.docker.internal:5432`).

### Paso 3: Crear la aplicacion Custom

1. **New Service** > **Application** > Provider **GitHub** > `remote-monitoring-platform` (rama `master`).
2. Build: `Dockerfile` de la raiz (deteccion automatica).
3. **Puerto a publicar: `80`** (nginx / frontend).
4. Configurar variables de entorno y **Deploy**.

### Paso 4: Variables de Entorno

Los tres secretos son **obligatorios**: si faltan (o si dejan un valor de ejemplo), el server
se niega a arrancar en produccion. Genera cada uno con `openssl rand -hex 32`.

```env
# === BASE DE DATOS (servicio PostgreSQL de Dokploy) ===
DATABASE_URL=postgresql://postgres:tu-contrasena@postgres.xxx.docker.internal:5432/remote_monitoring

# === REDIS (servicio Redis de Dokploy) ===
# Reservado para el adapter de socket.io multi-instancia; hoy el server no lo usa.
REDIS_URL=redis://redis.xxx.docker.internal:6379

# === JWT (obligatorios, min 32 chars) ===
JWT_SECRET=tu-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=tu-jwt-refresh-secret-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# === CORS (el dominio real de Dokploy) ===
CORS_ORIGIN=https://monitor.recuperocrediticio.com

# === AGENTE (token para registro de agentes) ===
AGENT_REGISTRATION_TOKEN=tu-agent-registration-token

# === COOKIES (el refresh token viaja en una cookie HttpOnly) ===
# Detras de HTTPS de Dokploy, dejar secure=true y sameSite=lax.
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax

# === PROXY ===
# nginx de este mismo contenedor: 1 salto. Sin esto el rate-limit de login se comparte
# entre todos los usuarios y la IP de la auditoria sale 127.0.0.1.
TRUST_PROXY_HOPS=1

# === BOOTSTRAP DEL SUPER_ADMIN (opcional) ===
# Si se omite, el seed genera una contrasena aleatoria y la imprime UNA sola vez en el log
# del primer arranque. Si se define, debe tener 12+ caracteres.
SEED_ADMIN_PASSWORD=

# === COTAS (opcional) ===
MAX_SCREENSHOT_BYTES=12582912
WS_MAX_BUFFER_BYTES=16777216
```

### Paso 5: Configurar Dominio (SSL)

En la app, **Domains** > agregar el dominio (ej. `monitor.recuperocrediticio.com`). Dokploy configura SSL automaticamente con Let's Encrypt. `CORS_ORIGIN` debe coincidir con el dominio.

### Paso 6: Verificar Deploy

- Abrir `https://<tu-dominio>` y loguearse.
- La contrasena del `SUPER_ADMIN` sale del log del **primer** arranque: si definiste
  `SEED_ADMIN_PASSWORD` es esa, y si no, el seed genera una aleatoria y la imprime una sola vez
  (`docker logs <contenedor>`, buscar `CONTRASEÑA INICIAL DEL SUPERADMIN`).
- Si la base ya tiene usuario, el seed **no toca la contrasena**: cambia lo que cambie en el deploy,
  la credencial que pusiste sigue vigente. (Aun se aplica el `admin123` historico si la base la creo
  el seed viejo: rotarla desde el panel una vez.)

> El contenedor arranca con `docker-entrypoint.sh`: levanta nginx, corre `npx prisma migrate deploy`,
> corre el seed y por ultimo `node dist/server.js` (con `exec`, para que Node reciba el SIGTERM). Cada
> paso se imprime en el log y un fallo de Prisma o del seed ya no se lleva puesto a nginx.
> El seed crea los 3 roles (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`) y el usuario admin solo la primera
> vez; en los arranques siguientes reconcilia nombre y apellido, nunca `passwordHash`.
>
> `migrate deploy` requiere la tabla `_prisma_migrations`. Si tu base se armo con `prisma db push`
> (era el CMD de las imagenes anteriores), falla con **P3005 - The database schema is not empty** y
> hay que baseliniar una sola vez. Dos caminos:
>
> 1. **Con una variable, sin tocar la UI ni pelear con el crash-loop:** agregá `PRISMA_BASELINE=1` al
>    servicio, redeployá, y en el log tiene que aparecer `marco 20260810000000_init como aplicada`
>    seguido de `esquema OK`. Después **quitá** la variable y redeployá.
> 2. **A mano, si el contenedor se puede abrir:** `docker exec -it <contenedor> sh` y adentro
>    `npx prisma migrate resolve --applied 20260810000000_init` (en Dokploy es la pestaña Terminal del
>    servicio; con crash-loop de pocos segundos suele no dar el tiempo, usá el camino 1).
>
> Baseliniar no toca los datos: solo registra en `_prisma_migrations` que la migracion inicial ya esta
> aplicada. Es seguro mientras el esquema de la base coincida con `server/prisma/schema.prisma`, que
> es el caso porque la ultima imagen que levanto usaba `db push` con ese mismo schema.

> **Este deploy desconecta las sesiones abiertas.** Los refresh tokens ahora se guardan como
> digesto SHA-256; los renglones viejos (en claro) ya no matchean y cada usuario vuelve a loguearse
> una vez. Aproveá el momento para limpiarlos (desde el `psql` del servicio PostgreSQL de Dokploy,
> o desde Prisma Studio): `TRUNCATE refresh_tokens;`

---

## Variables de Entorno - Referencia Completa

| Variable | Requerida | Descripcion | Valor por defecto |
|----------|:---------:|-------------|-------------------|
| `DATABASE_URL` | Si | Cadena de conexion PostgreSQL (servicio Dokploy) | - |
| `PRISMA_BASELINE` | No | Solo la lee `docker-entrypoint.sh`: con `1` marca la migracion inicial como aplicada cuando `migrate deploy` falla con P3005. Se usa un unico deploy y se quita | vacio (desactivado) |
| `REDIS_URL` | No | Cadena de conexion Redis. Hoy el server no la usa; hace falta si corras mas de una replica e instales `@socket.io/redis-adapter` | `redis://localhost:6379` |
| `JWT_SECRET` | Si | Secret para firmar JWT (min 32 chars). Sin valor o con valor de ejemplo, el server **no arranca** en produccion | - |
| `JWT_REFRESH_SECRET` | Si | Secret para refresh tokens (min 32 chars), tiene que ser distinto del anterior | - |
| `NODE_ENV` | No | `production` activa el fail-fast de secretos y la cookie `Secure`. | `development` |
| `JWT_EXPIRES_IN` | No | Tiempo de vida del access token | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | No | Tiempo de vida del refresh token | `7d` |
| `CORS_ORIGIN` | Si | Dominio permitido para CORS | - |
| `AGENT_REGISTRATION_TOKEN` | Si | Token compartido de onboarding de agentes (min 16 chars) | - |
| `SEED_ADMIN_PASSWORD` | No | Contrasena inicial del SUPER_ADMIN (min 12 chars). Vacia = generada y printada una vez | aleatoria |
| `COOKIE_SECURE` | No | `Secure` en la cookie del refresh token. `true` detras de HTTPS | `true` en produccion |
| `COOKIE_SAME_SITE` | No | `lax` / `strict` / `none` de la cookie del refresh token | `lax` |
| `REFRESH_COOKIE_NAME` | No | Nombre de la cookie del refresh token | `rm_refresh` |
| `TRUST_PROXY_HOPS` | No | Cuantos proxies hay delante de Express. Determina `req.ip` y los rate limits por IP | `1` |
| `PORT` | No | Puerto de la API dentro del contenedor | `3000` |
| `SCREENSHOTS_DIR` | No | Directorio de capturas de pantalla | `./uploads/screenshots` |
| `MAX_SCREENSHOT_BYTES` | No | Cota de bytes por captura que acepta el WebSocket | `12582912` (12 MB) |
| `WS_MAX_BUFFER_BYTES` | No | Mensaje maximo de socket.io (frame de live view) | `16777216` (16 MB) |
| `DEVICE_OFFLINE_AFTER_MS` | No | Sin heartbeat por ese tiempo, el equipo pasa a OFFLINE | `180000` |
| `WS_PING_INTERVAL_MS` / `WS_PING_TIMEOUT_MS` | No | Keepalive del canal de agentes. Con 5 s de timeout el live view se cortaba: un pong que tarda 6 s con el uplink ocupado cerraba la conexion | `25000` / `20000` |

---

## Compilar el Agente para Windows

Requisitos: **Node.js 18+** en la maquina de build (no en el PC destino) y **Windows 10/11** en los PCs destino.

```bash
cd remote-monitoring-platform/agent
npm install
npm run build          # compila a dist/agent.js
npm run package        # empaqueta agent.exe con pkg (node18-win-x64)
```

> El repositorio ya incluye los binarios pre-compilados **`agent/agent-live.exe`**
> (agente, con vista en vivo y frames JPEG comprimidos) y **`agent/tray/RmTray.exe`**
> (el icono de bandeja). Si regeneras el agente, se actualiza con `npm run package`
> (cambia el output a `agent-live.exe` si el `agent.exe` anterior esta corriendo y
> bloqueado). La bandeja se recompila con `npm run build:tray` (usa el `csc.exe` de
> .NET Framework 4 que viene con Windows; no agrega dependencias al `pkg`).

### Configuracion del agente

- Config a nivel maquina (despliegue corporativo): **`%ProgramData%\RemoteMonitoringAgent\agent.json`** (serverUrl, deviceId, registrationToken, heartbeatInterval). Un solo `deviceId` por PC, compartido por todos los usuarios.
- Fallback a nivel usuario (instalacion manual): **`%APPDATA%\remote-monitor-agent.json`**.
- Si no existe ninguna config, el agente se registra usando las variables `SERVER_URL` y `REGISTRATION_TOKEN`.
- `registrationToken` guardado es un **token unico por dispositivo** emitido por el server al registrarse (el token compartido de onboarding solo se usa para el alta).
- Ajustes del live view (variables de entorno del proceso del agente): `LIVE_MAX_WIDTH` (ancho maximo
  del cuadro, default `1280`) y `LIVE_JPEG_QUALITY` (calidad JPEG, default `70`). Bajar el ancho es lo
  que hace que un cuadro pese ~66 KB en vez de varios MB. `LIVE_CAPTURE_WORKER` (default `1`) levanta el
  worker de captura persistente; con `0` el agente vuelve a la captura por proceso. `LIVE_MAX_FRAME_BYTES`
  (default `8388608`) es el techo de tamano de un cuadro antes de considerarlo canal roto.
  `HEARTBEAT_INTERVAL` sigue en `30000` ms.

### Icono de bandeja

El agente muestra un punto de color en la bandeja del usuario: **verde** conectado,
**naranja** iniciando, **rojo** sin conexion, **gris** detenido. El menu del icono
dice equipo, ID, servidor, ultimo latido y ultimo error, y ofrece abrir el panel o
refrescar. Es el aviso visible del monitoreo, no un control: **no tiene boton de
salir ni de pausar**, y cerrarlo no baja el agente. El estado sale de
`%LOCALAPPDATA%\RemoteMonitoringAgent\status.json` (o `%ProgramData%`), un archivo
que el agente escribe con una allowlist de campos y que nunca contiene el token de
registro. El detalle completo esta en
[`agent/README.md`](agent/README.md#icono-de-bandeja-lo-que-ve-el-empleado).

### Distribucion

#### Opcion 1: Ejecutable + instalador (recomendado)

El instalador copia el exe y la bandeja a `%LOCALAPPDATA%\RemoteMonitoringAgent\`, registra una **tarea programada al iniciar sesion** que corre `RmTray.exe` (sin consola; la bandeja levanta y vigila al agente) y arranca el icono:

```powershell
# PC nueva (pide SERVER_URL y REGISTRATION_TOKEN si no hay config)
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1

# PC nueva sin prompts
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1 `
  -ServerUrl https://monitor.recuperocrediticio.com -RegistrationToken TU_TOKEN

# Desinstalar (opcional: -RemoveConfig borra la config guardada)
powershell -ExecutionPolicy Bypass -File .\installer\uninstall.ps1
```

> **Importante:** NO es un servicio de Windows real. Un servicio corre en
> "Session 0", separado del escritorio, y **no puede capturar la pantalla del
> usuario**. Por eso el agente se ejecuta al **iniciar sesion** del usuario,
> donde si tiene acceso al escritorio. Para actualizar el agente, regenerar el
> exe, copiarlo encima y volver a correr `install.ps1`.

#### Opcion 1b: Despliegue masivo (30+ PCs, PDQ / Intune / SCCM)

Para muchos equipos se usa **`agent/installer/install-silent.ps1`**, disenado para
correr en contexto **SYSTEM** (Session 0, sin interaccion). Hace todo en un paso:

1. Copia `agent-live.exe` a `C:\Program Files\RemoteMonitoringAgent\agent.exe` y
   `RmTray.exe` en la misma carpeta.
2. **Pre-registra el equipo** contra el server (genera su `deviceId` unico) y
   escribe la config a nivel maquina en `%ProgramData%\RemoteMonitoringAgent\agent.json`.
3. Registra la tarea programada **`RemoteMonitoringAgent` al logon de CUALQUIER
   usuario** (sesion interactiva), que corre la bandeja y desde ella el agente — asi
   cada usuario que inicie sesion levanta el agente con el mismo `deviceId` de la PC.
   Con `-Session0` la tarea del agente es al arranque de Windows como SYSTEM y la
   bandeja queda en una tarea aparte, `RemoteMonitoringAgent-Tray`, con `--status-only`.
4. Asegura la carpeta de config con ACLs: `SYSTEM` y `Administradores` control
   total, herencia de permisos removida. En modo logon `Users` queda **solo
   lectura** (el agente debe poder leer el bootstrap como usuario interactivo);
   en Session 0 `Users` no tiene acceso. El script avisa por log cuando la
   config puede ser leida por otros usuarios locales. `status.json`, el archivo
   que lee la bandeja, vive en el perfil del usuario y no lleva credenciales.

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install-silent.ps1 `
  -ServerUrl https://monitor.recuperocrediticio.com `
  -RegistrationToken TU_TOKEN

# Desinstalar (remueve tarea, binario y config)
powershell -ExecutionPolicy Bypass -File .\installer\uninstall-silent.ps1
```

> El `AGENT_REGISTRATION_TOKEN` queda **embebido** en el paquete de despliegue
> (aceptado para este caso de uso). El server lo valida solo en el alta y luego
> emite un token unico por dispositivo.

**Empaquetado por herramienta:**

- **PDQ Deploy:** package = `powershell.exe -ExecutionPolicy Bypass -File "install-silent.ps1" -ServerUrl ... -RegistrationToken ...`, corriendo como SYSTEM/dominio. Para update, usar un nuevo package o re-ejecutar el mismo.
- **Intune (Win32 app):** empaquetar `install-silent.ps1` + `agent-live.exe` + `tray\RmTray.exe` con *Microsoft Win32 Content Prep Tool*. Comando de instalacion: `powershell.exe -ExecutionPolicy Bypass -File "install-silent.ps1" -ServerUrl ... -RegistrationToken ...` (corre como SYSTEM). Regla de deteccion: archivo `C:\Program Files\RemoteMonitoringAgent\agent.exe` existe. Uninstall: `powershell.exe -ExecutionPolicy Bypass -File "uninstall-silent.ps1"`.
- **SCCM:** Deployment Type PowerShell (Instalar/Desinstalar apuntando a ambos scripts).

#### Opcion 2: Ejecutable suelto

1. Copiar `agent-live.exe` al PC destino.
2. Ejecutar una vez: se registra y guarda la config en `%APPDATA%\remote-monitor-agent.json`.
3. El agente conecta por WebSocket y queda monitoreado.

### Flujo de registro del agente

```
1. Agente inicia
2. Lee config (maquina: %ProgramData%\RemoteMonitoringAgent\agent.json; o usuario: %APPDATA%\remote-monitor-agent.json; o env SERVER_URL/REGISTRATION_TOKEN)
3. Si no tiene config:
     POST /api/devices/register
     { hostname, OS, IP, platform, agentVersion, registrationToken (token compartido) }
     ← recibe { id (deviceId), registrationToken (token unico por dispositivo) } y guarda config
4. Conecta WebSocket a /agent con auth: { deviceId, token-unico }
5. Envia heartbeat cada 30s
6. Recibe comandos autorizados (ver tabla)
7. Si se desconecta, reintenta cada 5s
```

### Comandos soportados por el agente

| Comando | Descripcion |
|---------|-------------|
| `SCREENSHOT` | Captura de pantalla completa (PNG) y la guarda en el server |
| `SYSTEM_INFO` | Informacion del sistema (CPU, RAM, disco) |
| `PROCESS_LIST` | Lista de procesos activos |
| `LOCK_SCREEN` | Bloquea la pantalla del equipo |
| `SHUTDOWN` | Apaga el equipo |
| `RESTART` | Reinicia el equipo |
| `LOGOUT` | Cierra sesion del usuario |

### Vista en vivo (streaming)

- El panel se suscribe una sola vez (`live-view-start` con el intervalo pedido) y el server manda un
  `live-start` al agente: **el agente produce los cuadros solo**, en un loop que programa el cuadro
  siguiente cuando termina el anterior. No hay un round-trip por frame ni pedidos solapados.
- El server lleva la cuenta de espectadores por equipo: varios paneles mirando el mismo PC comparten
  **una sola corriente** al ritmo mas rapido pedido, y cerrar la ultima pestana apaga la captura en el
  agente (antes seguia mandando cuadros si algun cliente no llegaba a mandar `stop-live-view`).
- Agentes viejos (los `agent-live.exe` que ya estan en los PCs, sin `liveProtocol: "2"` en el
  handshake) siguen con el esquema antiguo de un `live-command` por cuadro; el server detecta el modo
  por conexion y no hay que actualizarlos de golpe.
- Cada cuadro es un **JPEG reducido a 1280 px de ancho con calidad 70** (`LIVE_MAX_WIDTH` /
  `LIVE_JPEG_QUALITY` en el agente). A resolucion nativa un monitor 2K/4K manda varios MB por frame y
  eso es lo que saturaba el uplink y cortaba la conexion.
- La captura la hace un **worker persistente**: el agente levanta un solo `powershell.exe` mientras hay
  espectadores y le pide cuadros por stdin, que devuelve por stdout en bruto (longitud + JPEG). Medido en
  una estacion con dos monitores (pantalla virtual de 3360x1080): **~150 ms por cuadro de 66 KB**, tope
  real de **~6 cuadros/s**. Las alternativas que quedaron atras: `screenshot-desktop` + re-encode en JS
  ~720 ms / 124 KB, y el `powershell.exe` de antes levantado por cuadro ~1400 ms / 55 KB. El costo que se
  ahorro no es el de GDI+, es el de arrancar PowerShell y el runtime .NET una vez por cuadro.
- El worker se apaga solo cuando se cierra la corriente (`live-stop`) y tiene un timeout de inactividad
  como red de seguridad; si PowerShell falla, el agente **degrada a la captura por proceso** en vez de
  quedarse sin imagen. `LIVE_CAPTURE_WORKER=0` lo desactiva en un equipo concreto.
- Costo de red real (medido con el binario empaquetado contra un server de prueba): a 1 s por cuadro
  son ~66 KB/s de uplink por equipo; al ritmo minimo de 0,25 s son **~3,8 cuadros/s y ~250 KB/s
  (2 Mbps)**. Por eso el default del panel sigue siendo 1 s: 0,25 s tiene que ser una decision consciente
  cuando el PC esta en la misma red que el server.
- Los frames viajan como **binario crudo** por el WebSocket, no como base64 dentro de JSON. Esto elimina la inflacion de ~33% del base64 en el salto de red; el navegador los reconstruye con `Blob` + object URL.
- Las dimensiones de cada frame se leen parseando la cabecera del PNG/JPEG en el agente, no hardcodeadas.
- Los frames **no se guardan en la base de datos** ni como archivos; solo viven en memoria del navegador.
- Si la corriente se corta (reconexion del agente, worker de sesion caido), el server lo detecta por
  inactividad y reactiva el `live-start`; el panel muestra el contador de cuadros reales que llegan.
- Desde la web se puede **grabar** la vista en vivo y descargar un `.webm` (~4 fps, redibuja el ultimo frame cada 250ms para cubrir toda la duracion).

---

## Estructura del Proyecto

```
remote-monitoring-platform/
├── server/                    # Backend Node.js
│   ├── src/
│   │   ├── config/            # Configuracion y base de datos
│   │   ├── controllers/       # Controladores HTTP
│   │   ├── middleware/        # Auth, RBAC, audit, errores
│   │   ├── routes/            # Rutas REST API
│   │   ├── security/          # JWT, passwords, permisos
│   │   ├── services/          # Logica de negocio
│   │   ├── types/             # Tipos TypeScript
│   │   ├── websocket/         # Socket.IO server (/admin y /agent)
│   │   └── server.ts          # Entry point
│   ├── prisma/
│   │   ├── schema.prisma      # Modelo de base de datos
│   │   └── seed.ts            # Datos iniciales (compilado a dist/prisma/seed.js)
│   └── package.json
│
├── client/                    # Frontend React (UI en espanol)
│   ├── src/
│   │   ├── hooks/             # useAuth
│   │   ├── layouts/           # MainLayout con sidebar y footer softgroup.com.ar
│   │   ├── pages/             # Login, Dashboard, Devices, DeviceDetail, Screenshots, Users, Audit
│   │   ├── services/          # API client, WebSocket (admin)
│   │   └── types/             # Tipos TypeScript
│   └── package.json
│
├── agent/                     # Agente Windows
│   ├── src/
│   │   ├── agent.ts           # Entry point (roles + comandos + vista en vivo)
│   │   ├── commands.ts        # Ejecucion de comandos y captura de frames
│   │   ├── config.ts          # Configuracion local
│   │   ├── imageSize.ts       # Parser de cabeceras PNG/JPEG
│   │   ├── agentStatus.ts     # status.json para la bandeja (allowlist, sin token)
│   │   ├── role.ts            # Rol: standalone | supervisor | session
│   │   ├── sessionProtocol.ts # Framing binario del named pipe (+ hello de admision + push de estado)
│   │   ├── sessionSecret.ts   # Secreto por arranque: generacion y comparacion constant-time
│   │   ├── sessionSupervisor.ts / sessionWorker.ts / sessionBridge.ts
│   │   └── screenshot-desktop.d.ts
│   ├── tray/
│   │   ├── RmTray.cs          # Bandeja: NotifyIcon + menu informativo + watchdog del agente
│   │   └── RmTray.exe         # Binario (csc, .NET Framework 4)
│   ├── installer/             # Instaladores (tarea al iniciar sesion, o Session 0 con -Session0)
│   │   ├── install.ps1            # Interactivo (PC individual)
│   │   ├── uninstall.ps1
│   │   ├── install-silent.ps1     # Silencioso para PDQ/Intune/SCCM (contexto SYSTEM)
│   │   ├── start-session.ps1      # Bridge Session 0 -> sesion interactiva
│   │   ├── uninstall-silent.ps1
│   │   ├── build-tray.ps1         # Compila RmTray.exe
│   │   ├── build-installer.ps1    # Compila la bandeja + RemoteMonitoringAgent.iss -> Setup.exe
│   │   ├── RemoteMonitoringAgent.iss  # Instalador grafico (aviso al usuario incluido)
│   │   └── run-hidden.vbs         # Legado: ya no se usa, los instaladores lo borran
│   ├── agent-live.exe         # Binario pre-compilado (vista en vivo + JPEG)
│   └── package.json
│
├── RemoteMonitoringAgentSetup.exe  # Instalador grafico compilado (Inno Setup 6)
├── Dockerfile                 # Dockerfile raiz (Custom App Dokploy: server+client en una imagen)
├── nginx.conf                 # Config de nginx de la imagen unica (proxy a 127.0.0.1:3000)
├── .gitignore
└── README.md
```

---

## API REST

### Autenticacion

| Metodo | Endpoint | Descripcion |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Iniciar sesion |
| `POST` | `/api/auth/refresh` | Refrescar token |
| `POST` | `/api/auth/logout` | Cerrar sesion |
| `GET` | `/api/auth/profile` | Obtener perfil |

### Usuarios

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/users` | `USERS_READ` | Listar usuarios |
| `POST` | `/api/users` | `USERS_WRITE` | Crear usuario |
| `PUT` | `/api/users/:id` | `USERS_WRITE` | Actualizar usuario |
| `DELETE` | `/api/users/:id` | `USERS_DELETE` | Eliminar usuario |
| `POST` | `/api/users/:id/password` | `USERS_WRITE` | Cambiar contrasena |

### Equipos (Devices)

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/devices` | `DEVICES_READ` | Listar equipos |
| `GET` | `/api/devices/:id` | `DEVICES_READ` | Detalle de equipo |
| `GET` | `/api/devices/stats` | `DEVICES_READ` | Estadisticas |
| `DELETE` | `/api/devices/:id` | `DEVICES_DELETE` | Eliminar equipo |
| `POST` | `/api/devices/register` | Token de registro | Alta de agente |

### Comandos

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/commands` | `COMMANDS_READ` | Listar comandos |
| `GET` | `/api/commands/device/:deviceId` | `COMMANDS_READ` | Comandos de un equipo |
| `POST` | `/api/commands` | `COMMANDS_WRITE` | Crear comando |
| `POST` | `/api/commands/:id/approve` | `COMMANDS_EXECUTE` | Aprobar comando |
| `POST` | `/api/commands/:id/reject` | `COMMANDS_EXECUTE` | Rechazar comando |

### Capturas de Pantalla

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/screenshots` | `SCREENSHOTS_VIEW` | Listar capturas |
| `GET` | `/api/screenshots/device/:deviceId` | `SCREENSHOTS_VIEW` | Capturas de un equipo |
| `GET` | `/api/screenshots/:id` | `SCREENSHOTS_VIEW` | Metadatos de la captura (sin `filePath`) |
| `GET` | `/api/screenshots/:id/image` | `SCREENSHOTS_VIEW` | Bytes de la imagen (unico camino; reemplaza al viejo `/uploads` publico) |
| `POST` | `/api/screenshots/request` | `SCREENSHOTS_REQUEST` | Solicitar captura |
| `DELETE` | `/api/screenshots/:id` | `SCREENSHOTS_REQUEST` | Eliminar captura |

### Auditoria y Health

| Metodo | Endpoint | Descripcion |
|--------|----------|-------------|
| `GET` | `/api/audit` | Logs de auditoria |
| `GET` | `/api/health` | Estado del servidor |

---

## Roles y Permisos

| Permiso | SUPER_ADMIN | ADMIN | OPERATOR |
|---------|:-----------:|:-----:|:--------:|
| `USERS_READ` | ✓ | ✓ | |
| `USERS_WRITE` | ✓ | ✓ | |
| `USERS_DELETE` | ✓ | | |
| `DEVICES_READ` | ✓ | ✓ | ✓ |
| `DEVICES_WRITE` | ✓ | ✓ | |
| `DEVICES_DELETE` | ✓ | | |
| `COMMANDS_READ` | ✓ | ✓ | ✓ |
| `COMMANDS_WRITE` | ✓ | ✓ | |
| `COMMANDS_EXECUTE` | ✓ | ✓ | |
| `SCREENSHOTS_REQUEST` | ✓ | ✓ | |
| `SCREENSHOTS_VIEW` | ✓ | ✓ | ✓ |
| `AUDIT_READ` | ✓ | ✓ | ✓ |

---

## Seguridad

**Autenticacion y sesion**

- **JWT + Refresh Tokens** para autenticacion stateless (access 15 min en memoria del navegador,
  refresh 7 dias guardado en la base **hasheado** (SHA-256), nunca en claro).
- El refresh token viaja en una **cookie `HttpOnly` + `SameSite=Lax` + `Secure` + `Path=/api/auth`**:
  un XSS ya no puede exportar la sesion de 7 dias ni mandarla a un origen ajeno.
- **Fail-fast de secretos**: sin `JWT_SECRET`, `JWT_REFRESH_SECRET` o `AGENT_REGISTRATION_TOKEN`
  (o con valores de ejemplo) el server no arranca en produccion.
- **Rate limiting** separado para login (10 intentos fallidos / 15 min) y general (300 / 15 min),
  con `trust proxy` para que el contador sea por usuario y no por el proxy comun.

**Autorizacion**

- **RBAC** con 3 niveles (SUPER_ADMIN, ADMIN, OPERATOR) y una sola fuente de verdad
  (`ROLE_PERMISSIONS`), aplicada en HTTP **y** en WebSocket.
- **Anti-escalada**: un rol solo puede asignar o gestionar roles de rango estrictamente inferior;
  `USERS_WRITE` de un ADMIN ya no le permite crear SUPER_ADMIN ni resetearle la contrasena a uno.
- **Allowlist de comandos** en el canal de agentes: cada tipo de comando se valida contra la
  permission del admin que lo dispara y contra una lista de tipos conocidos.
- Las **capturas** se sirven solo por `GET /api/screenshots/:id/image`, con JWT + `SCREENSHOTS_VIEW`
  y validando que la ruta resuelta quede dentro de `SCREENSHOTS_DIR` (sin traversal). El viejo
  `express.static` publico de `/uploads/screenshots`, que se montaba antes que las rutas de API,
  fue eliminado.

**Transporte y agentes**

- **Token unico de registro por agente** (`AGENT_REGISTRATION_TOKEN` solo para el alta) y
  `registrationToken` que **no se devuelve** en los listados/detalle de equipos.
- **Heartbeat** periodico; sin 3 latidos el equipo pasa a OFFLINE.
- **Cotas de payload** por mensaje de WebSocket y por captura; deteccion de imagen por magic bytes,
  no por la extension.
- Los frames de la vista en vivo viajan por WebSocket (WSS) y no se persisten en el server.
- **Canal local supervisor ↔ worker**: la named pipe acepta conexiones solo despues de un frame
  `hello` con el secreto aleatorio de ese arranque (256 bits, inyectado por el bloque de entorno de
  `CreateProcessAsUser`, nunca por la linea de comandos) y comparado en tiempo constante.
- **ACLs del config del agente**: herencia removida; `SYSTEM` + `Administradores` control total y
  `Users` solo lectura (o sin acceso en Session 0).

**Aviso al usuario**

- El agente muestra un **icono en la bandeja** del usuario con el estado del monitoreo (verde/naranja/
  rojo/gris, equipo, ID, ultimo latido). El menu es **solo informativo**: no hay boton para pausar ni
  apagar, y cerrarlo no baja el agente.
- El estado sale de `status.json`, escrito con una **allowlist de campos** que no incluye el
  `registrationToken`; hay tests que lo verifican. En Session 0 el estado viaja por la pipe ya
  autenticada y lo persiste el worker (el supervisor no puede escribir el perfil del usuario).
- El instalador grafico muestra una **pantalla de aviso** con que se instala y como se quita.
  Queda pendiente completar el aviso de la Ley 25.326 (responsable del dato y politica de privacidad)
  antes de desplegar en produccion.

**Auditoria**

- **Auditoria completa** de acciones de usuarios y de comandos rechazados por WebSocket, con `req.ip`
  real y sin tokens en el payload.

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| Agent no conecta | Verificar `SERVER_URL` y `REGISTRATION_TOKEN`, y que la config en `%APPDATA%` sea correcta |
| Agent aparece OFFLINE | Verificar firewall y que el agente este corriendo (tarea `RemoteMonitoringAgent`) |
| Screenshot falla | Agente debe correr en la sesion interactiva del usuario (no como servicio) |
| Vista en vivo no muestra frames | El server registra `[AGENT] Connected: <id> (live: stream|poll)`. `poll` = agente viejo (un cuadro por pedido, mas lento); `stream` = build nuevo. Si dice `stream` y no llegan cuadros, mira el contador del panel y el log `Corriente cortada en <id>` |
| La vista en vivo va a saltos | Solia ser request/response por frame. Con el build nuevo es una corriente del agente a 1280 px / calidad 70, capturada por el worker persistente (~150 ms por cuadro). Si sigue a saltos: el equipo esta lejos del server (latencia), `LIVE_MAX_WIDTH` muy alto, el log del agente dice `worker inestable` (PowerShell caido, se esta usando la ruta lenta), o el disco/CPU del PC esta al tope y la captura tarda mas que el intervalo |
| El live view consume muchisimas KB y el log dice `full resolution` | El worker esta caido y el re-encode JS tambien fallo: los cuadros salen a resolucion nativa. Probar `LIVE_CAPTURE_WORKER=1` (default), bajar `LIVE_MAX_WIDTH`, o revisar que el servicio pueda escribir en `%TEMP%` |
| El empleado no ve el icono de bandeja | Verificar la tarea `RemoteMonitoringAgent` (modo logon) o `RemoteMonitoringAgent-Tray` (modo Session 0) y que `RmTray.exe` este en la carpeta de instalacion. El detalle del estado esta en `%LOCALAPPDATA%\RemoteMonitoringAgent\status.json` |
| Video grabado corto | Solo aplicaba a builds previos al fix del "pump" de redibujado (commit `0e3b93d`) |
| Login falla | Verificar `JWT_SECRET` configurado correctamente |
| El contenedor no arranca: `JWT_SECRET no está definido` | Fail-fast intencional. Definir `JWT_SECRET`, `JWT_REFRESH_SECRET` y `AGENT_REGISTRATION_TOKEN` (`openssl rand -hex 32`); los valores de ejemplo (`change-this`, `secret`) tambien se rechazan |
| El dominio devuelve 502 y el contenedor hace crash-loop. Firma tipica: `/` alterna 200 y 502 entre requests, `/api/health` siempre 502 | Esa alternancia es nginx vivo durante los segundos que tarda el resto del arranque en morir, o sea: el contenedor esta en crash-loop y el 502 no es de la API ni de la red. Leé el log de arranque, ahora cada paso se anuncia con `[entrypoint]`: `nginx: [emerg] unknown directive ...` es config invalida (los builds corren `nginx -t` para que explote en el build, no en produccion); `Error: P3005 / The database schema is not empty` es base creada con `db push`, se arregla con un deploy de `PRISMA_BASELINE=1` (ver Paso 6) o con `npx prisma migrate resolve --applied 20260810000000_init` dentro del contenedor |
| El panel no carga pero la API responde | El dominio esta apuntando al puerto 3000 (Express) en vez del 80 (nginx). nginx es el que sirve el `dist/` de la SPA y hace proxy de `/api` y `/socket.io` |
| Las capturas desaparecen despues de un redeploy | En el despliegue tipo "Docker" montarle un volumen en `/app/uploads/screenshots`; la imagen solo hace `mkdir`, el volumen named existe nada mas en `docker-compose.dokploy.yml` |
| Las capturas salen rotas / en negro | Ahora se piden autenticadas (`/api/screenshots/:id/image`). Revisar que el token no haya expirado y que el rol tenga `SCREENSHOTS_VIEW`; `nginx` ya no sirve `/uploads` |
| Tras cambiar la contrasena del admin vuelve la vieja | No deberia pasar: el seed solo crea el usuario la primera vez y nunca reescribe `passwordHash`. Si la base la creo el seed viejo, rotala desde el panel una vez |
| CORS error | Verificar `CORS_ORIGIN` coincide con el dominio real |
| DB connection fail | Verificar `DATABASE_URL` y que PostgreSQL este corriendo |

---

## Desarrollo Local

```bash
git clone https://github.com/brandall2021/remote-monitoring-platform.git
cd remote-monitoring-platform

# Servicios (PostgreSQL + Redis)
docker-compose up -d postgres redis

# Server
cd server
cp .env.example .env        # completá DATABASE_URL y los 3 secretos obligatorios
npx prisma migrate dev
npm run seed                # imprime la contrasena del SUPER_ADMIN una sola vez
npm run dev

# Client (en otra terminal)
cd ../client && npm install && npm run dev

# Tests
cd ../server && npm test    # jest: permisos, RBAC HTTP/WS, servicios, seed, app real
cd ../agent  && npm test    # vitest: protocolo, pipe, comandos, imagenes
```

El client estara disponible en `http://localhost:5173` y el server en `http://localhost:3000`.

> Si en desarrollo no definis `JWT_SECRET` / `JWT_REFRESH_SECRET` / `AGENT_REGISTRATION_TOKEN`,
> el server levanta con secretos **efimeros** (se regeneran por proceso: los tokens y los registros
> de agente no sobreviven a un restart) y avisa por consola. En produccion esa misma situacion es
> un arranque que falla.

---

## Licencia

MIT
