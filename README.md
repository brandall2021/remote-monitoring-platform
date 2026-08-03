# Remote Monitoring Platform

Plataforma empresarial de monitoreo remoto autorizado. Sistema cliente-servidor para administracion de equipos corporativos con agentes que ejecutan acciones solicitadas por administradores autenticados.

Interfaz en espanol (footer `softgroup.com.ar`). Incluye capturas de pantalla bajo demanda, **vista en vivo** del escritorio por WebSocket y **grabacion en video** de la vista en vivo desde el navegador.

---

## Funcionalidades

- **Monitoreo de equipos**: los agentes se registran y reportan estado ONLINE/OFFLINE via heartbeat cada 30s.
- **Capturas de pantalla** bajo demanda (`POST /api/screenshots/request`).
- **Vista en vivo**: stream de frames JPEG del escritorio del agente a la web (intervalo 1s / 2s / 5s).
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
│  └───────┬────────┘        │  │   ├─ /api ──────────────┐      │  │  │
│          │                 │  │   ├─ /socket.io ──────┐ │      │  │  │
│  ┌───────┴────────┐        │  │   └─ /uploads ──────┐ │ │      │  │  │
│  │    Redis 7      │        │  │                     ▼ ▼ ▼     │  │  │
│  │ (servicio Dok) │        │  │  Node.js + Express + Socket.IO  │  │  │
│  │     6379       │        │  │  (3000) · Prisma db push + seed │  │  │
│  └───────┬────────┘        │  └───────────────────────────────┘  │  │
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
> proxyeando `/api`, `/socket.io` y `/uploads` a la API Node.js (:3000).
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

```env
# === BASE DE DATOS (servicio PostgreSQL de Dokploy) ===
DATABASE_URL=postgresql://postgres:tu-contrasena@postgres.xxx.docker.internal:5432/remote_monitoring

# === REDIS (servicio Redis de Dokploy) ===
REDIS_URL=redis://redis.xxx.docker.internal:6379

# === JWT ===
JWT_SECRET=tu-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=tu-jwt-refresh-secret-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# === CORS (el dominio real de Dokploy) ===
CORS_ORIGIN=https://monitor.recuperocrediticio.com

# === AGENTE (token para registro de agentes) ===
AGENT_REGISTRATION_TOKEN=tu-agent-registration-token
```

### Paso 5: Configurar Dominio (SSL)

En la app, **Domains** > agregar el dominio (ej. `monitor.recuperocrediticio.com`). Dokploy configura SSL automaticamente con Let's Encrypt. `CORS_ORIGIN` debe coincidir con el dominio.

### Paso 6: Verificar Deploy

- Abrir `https://<tu-dominio>` y loguearse.
- Credenciales por defecto: **`admin@monitoring.local` / `admin123`**.

> El CMD del contenedor ejecuta en cada arranque: `nginx && npx prisma db push && node dist/prisma/seed.js && node dist/server.js`.
> El seed es **idempotente**: crea los 3 roles (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`) y el usuario admin, y **resetea la contrasena de `admin@monitoring.local` a `admin123` en cada boot** (si la cambias en el panel, se revierte en el proximo deploy).

---

## Variables de Entorno - Referencia Completa

| Variable | Requerida | Descripcion | Valor por defecto |
|----------|:---------:|-------------|-------------------|
| `DATABASE_URL` | Si | Cadena de conexion PostgreSQL (servicio Dokploy) | - |
| `REDIS_URL` | Si | Cadena de conexion Redis (servicio Dokploy) | `redis://localhost:6379` |
| `JWT_SECRET` | Si | Secret para firmar JWT (min 32 chars) | - |
| `JWT_REFRESH_SECRET` | Si | Secret para refresh tokens (min 32 chars) | - |
| `JWT_EXPIRES_IN` | No | Tiempo de vida del access token | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | No | Tiempo de vida del refresh token | `7d` |
| `CORS_ORIGIN` | Si | Dominio permitido para CORS | - |
| `AGENT_REGISTRATION_TOKEN` | Si | Token para registro de agentes | - |
| `PORT` | No | Puerto de la API dentro del contenedor | `3000` |
| `SCREENSHOTS_DIR` | No | Directorio de capturas de pantalla | `./uploads/screenshots` |

---

## Compilar el Agente para Windows

Requisitos: **Node.js 18+** en la maquina de build (no en el PC destino) y **Windows 10/11** en los PCs destino.

```bash
cd remote-monitoring-platform/agent
npm install
npm run build          # compila a dist/agent.js
npm run package        # empaqueta agent.exe con pkg (node18-win-x64)
```

> El repositorio ya incluye un binario pre-compilado **`agent/agent-live.exe`**
> con soporte de vista en vivo y frames JPEG comprimidos. Si lo regeneras,
> se actualiza con `npm run package` (cambia el output a `agent-live.exe` si
> el `agent.exe` anterior esta corriendo y bloqueado).

### Configuracion del agente

- Config a nivel maquina (despliegue corporativo): **`%ProgramData%\RemoteMonitoringAgent\agent.json`** (serverUrl, deviceId, registrationToken, heartbeatInterval). Un solo `deviceId` por PC, compartido por todos los usuarios.
- Fallback a nivel usuario (instalacion manual): **`%APPDATA%\remote-monitor-agent.json`**.
- Si no existe ninguna config, el agente se registra usando las variables `SERVER_URL` y `REGISTRATION_TOKEN`.
- `registrationToken` guardado es un **token unico por dispositivo** emitido por el server al registrarse (el token compartido de onboarding solo se usa para el alta).

### Distribucion

#### Opcion 1: Ejecutable + instalador (recomendado)

El instalador copia el exe a `%LOCALAPPDATA%\RemoteMonitoringAgent\`, registra una **tarea programada al iniciar sesion** (corre oculto via `run-hidden.vbs`) y arranca el agente:

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

1. Copia `agent-live.exe` a `C:\Program Files\RemoteMonitoringAgent\agent.exe`.
2. **Pre-registra el equipo** contra el server (genera su `deviceId` unico) y
   escribe la config a nivel maquina en `%ProgramData%\RemoteMonitoringAgent\agent.json`.
3. Registra la tarea programada **`RemoteMonitoringAgent` al logon de CUALQUIER
   usuario** (sesion interactiva, via `run-hidden.vbs`) — asi cada usuario que
   inicie sesion levanta el agente con el mismo `deviceId` de la PC.
4. Otorga a `Users` escritura sobre la carpeta de config (para re-registrar si
   la config se pierde).

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
- **Intune (Win32 app):** empaquetar `install-silent.ps1` + `agent-live.exe` (+ `run-hidden.vbs` se genera solo) con *Microsoft Win32 Content Prep Tool*. Comando de instalacion: `powershell.exe -ExecutionPolicy Bypass -File "install-silent.ps1" -ServerUrl ... -RegistrationToken ...` (corre como SYSTEM). Regla de deteccion: archivo `C:\Program Files\RemoteMonitoringAgent\agent.exe` existe. Uninstall: `powershell.exe -ExecutionPolicy Bypass -File "uninstall-silent.ps1"`.
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

- La web pide frames por WebSocket (`live-view-frame`), el server retransmite al agente (`live-command`) y el agente responde con un JPEG (`live-frame-result`).
- Los frames se comprimen a **JPEG** (o a max. 1280px de ancho en el fallback PowerShell con System.Drawing).
- Los frames **no se guardan en la base de datos** ni como archivos; solo viven en memoria del navegador.
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
│   │   ├── agent.ts           # Entry point (comandos + vista en vivo)
│   │   ├── commands.ts        # Ejecucion de comandos y captura de frames
│   │   ├── config.ts          # Configuracion local
│   │   └── screenshot-desktop.d.ts
│   ├── installer/             # Instaladores (tarea al iniciar sesion)
│   │   ├── install.ps1            # Interactivo (PC individual)
│   │   ├── uninstall.ps1
│   │   ├── install-silent.ps1     # Silencioso para PDQ/Intune/SCCM (contexto SYSTEM)
│   │   ├── uninstall-silent.ps1
│   │   └── run-hidden.vbs
│   ├── agent-live.exe         # Binario pre-compilado (vista en vivo + JPEG)
│   └── package.json
│
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
| `GET` | `/api/screenshots/:id` | `SCREENSHOTS_VIEW` | Ver captura |
| `POST` | `/api/screenshots/request` | `SCREENSHOTS_REQUEST` | Solicitar captura |
| `DELETE` | `/api/screenshots/:id` | `SCREENSHOTS_VIEW` | Eliminar captura |

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

- **JWT + Refresh Tokens** para autenticacion stateless.
- **RBAC** con 3 niveles (SUPER_ADMIN, ADMIN, OPERATOR).
- **Rate limiting** en endpoints sensibles (login, general).
- **Helmet** para headers de seguridad HTTP.
- **CORS** configurado por dominio (`CORS_ORIGIN`).
- **Auditoria completa** de acciones de usuarios.
- **Token unico de registro** por agente (`AGENT_REGISTRATION_TOKEN`).
- **Heartbeat** periodicos para detectar desconexiones y marcar OFFLINE.
- **HTTPS** obligatorio via Dokploy/Let's Encrypt.
- Los frames de la vista en vivo viajan por WebSocket (WSS) y no se persisten en el server.

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| Agent no conecta | Verificar `SERVER_URL` y `REGISTRATION_TOKEN`, y que la config en `%APPDATA%` sea correcta |
| Agent aparece OFFLINE | Verificar firewall y que el agente este corriendo (tarea `RemoteMonitoringAgent`) |
| Screenshot falla | Agente debe correr en la sesion interactiva del usuario (no como servicio) |
| Vista en vivo no muestra frames | El agente debe ser el build con soporte `live-command` (`agent-live.exe`) |
| Video grabado corto | Solo aplicaba a builds previos al fix del "pump" de redibujado (commit `0e3b93d`) |
| Login falla | Verificar `JWT_SECRET` configurado correctamente |
| CORS error | Verificar `CORS_ORIGIN` coincide con el dominio real |
| DB connection fail | Verificar `DATABASE_URL` y que PostgreSQL este corriendo |
| La contrasena admin se revierte | Es el comportamiento del seed: la resetea a `admin123` en cada deploy |

---

## Desarrollo Local

```bash
git clone https://github.com/brandall2021/remote-monitoring-platform.git
cd remote-monitoring-platform

# Servicios (PostgreSQL + Redis)
docker-compose up -d postgres redis

# Server
cd server && npm install && npx prisma migrate dev && npm run dev

# Client (en otra terminal)
cd ../client && npm install && npm run dev
```

El client estara disponible en `http://localhost:5173` y el server en `http://localhost:3000`.

---

## Licencia

MIT
