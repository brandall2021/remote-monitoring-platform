# Remote Monitoring Agent (Windows)

Agente de escritorio de la plataforma de monitoreo remoto autorizado. Corre en PCs Windows, se registra contra el server y ejecuta acciones solicitadas por administradores autenticados (capturas, vista en vivo, comandos del sistema).

> Para la documentacion completa del proyecto (server, client, deploy en Dokploy) ver el [`README.md`](../README.md) de la raiz.

---

## Requisitos

- **PC destino:** Windows 10/11.
- **Maquina de build (opcional):** Node.js 18+ y Windows (para regenerar el exe).
- El agente debe correr en la **sesion interactiva del usuario** (no como servicio) para poder capturar el escritorio.

---

## Binario pre-compilado

El repositorio incluye **`agent/agent-live.exe`**: build con soporte de vista en vivo y frames JPEG comprimidos. Se distribuye directamente, sin necesidad de compilar.

Si lo regeneras:

```bash
cd agent
npm install
npm run build    # compila a dist/agent.js
npm run package  # empaqueta agent-live.exe con pkg (node18-win-x64)
```

> El script genera siempre `agent-live.exe`, que es el nombre que usan los instaladores. Si el binario esta corriendo, detenelo antes de reemplazarlo.

---

## Configuracion

- **Config a nivel maquina (despliegue corporativo):** `%ProgramData%\RemoteMonitoringAgent\agent.json` con:
  ```json
  {
    "serverUrl": "https://monitor.recuperocrediticio.com",
    "deviceId": "<uuid>",
    "registrationToken": "<token-unico-por-dispositivo>",
    "agentVersion": "1.0.0",
    "heartbeatInterval": 30000
  }
  ```
- **Fallback a nivel usuario (instalacion manual):** `%APPDATA%\remote-monitor-agent.json` (misma estructura).
- El instalador guarda primero una configuracion de arranque (`serverUrl` + token). El agente completa el registro y persiste el `deviceId` al iniciar; esto evita depender de variables de entorno que no existen dentro de una tarea programada.
- El `registrationToken` guardado es un **token unico por dispositivo** emitido por el server al registrarse. El token compartido de onboarding (`AGENT_REGISTRATION_TOKEN`) solo se usa en el alta.

---

## Distribucion

### Opcion 1: Instalador (recomendado)

Para una instalacion grafica se puede compilar `installer/RemoteMonitoringAgent.iss`
con Inno Setup 6. El instalador pide la URL y el token de registro, crea la
configuracion del usuario y registra el agente al iniciar Windows.

`agent/installer/install.ps1`:

1. Copia el exe a `%LOCALAPPDATA%\RemoteMonitoringAgent\agent.exe`.
2. Registra la **tarea programada `RemoteMonitoringAgent` al iniciar sesion** (corre oculto via `run-hidden.vbs`).
3. Arranca el agente.

```powershell
# PC nueva (pide SERVER_URL y REGISTRATION_TOKEN si no hay config)
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1

# PC nueva sin prompts
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1 `
  -ServerUrl https://monitor.recuperocrediticio.com -RegistrationToken TU_TOKEN

# Desinstalar (opcional: -RemoveConfig borra la config guardada)
powershell -ExecutionPolicy Bypass -File .\installer\uninstall.ps1
```

**Parámetros de `install.ps1`:**

| Parametro | Descripcion | Default |
|-----------|-------------|---------|
| `-AgentPath` | Ruta del exe del agente | `..\agent-live.exe` (o `..\agent.exe`) |
| `-ServerUrl` | URL del server (solo si no hay config) | prompt |
| `-RegistrationToken` | Token de registro del agente | prompt |
| `-TaskName` | Nombre de la tarea programada | `RemoteMonitoringAgent` |
| `-InstallDir` | Carpeta de instalacion | `%LOCALAPPDATA%\RemoteMonitoringAgent` |

**Parámetros de `uninstall.ps1`:**

| Parametro | Descripcion | Default |
|-----------|-------------|---------|
| `-TaskName` | Nombre de la tarea programada | `RemoteMonitoringAgent` |
| `-InstallDir` | Carpeta de instalacion | `%LOCALAPPDATA%\RemoteMonitoringAgent` |
| `-RemoveConfig` | Tambien borra la config en `%APPDATA%` | off |

> **Por que no un servicio de Windows?** Un servicio corre en "Session 0", separado del escritorio, y **no puede capturar la pantalla del usuario**. Por eso el agente se ejecuta al **iniciar sesion** del usuario, donde si tiene acceso al escritorio. Para actualizar el agente: regenerar el exe, copiarlo encima y volver a correr `install.ps1`.

> **Nota:** esto describe el modo por defecto (`standalone`). El modo **Session 0** resuelve justamente ese limite y se documenta en [Modos de ejecucion](#modos-de-ejecucion).

### Opcion 2: Ejecutable suelto

1. Copiar `agent-live.exe` al PC destino.
2. Ejecutarlo una vez: se registra y guarda la config en `%APPDATA%\remote-monitor-agent.json`.
3. El agente conecta por WebSocket y queda monitoreado.

### Opcion 3: Despliegue masivo (PDQ / Intune / SCCM, 30+ PCs)

`installer/install-silent.ps1` corre en contexto **SYSTEM** y automatiza todo:

1. Copia el exe a `C:\Program Files\RemoteMonitoringAgent\agent.exe`.
2. **Pre-registra el equipo** contra el server y escribe la config a nivel maquina (`%ProgramData%\RemoteMonitoringAgent\agent.json`).
3. Registra la tarea `RemoteMonitoringAgent` **al logon de cualquier usuario** (sesion interactiva).
4. Otorga a `Users` escritura sobre la carpeta de config.

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install-silent.ps1 `
  -ServerUrl https://monitor.recuperocrediticio.com `
  -RegistrationToken TU_TOKEN

# Desinstalar
powershell -ExecutionPolicy Bypass -File .\installer\uninstall-silent.ps1
```

**Parámetros de `install-silent.ps1`:**

| Parametro | Descripcion | Default |
|-----------|-------------|---------|
| `-ServerUrl` | URL del server | - (o env `RM_SERVER_URL`) |
| `-RegistrationToken` | Token compartido de onboarding | - (o env `RM_REGISTRATION_TOKEN`) |
| `-AgentPath` | Ruta del exe del agente | `..\agent-live.exe` (o `..\agent.exe`) |
| `-TaskName` | Nombre de la tarea | `RemoteMonitoringAgent` |
| `-InstallDir` | Carpeta de instalacion | `%ProgramFiles%\RemoteMonitoringAgent` |
| `-ConfigDir` | Carpeta de config de maquina | `%ProgramData%\RemoteMonitoringAgent` |
| `-SkipTaskRegistration` | No registrar la tarea (solo copiar/registrar) | off |
| `-Session0` | Instalar en modo Session 0 (supervisor como SYSTEM al inicio de Windows) | off |

**Empaquetado:**

- **PDQ Deploy:** ejecutar el comando de arriba como SYSTEM.
- **Intune (Win32 app):** empaquetar `install-silent.ps1` + `agent-live.exe` con *Microsoft Win32 Content Prep Tool*. Instalar: `powershell.exe -ExecutionPolicy Bypass -File "install-silent.ps1" -ServerUrl ... -RegistrationToken ...` (SYSTEM). Deteccion: existe `C:\Program Files\RemoteMonitoringAgent\agent.exe`. Uninstall: `uninstall-silent.ps1`.
- **SCCM:** Deployment Type PowerShell (Instalar/Desinstalar).

> El token compartido queda embebido en el paquete. El server solo lo valida en
> el alta y luego emite un token unico por dispositivo, por lo que todas las
> PCs pueden usar el mismo token de onboarding.

---

## Modos de ejecucion

El agente tiene tres roles, que se seleccionan con `--role=<rol>` o con la variable
de entorno `RM_AGENT_ROLE`:

| Rol | Donde corre | Que hace |
|-----|-------------|----------|
| `standalone` | Sesion interactiva del usuario (logon) | Modo por defecto. Habla con el server y captura en el escritorio. Es el comportamiento historico. |
| `supervisor` | Session 0 como SYSTEM, al inicio de Windows | Habla con el server. No captura. Levanta un worker en la sesion interactiva. |
| `session` | Sesion interactiva del usuario | No habla con el server. Espera pedidos del supervisor por named pipe y ejecuta la captura. |

### Modo Session 0

Resuelve el limite del modo `standalone`: el agente queda online **antes de que
nadie se loguee**, y aun asi puede capturar la pantalla del usuario.

```
Session 0 (SYSTEM)                    Sesion interactiva del usuario
--------------------------            --------------------------------
supervisor  ── WSS ──> server
    │
    ├─ start-session.ps1  ────────────>  session worker
    │   (WTS + CreateProcessAsUser)         │
    └<────────── named pipe \\.\pipe\rmagent-session ────────┘
        pedidos: live-frame / screenshot
```

Instalacion (con `install-silent.ps1`):

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install-silent.ps1 `
  -ServerUrl https://monitor.recuperocrediticio.com `
  -RegistrationToken TU_TOKEN `
  -Session0
```

Con `-Session0` se registra una tarea **al inicio de Windows** que corre
`agent.exe --role=supervisor` como SYSTEM, y **no** se crea la tarea de logon.
El supervisor lanza `installer/start-session.ps1`, que usa
`WTSGetActiveConsoleSessionId` + `WTSQueryUserToken` + `DuplicateTokenEx` +
`CreateProcessAsUserW` sobre `winsta0\default` para crear el worker dentro de la
sesion del usuario. Si no hay sesion interactiva, el bridge no hace nada y el
supervisor reintenta cada 5s; si el bridge falla, entra en cooldown de 30s.

Requiere que el supervisor corra como SYSTEM (el token de la sesion interactiva
solo se puede obtener desde ese contexto). El script del bridge se copia a
`%ProgramFiles%\RemoteMonitoringAgent\start-session.ps1` y se puede sobreescribir
con la variable `RM_BRIDGE_SCRIPT`.

Cuando no hay ninguna sesion interactiva, `SCREENSHOT` y la vista en vivo devuelven
un error explicito en vez de una imagen en negro.

---

## Flujo de registro

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

---

## Comandos soportados

| Comando | Descripcion |
|---------|-------------|
| `SCREENSHOT` | Captura de pantalla completa (PNG) y la guarda en el server |
| `SYSTEM_INFO` | Informacion del sistema (CPU, RAM, disco) |
| `PROCESS_LIST` | Lista de procesos activos |
| `LOCK_SCREEN` | Bloquea la pantalla del equipo |
| `SHUTDOWN` | Apaga el equipo |
| `RESTART` | Reinicia el equipo |
| `LOGOUT` | Cierra sesion del usuario |

---

## Vista en vivo

- La web pide frames por WebSocket (`live-view-frame`), el server retransmite al agente (`live-command`) y el agente responde con un JPEG (`live-frame-result`).
- Los frames se comprimen a **JPEG** (o a max. 1280px de ancho en el fallback PowerShell con System.Drawing), usando todos los monitores en Windows 10/11.
- Los frames **no se guardan en la base de datos** ni como archivos; solo viven en memoria del navegador.

---

## Estructura

```
agent/
├── src/
│   ├── agent.ts               # Entry point (comandos + vista en vivo)
│   ├── commands.ts            # Ejecucion de comandos y captura de frames
│   ├── config.ts              # Configuracion local
│   ├── imageSize.ts           # Parser de cabeceras PNG/JPEG (dimensiones reales)
│   ├── role.ts                # Resolucion del rol (standalone/supervisor/session)
│   ├── sessionProtocol.ts     # Framing binario del named pipe
│   ├── sessionSupervisor.ts   # Lado Session 0: pipe + proxy de pedidos
│   ├── sessionWorker.ts       # Lado sesion interactiva: ejecuta la captura
│   ├── sessionBridge.ts       # Politica de reintentos del bridge
│   ├── sessionBridgeRunner.ts # Invocacion del script PowerShell del bridge
│   └── screenshot-desktop.d.ts
├── installer/
│   ├── install.ps1            # Instalador interactivo (PC individual)
│   ├── uninstall.ps1          # Desinstalador interactivo
│   ├── install-silent.ps1     # Silencioso para PDQ/Intune/SCCM (contexto SYSTEM)
│   ├── start-session.ps1      # Bridge Session 0 -> sesion interactiva
│   ├── uninstall-silent.ps1   # Desinstalador silencioso
│   └── run-hidden.vbs         # Lanzador oculto
├── agent-live.exe             # Binario pre-compilado (vista en vivo + JPEG)
└── package.json
```

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| No conecta | Verificar `serverUrl`/token en la config, el firewall y revisar los reintentos del agente |
| Aparece OFFLINE | Verificar firewall y que el agente este corriendo (tarea `RemoteMonitoringAgent`) |
| Screenshot falla | En modo `standalone` el agente debe correr en la sesion interactiva del usuario. En modo `supervisor` no hay session worker: verificar que haya un usuario logueado |
| Vista en vivo no muestra frames | Usar el build con soporte `live-command` (`agent-live.exe`) |
| En modo Session 0 el supervisor no captura | No hay sesion interactiva activa, o `start-session.ps1` no esta junto al exe. El supervisor reintenta solo cada 5s |
| `install.ps1` falla con EPERM | El exe esta en uso; el instalador ya espera hasta 10s a que el proceso lo libere |
| Segundo equipo no se registra (400 unique) | El server debe estar con el build que emite un token unico por dispositivo (redeploy) |
| `Failed to load config: Unexpected token` | El JSON fue escrito con BOM (PowerShell 5.1 `-Encoding UTF8`); se tolera desde el build actual. Regenerar la config con `WriteAllText` sin BOM si usas un instalador viejo |
