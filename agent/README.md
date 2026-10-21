# Remote Monitoring Agent (Windows)

Agente de escritorio de la plataforma de monitoreo remoto autorizado. Corre en PCs Windows, se registra contra el server y ejecuta acciones solicitadas por administradores autenticados (capturas, vista en vivo, comandos del sistema).

> Para la documentacion completa del proyecto (server, client, deploy en Dokploy) ver el [`README.md`](../README.md) de la raiz.

---

## Requisitos

- **PC destino:** Windows 10/11.
- **Maquina de build (opcional):** Node.js 18+ y Windows (para regenerar el exe). Para el icono de bandeja hace falta ademas el `csc.exe` de .NET Framework 4.x, que viene con Windows.
- El agente debe correr en la **sesion interactiva del usuario** (no como servicio) para poder capturar el escritorio, o en modo **Session 0** con un worker en la sesion del usuario (ver [Modos de ejecucion](#modos-de-ejecucion)).

---

## Binario pre-compilado

El repositorio incluye dos binarios:

| Archivo | Que es |
|---------|--------|
| **`agent/agent-live.exe`** | El agente (Node empaquetado con `pkg`): vista en vivo, capturas, comandos. |
| **`agent/tray/RmTray.exe`** | El icono de bandeja: 14,5 KB de C# contra .NET Framework 4, sin dependencias ni instalador de runtime. |

Ambos se distribuyen directos desde el repo, sin compilar nada en la PC destino.

Para regenerarlos:

```bash
cd agent
npm install
npm run build       # compila a dist/agent.js
npm run package     # empaqueta agent-live.exe con pkg (node18-win-x64)
npm run build:tray  # compila tray/RmTray.exe con csc.exe
```

> El script genera siempre `agent-live.exe`, que es el nombre que usan los instaladores. Si el binario esta corriendo, detenelo antes de reemplazarlo.

---

## Icono de bandeja (lo que ve el empleado)

`RmTray.exe` es el aviso visible del monitoreo. No es un control: muestra estado y nada mas.

- **Punto verde** conectado, **naranja** iniciando, **rojo** sin conexion, **gris** detenido. El tooltip dice el estado y hace cuanto fue el ultimo latido.
- El menu del icono muestra equipo, ID del dispositivo, servidor, ultimo latido y el ultimo error si lo hay; tiene dos acciones: **Abrir panel de monitoreo** y **Refrescar ahora**.
- **No hay boton "Salir" ni "Pausar".** Si el usuario pudiera apagar el monitoreo desde la bandeja, el hallazgo C-2/H-1 de la auditoria volveria a abrirse por la ventana. Cerrar el icono (o matar el proceso) no toca el agente: es un proceso aparte.
- Doble click en el icono abre el panel.

Como funciona por debajo:

```
agent.exe ── escribe ──> %LOCALAPPDATA%\RemoteMonitoringAgent\status.json   (bandeja lo lee)
    │                    %ProgramData%\RemoteMonitoringAgent\status.json
    └─ modo Session 0: el supervisor no puede escribir en el perfil del usuario,
       asi que manda el estado por la pipe ya autenticada y el worker lo persiste.
```

Reglas del archivo de estado:

- Es estado, no credencial: `agentStatus.ts` proyecta solo una allowlist de campos (`state`, `serverUrl`, `deviceId`, `hostname`, `role`, `pid`, `updatedAt`, `lastHeartbeatAt`, `lastError`). El `registrationToken` no puede terminar en el archivo, ni aunque alguien lo meta en el objeto de estado, y hay un test que lo verifica.
- Se escribe atomico (`*.tmp` + rename) y con modo `0600`.
- La bandeja lee las dos rutas y toma la mas nueva; si un archivo esta corrupto o no lo puede leer, ignora ese destino y sigue con el otro.

Para probarlo sin instalar el agente:

```powershell
# Muestra el icono leyendo el status.json actual, sin levantar ni vigilar agentes.
.\tray\RmTray.exe --status-only --poll 2
```

| Flag | Efecto |
|------|--------|
| `--status-only` | No levanta ni rearma `agent.exe`; solo lee estado. Es el modo que instala el despliegue en Session 0. |
| `--agent <ruta>` | Que exe vigilar y relanzar (default: `%LOCALAPPDATA%` o `%ProgramFiles%\RemoteMonitoringAgent\agent.exe`). |
| `--poll <1..300>` | Segundos entre lecturas del estado (default 5). |

En modo logon (sin `--status-only`) la bandeja es ademas el watchdog del agente: si el proceso muere lo rearma, con tope de 5 reaperturas por hora para no entrar en bucle si el server esta caido.

Una sola instancia por sesion: un mutex `Local\RmAgentTray`; la segunda copia se cierra sola sin duplicar el icono.

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
con Inno Setup 6. El instalador pide la URL y el token de registro, muestra una
**pantalla de aviso** describiendo que se instala y que el icono de la bandeja no
se puede apagar desde el usuario, solicita permisos de administrador y realiza una
instalacion por equipo en modo Session 0:

1. Instala el agente y la bandeja en `%ProgramFiles%\RemoteMonitoringAgent`.
2. Guarda la configuracion compartida en `%ProgramData%\RemoteMonitoringAgent`.
3. Registra una tarea como `SYSTEM` al arrancar Windows, sin mostrar ventanas.
4. Inicia el supervisor inmediatamente y lo reinicia si termina inesperadamente.
5. Registra la tarea `RemoteMonitoringAgent-Tray` **al logon de cada usuario**, que
   pone el icono de bandeja en modo `--status-only`.
6. Cuando un usuario inicia sesion, crea automaticamente el worker interactivo
   necesario para capturas y vista en vivo, y ese worker persiste el estado que lee
   la bandeja.

Para generar el instalador:

```powershell
cd agent
npm run build
npm run package
npm run installer   # compila tray/RmTray.exe y luego corre ISCC
```

El resultado es `RemoteMonitoringAgentSetup.exe` en la raiz del repositorio.
Requiere Inno Setup 6 en la maquina de compilacion; la PC destino no necesita
Node.js, PowerShell adicional ni Inno Setup.

`agent/installer/install.ps1`:

1. Copia el exe a `%LOCALAPPDATA%\RemoteMonitoringAgent\agent.exe` y la bandeja a `RmTray.exe`.
2. Registra la **tarea programada `RemoteMonitoringAgent` al iniciar sesion**, que corre `RmTray.exe`; la bandeja levanta y vigila al agente.
3. Arranca la bandeja en la sesion actual.

> Las versiones anteriores usaban un `run-hidden.vbs` para esconder la consola. `RmTray.exe` se compila con `/target:winexe`, asi que el vbs sobraba: el instalador lo borra si existe.

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
| `-TrayPath` | Ruta de la bandeja | `..\tray\RmTray.exe` |
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

> Como el icono no tiene boton de salida, `uninstall.ps1` es el unico camino para bajarlo; mata
> `agent.exe` y `RmTray.exe` filtrando por ruta exacta del ejecutable.

> **Por que no un servicio de Windows?** Un servicio corre en "Session 0", separado del escritorio, y **no puede capturar la pantalla del usuario**. Por eso el agente se ejecuta al **iniciar sesion** del usuario, donde si tiene acceso al escritorio. Para actualizar el agente: regenerar el exe, copiarlo encima y volver a correr `install.ps1`.

> **Nota:** esto describe el modo por defecto (`standalone`). El modo **Session 0** resuelve justamente ese limite y se documenta en [Modos de ejecucion](#modos-de-ejecucion).

### Opcion 2: Ejecutable suelto

1. Copiar `agent-live.exe` al PC destino.
2. Ejecutarlo una vez: se registra y guarda la config en `%APPDATA%\remote-monitor-agent.json`.
3. El agente conecta por WebSocket y queda monitoreado.

### Opcion 3: Despliegue masivo (PDQ / Intune / SCCM, 30+ PCs)

`installer/install-silent.ps1` corre en contexto **SYSTEM** y automatiza todo:

1. Copia el exe a `C:\Program Files\RemoteMonitoringAgent\agent.exe` y la bandeja a `RmTray.exe`.
2. **Pre-registra el equipo** contra el server y escribe la config a nivel maquina (`%ProgramData%\RemoteMonitoringAgent\agent.json`).
3. Registra la tarea `RemoteMonitoringAgent` **al logon de cualquier usuario** (sesion interactiva), o la de `--role=supervisor` como SYSTEM con `-Session0`.
4. Fija las ACLs de la config: `agent.json` queda solo para SYSTEM y Administradores en modo Session 0.
5. Con `-Session0`, registra ademas `RemoteMonitoringAgent-Tray` al logon con `--status-only` para que el usuario vea el icono.

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
| `-TrayPath` | Ruta de la bandeja | `..\tray\RmTray.exe`; si no existe, avisa e instala sin icono |
| `-TaskName` | Nombre de la tarea | `RemoteMonitoringAgent` |
| `-TrayTaskName` | Nombre de la tarea de la bandeja (solo `-Session0`) | `RemoteMonitoringAgent-Tray` |
| `-InstallDir` | Carpeta de instalacion | `%ProgramFiles%\RemoteMonitoringAgent` |
| `-ConfigDir` | Carpeta de config de maquina | `%ProgramData%\RemoteMonitoringAgent` |
| `-SkipTaskRegistration` | No registrar tareas (solo copiar/ACL) | off |
| `-Session0` | Instalar en modo Session 0 (supervisor como SYSTEM al inicio de Windows) | off |

**Empaquetado:**

- **PDQ Deploy:** ejecutar el comando de arriba como SYSTEM.
- **Intune (Win32 app):** empaquetar `install-silent.ps1` + `agent-live.exe` + `tray\RmTray.exe` con *Microsoft Win32 Content Prep Tool*. Instalar: `powershell.exe -ExecutionPolicy Bypass -File "install-silent.ps1" -ServerUrl ... -RegistrationToken ...` (SYSTEM). Deteccion: existe `C:\Program Files\RemoteMonitoringAgent\agent.exe`. Uninstall: `uninstall-silent.ps1`.
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
        empuja:  estado ──────────────>  status.json ──> RmTray.exe --status-only
```

Instalacion (con `install-silent.ps1`):

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install-silent.ps1 `
  -ServerUrl https://monitor.recuperocrediticio.com `
  -RegistrationToken TU_TOKEN `
  -Session0
```

Con `-Session0` se registra una tarea **al inicio de Windows** que corre
`agent.exe --role=supervisor` como SYSTEM, y **no** se crea la tarea de logon del
agente: en su lugar se registra `RemoteMonitoringAgent-Tray`, que al logon corre
`RmTray.exe --status-only` (el dueno del proceso del agente es SYSTEM; si la bandeja
levantara un `agent.exe` propio tendriamos dos agentes con el mismo `deviceId`).
El supervisor lanza `installer/start-session.ps1`, que usa
`WTSGetActiveConsoleSessionId` + `WTSQueryUserToken` + `DuplicateTokenEx` +
`CreateProcessAsUserW` sobre `winsta0\default` para crear el worker dentro de la
sesion del usuario. Si no hay sesion interactiva, el bridge no hace nada y el
supervisor reintenta cada 5s; si el bridge falla, entra en cooldown de 30s.

Como el supervisor vive en Session 0, no puede escribir en el perfil del usuario que
esta logueado: el estado viaja por la pipe ya autenticada (cuadro `kind: "status"`)
y lo persiste el worker, que si corre como ese usuario. Por eso el icono se pone
naranja/gris hasta que hay un worker autenticado, y por eso el secreto de la pipe
es lo unico que admite ese cuadro.

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
│   ├── agent.ts               # Entry point (comandos + vista en vivo + estado)
│   ├── agentStatus.ts         # status.json: allowlist de campos, escritura atomica
│   ├── commands.ts            # Ejecucion de comandos y captura de frames
│   ├── config.ts              # Configuracion local
│   ├── imageSize.ts           # Parser de cabeceras PNG/JPEG (dimensiones reales)
│   ├── role.ts                # Resolucion del rol (standalone/supervisor/session)
│   ├── sessionProtocol.ts     # Framing binario del named pipe (request/response/status)
│   ├── sessionSupervisor.ts   # Lado Session 0: pipe + proxy de pedidos + push de estado
│   ├── sessionWorker.ts       # Lado sesion interactiva: ejecuta la captura y persiste estado
│   ├── sessionBridge.ts       # Politica de reintentos del bridge
│   ├── sessionBridgeRunner.ts # Invocacion del script PowerShell del bridge
│   └── screenshot-desktop.d.ts
├── tray/
│   ├── RmTray.cs              # Bandeja: NotifyIcon, menu informativo, watchdog del agente
│   └── RmTray.exe             # Binario compilado (csc, .NET Framework 4)
├── installer/
│   ├── install.ps1            # Instalador interactivo (PC individual)
│   ├── uninstall.ps1          # Desinstalador interactivo
│   ├── install-silent.ps1     # Silencioso para PDQ/Intune/SCCM (contexto SYSTEM)
│   ├── start-session.ps1      # Bridge Session 0 -> sesion interactiva
│   ├── uninstall-silent.ps1   # Desinstalador silencioso
│   ├── build-tray.ps1         # Compila RmTray.exe con csc.exe
│   ├── build-installer.ps1    # Compila la bandeja y corre ISCC
│   └── run-hidden.vbs         # (Legado: los instaladores lo borran, ya no se usa)
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
| El icono de bandeja no aparece | En modo Session 0 depende de la tarea `RemoteMonitoringAgent-Tray`: `schtasks /query /tn RemoteMonitoringAgent-Tray`. En modo logon, que `RmTray.exe` este junto a `agent.exe` en la carpeta de instalacion |
| El icono queda gris o "sin datos del agente" | `status.json` no llega. En Session 0 eso significa que no hay worker autenticado en la pipe (nadie logueado, o el worker rechazo el secreto). Mirar `%LOCALAPPDATA%\RemoteMonitoringAgent\status.json` y `%ProgramData%\RemoteMonitoringAgent\status.json` |
| El icono muestra "Sin conexion" rojo | El supervisor esta corriendo pero perdio el WebSocket: revisar `lastError` en `status.json`, firewall y que el server este arriba |
| Dos iconos en la bandeja | No deberia pasar (mutex `Local\RmAgentTray`); si aparece, puede ser una instalacion por usuario y otra por maquina. Desinstalar con `uninstall.ps1` / `uninstall-silent.ps1` |
| Quiero sacar el icono sin desinstalar el agente | No esta previsto a proposito: el icono es el aviso legal al usuario. Bajarlo a mano (`Stop-Process RmTray`) lo levanta de nuevo la tarea al proximo logon |
| En modo Session 0 el supervisor no captura | No hay sesion interactiva activa, o `start-session.ps1` no esta junto al exe. El supervisor reintenta solo cada 5s |
| `install.ps1` falla con EPERM | El exe esta en uso; el instalador ya espera hasta 10s a que el proceso lo libere |
| Segundo equipo no se registra (400 unique) | El server debe estar con el build que emite un token unico por dispositivo (redeploy) |
| `Failed to load config: Unexpected token` | El JSON fue escrito con BOM (PowerShell 5.1 `-Encoding UTF8`); se tolera desde el build actual. Regenerar la config con `WriteAllText` sin BOM si usas un instalador viejo |
