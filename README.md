# Remote Monitoring Platform

Plataforma empresarial de monitoreo remoto autorizado. Sistema cliente-servidor para administracion de equipos corporativos con agentes que ejecutan acciones solicitadas por administradores autenticados.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        DOKPLOY (PaaS)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │  PostgreSQL  │  │    Redis    │  │   Server    │           │
│  │  (Puerto     │  │  (Puerto    │  │  Node.js +  │           │
│  │   5432)      │  │   6379)     │  │  Express +  │           │
│  │             │  │             │  │  Socket.IO   │           │
│  └──────┬──────┘  └──────┬──────┘  │  (Puerto    │           │
│         │                │         │   3000)      │           │
│         └────────────────┴─────────┴──────┬──────┘           │
│                                           │                   │
└───────────────────────────────────────────┼───────────────────┘
                                            │ HTTPS/WSS
                                            │
                          ┌─────────────────┼─────────────────┐
                          │                 │                  │
                   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
                   │   Panel Web │  │   Agente 1  │  │   Agente N  │
                   │   React +   │  │   Windows   │  │   Windows   │
                   │   Material  │  │   (PCs)     │  │   (PCs)     │
                   │   UI        │  │             │  │             │
                   └─────────────┘  └─────────────┘  └─────────────┘
```

---

## Desplegar en Dokploy

### Prerequisitos

- Dokploy instalado y funcionando
- Dominio configurado (opcional pero recomendado)
- GitHub account con acceso al repositorio

### Paso 1: Clonar el repositorio

```bash
git clone https://github.com/brandall2021/remote-monitoring-platform.git
```

### Paso 2: Crear servicios en Dokploy

#### Opcion A: Stack Completo (Recomendado)

Despliega Server + PostgreSQL + Redis juntos usando Docker Compose.

1. En Dokploy ir a **Projects** > **Crear Proyecto**
2. Nombrar el proyecto: `remote-monitoring`
3. Ir a **Docker Compose** > **Crear servicio**
4. Subir el archivo `docker-compose.dokploy.yml`
5. Configurar las variables de entorno (ver abajo)
6. Hacer click en **Deploy**

#### Opcion B: Servicios Separados

Despliega cada servicio por separado para mayor control.

**Paso 2.1: Crear PostgreSQL**

1. Ir a **Database** > **Crear PostgreSQL**
2. Nombre: `monitoring-postgres`
3. Usuario: `postgres`
4. Contrasena: (generar una segura)
5. Base de datos: `remote_monitoring`
6. **Deploy**
7. Anotar el **Host** interno (ej: `monitoring-postgres`)

**Paso 2.2: Crear Redis**

1. Ir a **Database** > **Crear Redis**
2. Nombre: `monitoring-redis`
3. **Deploy**
4. Anotar el **Host** interno (ej: `monitoring-redis`)

**Paso 2.3: Crear Server**

1. Ir a **Services** > **Crear servicio Docker**
2. Nombre: `monitoring-server`
3. Source: **GitHub**
4. Repositorio: `brandall2021/remote-monitoring-platform`
5. Rama: `master`
6. Dockerfile: `server/Dockerfile`
7. Puerto: `3000`
8. Configurar variables de entorno (ver abajo)
9. **Deploy**

### Paso 3: Variables de Entorno

Copiar y configurar en Dokploy bajo la pestana **Environment** del servicio:

```env
# === BASE DE DATOS ===
DATABASE_URL=postgresql://postgres:TU_CONTRASENA@monitoring-postgres:5432/remote_monitoring

# === JWT (generar strings aleatorios de minimo 32 caracteres) ===
JWT_SECRET=aqui-un-string-aleatorio-largo-min-32-chars-para-signing
JWT_REFRESH_SECRET=aqui-otro-string-aleatorio-largo-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# === REDIS ===
REDIS_URL=redis://monitoring-redis:6379

# === SERVIDOR ===
PORT=3000
NODE_ENV=production

# === CORS (tu dominio) ===
CORS_ORIGIN=https://monitoring.tudominio.com

# === AGENTE (token para registro de agentes) ===
AGENT_REGISTRATION_TOKEN=generar-token-random-aqui-cambiar

# === SCREENSHOTS ===
SCREENSHOTS_DIR=./uploads/screenshots
```

> **IMPORTANTE:** Cambiar los valores por defecto. Generar secrets seguros con:
> ```bash
> openssl rand -hex 32
> ```

### Paso 4: Configurar Dominio (SSL)

1. En el servicio `monitoring-server`, ir a **Domains**
2. Agregar tu dominio: `monitoring.tudominio.com`
3. Dokploy configura SSL automaticamente con Let's Encrypt
4. Actualizar `CORS_ORIGIN` con el dominio configurado

### Paso 5: Verificar Deploy

1. Ir a **Deployments** y verificar que todo este verde
2. Abrir `https://monitoring.tudominio.com`
3. Login por defecto:
   - **Email:** `admin@monitoring.local`
   - **Contrasena:** `admin123`
4. **Cambiar la contrasena inmediatamente**

### Paso 6: Seed de datos iniciales

Despues del primer deploy, ejecutar en la consola de Dokploy del servicio server:

```bash
npx prisma db seed
```

Esto crea los roles y el usuario admin por defecto.

---

## Compilar el Agente para Windows

El agente se instala en cada equipo corporativo que se desea monitorear. Se comunica con el servidor via WebSocket y ejecuta unicamente comandos autorizados.

### Requisitos previos

- **Node.js 18+** instalado en la maquina de build (no en el PC destino)
- **Windows 10/11** o **Windows Server 2016+** en los PCs destino
- Acceso al servidor desplegado en Dokploy

### Paso 1: Preparar el entorno de build

En una maquina con Node.js instalado:

```bash
# Clonar solo la carpeta del agente
git clone https://github.com/brandall2021/remote-monitoring-platform.git
cd remote-monitoring-platform/agent
```

### Paso 2: Instalar dependencias

```bash
npm install
```

### Paso 3: Configurar variables de entorno

```bash
cp .env.example .env
```

Editar el archivo `.env`:

```env
# URL completa del servidor Dokploy
SERVER_URL=https://monitoring.tudominio.com

# Token de registro (el mismo configurado en Dokploy)
REGISTRATION_TOKEN=tu-agent-registration-token

# Version del agente
AGENT_VERSION=1.0.0

# Intervalo de heartbeat en milisegundos (30 segundos)
HEARTBEAT_INTERVAL=30000
```

### Paso 4: Compilar a JavaScript

```bash
npm run build
```

Esto genera la carpeta `dist/` con el codigo compilado.

### Paso 5: Empaquetar como .exe (Opcion A - Recomendado)

Usar `pkg` para crear un ejecutable standalone que NO requiere Node.js en el PC destino:

```bash
# Instalar pkg globalmente
npm install -g pkg

# Empaquetar para Windows x64
npx pkg dist/agent.js --targets node18-win-x64 --output remote-monitor-agent.exe
```

**Resultado:** Archivo `remote-monitor-agent.exe` listo para distribuir.

### Paso 6: Distribuir el agente

#### Metodo 1: Ejecutable standalone (recomendado)

1. Copiar `remote-monitor-agent.exe` al PC destino
2. Ejecutar una vez: el agente se registra automaticamente
3. La configuracion se guarda en `%APPDATA%\remote-monitor-agent.json`
4. El agente inicia la conexion WebSocket al servidor

#### Metodo 2: Con Node.js instalado

1. Copiar la carpeta completa del agente (`dist/`, `node_modules/`, `.env`)
2. Ejecutar: `node dist/agent.js`

#### Metodo 3: Instalacion como servicio Windows

Para que el agente inicie automaticamente con Windows:

```bash
# Instalar node-windows
npm install -g node-windows

# Crear script de servicio (install-service.js)
```

Crear archivo `install-service.js`:

```javascript
const Service = require('node-windows').Service;
const path = require('path');

const service = new Service({
  name: 'Remote Monitor Agent',
  description: 'Enterprise Remote Monitoring Agent',
  script: path.join(__dirname, 'dist', 'agent.js'),
  env: [
    { name: "SERVER_URL", value: "https://monitoring.tudominio.com" },
    { name: "REGISTRATION_TOKEN", value: "tu-token" },
    { name: "AGENT_VERSION", value: "1.0.0" }
  ]
});

service.on('install', () => {
  service.start();
  console.log('Service installed and started');
});

service.install();
```

Ejecutar:

```bash
node install-service.js
```

### Flujo de registro del agente

```
1. Agente inicia
   │
2. Lee configuracion (.env o config file)
   │
3. Si no tiene DEVICE_ID:
   │  POST /api/devices/register
   │  { hostname, OS, IP, registrationToken }
   │  ← Recibe { deviceId, registrationToken }
   │  ← Guarda config localmente
   │
4. Conecta WebSocket a /agent
   │  auth: { deviceId, token }
   │
5. Envia heartbeat cada 30s
   │
6. Recibe comandos autorizados:
   │  - SCREENSHOT → captura pantalla → envia imagen
   │  - SYSTEM_INFO → info del sistema → envia datos
   │  - PROCESS_LIST → lista procesos → envia lista
   │  - LOCK_SCREEN → bloquea pantalla
   │  - SHUTDOWN / RESTART / LOGOUT
   │
7. Si se desconecta, reintenta cada 5s
```

### Comandos soportados por el agente

| Comando | Descripcion | Requiere autorizacion |
|---------|-------------|:---------------------:|
| `SCREENSHOT` | Captura de pantalla | Si |
| `SYSTEM_INFO` | Informacion del sistema (CPU, RAM, disco) | Si |
| `PROCESS_LIST` | Lista de procesos activos | Si |
| `LOCK_SCREEN` | Bloquea la pantalla del equipo | Si |
| `SHUTDOWN` | Apaga el equipo | Si |
| `RESTART` | Reinicia el equipo | Si |
| `LOGOUT` | Cierra sesion del usuario | Si |

### Verificar que el agente funciona

1. Iniciar el agente en el PC destino
2. Ir al panel web en Dokploy
3. Ir a **Devices** → el equipo deberia aparecer como **ONLINE**
4. Hacer click en el equipo → ver detalles
5. Probar: **Request Screenshot** → la imagen se captura y muestra

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
│   │   ├── websocket/         # Socket.IO server
│   │   └── server.ts          # Entry point
│   ├── prisma/
│   │   ├── schema.prisma      # Modelo de base de datos
│   │   └── seed.ts            # Datos iniciales
│   ├── Dockerfile             # Para Dokploy
│   ├── docker-compose.yml     # Solo server
│   └── package.json
│
├── client/                    # Frontend React
│   ├── src/
│   │   ├── hooks/             # useAuth
│   │   ├── layouts/           # MainLayout con sidebar
│   │   ├── pages/             # Login, Dashboard, Devices, etc
│   │   ├── services/          # API client, WebSocket
│   │   └── types/             # Tipos TypeScript
│   ├── Dockerfile             # Para Dokploy
│   └── package.json
│
├── agent/                     # Agente Windows
│   ├── src/
│   │   ├── agent.ts           # Entry point
│   │   ├── commands.ts        # Ejecucion de comandos
│   │   └── config.ts          # Configuracion local
│   └── package.json
│
├── docker-compose.dokploy.yml # Stack completo para Dokploy
├── dokploy.env.example        # Variables de entorno ejemplo
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

### Comandos

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/commands` | `COMMANDS_READ` | Listar comandos |
| `POST` | `/api/commands` | `COMMANDS_WRITE` | Crear comando |
| `POST` | `/api/commands/:id/approve` | `COMMANDS_EXECUTE` | Aprobar comando |
| `POST` | `/api/commands/:id/reject` | `COMMANDS_EXECUTE` | Rechazar comando |

### Capturas de Pantalla

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/screenshots` | `SCREENSHOTS_VIEW` | Listar capturas |
| `POST` | `/api/screenshots/request` | `SCREENSHOTS_REQUEST` | Solicitar captura |
| `GET` | `/api/screenshots/:id` | `SCREENSHOTS_VIEW` | Ver captura |

### Auditoria

| Metodo | Endpoint | Permiso | Descripcion |
|--------|----------|---------|-------------|
| `GET` | `/api/audit` | `AUDIT_READ` | Logs de auditoria |

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

- **JWT + Refresh Tokens** para autenticacion stateless
- **RBAC** (Role-Based Access Control) con 3 niveles
- **Rate limiting** en endpoints sensibles (10 req/15min en login)
- **Helmet** para headers de seguridad HTTP
- **CORS** configurado por dominio
- **Auditoria completa** de todas las acciones
- **Firma de comandos** para evitar replay attacks
- **Token unico** por agente para registro
- **Heartbeat** periodicos para detectar desconexiones
- **HTTPS obligatorio** via Dokploy/Let's Encrypt
- **Cifrado** en transmision de capturas de pantalla

---

## Comandos Utiles

```bash
# Ver logs del servidor en Dokploy
docker logs monitoring-server

# Acceder a la consola del servidor
docker exec -it monitoring-server sh

# Ejecutar migraciones manualmente
docker exec -it monitoring-server npx prisma migrate deploy

# Seed de datos
docker exec -it monitoring-server npx prisma db seed

# Ver estado de la base de datos
docker exec -it monitoring-server npx prisma studio

# Reiniciar el servicio
docker restart monitoring-server
```

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| Agent no conecta | Verificar `SERVER_URL` y `REGISTRATION_TOKEN` |
| Agent aparece OFFLINE | Verificar firewall, puerto 3000/443 abierto |
| Screenshot falla | Agente necesita permisos de pantalla en Windows |
| Login falla | Verificar `JWT_SECRET` configurado correctamente |
| CORS error | Verificar `CORS_ORIGIN` coincide con el dominio |
| DB connection fail | Verificar `DATABASE_URL` y que PostgreSQL este corriendo |

---

## Licencia

MIT
