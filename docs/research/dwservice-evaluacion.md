# Evaluación de DWService para remote-monitoring-platform

Fecha de investigación: 2026-09-25. Todas las afirmaciones técnicas llevan la URL de la fuente primaria usada. Lo que no se pudo verificar está marcado explícitamente.

---

## 1. Resumen ejecutivo

DWService es un servicio de acceso y administración remota vía navegador, con agente open source (MPLv2) instalado en el dispositivo, servidores de relay ("nodes") operados por el proveedor, y una **API REST pública y documentada** (`https://www.apiremoteaccess.com/en/api/json/`) que permite crear/listar agentes y abrir sesiones de control embebidas en un IFrame. El servicio es gratuito para uso comercial completo, limitado solo por bandwidth (6 Mbps en plan free). **Veredicto: no conviene competir con DWService de frente, pero sí conviene integrar su API y su agente** — nuestra plataforma ya tiene el control, la auditoría, el RBAC y la vista en vivo que a DWService no le interesan, y DWService tiene el control interactivo real, file transfer, shell y gestor de recursos que a nosotros nos faltan. El valor más alto concreto no es copiar código sino **adoptar su modelo de permisos por aplicación y por ruta** (`fullAccess: false` + whitelist de apps y paths con `edit`/`download`/`upload` por directorio), que es exactamente el hueco de nuestro `CommandType` enum plano.

---

## 2. Qué es DWService (capacidades verificadas)

| Capacidad | Verificación | Fuente |
|---|---|---|
| Acceso remoto a un equipo desde cualquier navegador, tras registro e instalación del agente | "DWService enables remote access to systems with just a standard web browser" | https://www.dwservice.net/en/overview.html |
| Aplicación **Screen**: control total del escritorio con cursor y teclado; se puede compartir con otros usuarios bloqueándoles opcionalmente ratón y teclado | "It allows you to fully control the remote system by displaying its screen and allowing cursor control and keyboard input. You can also choose to share the remote system with other users, who you can optionally prevent from using the mouse and keyboard." | https://www.dwservice.net/en/applications.html |
| Toolbar de Screen: fullscreen, copiar, pegar, envío de keystrokes, `Win+Esc`, `Ctrl+Alt+Del`, y settings con enable/disable de ratón+teclado (**modo view-only**), audio on/off, selección de monitor, calidad de imagen | listado de 7 controles + sub-opciones a-d | https://docs.dwservice.net/docs/site/basic-definitions/screen-application/ |
| Aplicación **Files and Folders**: descarga y subida de cualquier archivo; compartir carpetas con permisos por usuario (read only, edit, download, upload, all) | "offering the ability to download and upload any file... configuring the operations to which each user is authorized (read only, edit, download, upload, or all)" | https://www.dwservice.net/en/applications.html |
| Carpeta compartida en modo read-only explícito | página dedicada | https://docs.dwservice.net/docs/site/agent-sharing/how-to-share-a-folder-in-read-only-mode/ |
| Aplicación **Resources**: estado de memoria, procesadores, discos, procesos y servicios; además permite **start/stop de servicios y terminar procesos** | "getting information about memory, processors, disks, processes and services. It also allows you to perform some operations such as start/stop services, terminate processes" | https://www.dwservice.net/en/applications.html |
| Aplicación **Shell**: sesión de terminal en el sistema remoto | "It allows you to start a terminal session on the remote system." | https://www.dwservice.net/en/applications.html |
| Aplicación **Text editor**: ver y editar un archivo de texto | "It allows you to view and edit a text file." | https://www.dwservice.net/en/applications.html |
| Aplicación **Log watch**: visualizar un log file que se actualiza automáticamente, en tiempo real, multi-tab y con pause | "You can see the changes in the text file in real time." + Open/Pause/Delete/Tabs/Close | https://docs.dwservice.net/docs/site/basic-definitions/log-watch-application/ |
| **Analyze events**: event log del servicio, filtrable | "you can check the event log for our service, which you can filter in a variety of ways" | https://docs.dwservice.net/docs/site/basic-definitions/analyze-events/ |
| **Agent sharing con restricciones**: se puede compartir un agent destrabando "Full Access" y marcando solo las apps permitidas (Files and Folders, Log Watch, Screen, Resources, Text Editor, Shell) | "Uncheck Full Access. You will be able to share access to only that apps of your choice" | https://docs.dwservice.net/docs/site/agent-sharing/how-do-i-share-an-agent-with-restrictions/ |
| Desactivar ratón/teclado en un agent compartido | página dedicada | https://docs.dwservice.net/docs/site/agent-sharing/how-to-disable-mouse-keyboard-for-share-agent/ |
| 2FA con TOTP + dispositivos marcados como confiable | "TOTP - Time-based One-Time Password algorithm... possible to mark devices as trusted" | https://www.dwservice.net/en/security.html |
| **Run only**: ejecutar el agente sin instalarlo, generando user/password automáticamente | "If you do not want or cannot install the agent... select Run instead of Install. This will automatically generate a username and a password" | https://docs.dwservice.net/docs/site/dwservice-installation/how-do-i-run-only-the-agent/ |
| **Instalación silenciosa** soportada, con condiciones explícitas | "The Application and Service can be used by the user also in silent mode" | https://www.dwservice.net/en/terms-and-conditions.html |
| Instalación con **código** o con **credenciales** (installation password) | dos modos de instalación | https://docs.dwservice.net/docs/site/basic-definitions/install-the-agent/ |
| Acceso desde app Android | link a `play.google.com/.../net.dwservice.client` | https://www.dwservice.net/es/home.html |
| Configuración de proxy en el agente | página dedicada | https://docs.dwservice.net/docs/site/basic-definitions/configure-proxy/ |
| Multi-OS del agente: Windows, Linux (Wayland y Xorg), macOS | pasos de instalación por SO | https://docs.dwservice.net/docs/site/agent-installation-step-by-step/ |

**No encontrado / no documentado:** chat, sistema de tickets/invoicing, cobros integrated, whiteboard, chat de soporte en vivo, portal de auto-servicio para el usuario final, ni ningún mecanismo de *notifications* (email/webhook/push) ante eventos. Ninguna de estas capacidades aparece en el sitio oficial, en la documentación ni en la API.

---

## 3. Arquitectura y modelo de datos

### 3.1 Tres componentes

> "Our infrastructure consists of three components, Front-end, Back-end and Nodes: The Front-end... manages the web interface of the site (www.dwservice.net). It also communicates with the Back-end to redirect users and agents on the Nodes. The Back-end is the main component of the infrastructure. It is where data is stored... Nodes are components that manage the web interface of the sessions (nodeXXXXX.dwservice.net), also handling data triangulation between users and agents (managing bandwidth, checking connections, and so on). An agent is always connected to a node waiting for the user to connect."
> — https://www.dwservice.net/en/security.html

- El agente mantiene conexión **persistente y permanently-open** a un node, esperando usuario. Eso es un modelo push, no polling: nuestro agente hoy hace polling/heartbeat sobre WebSocket initiated por el server.
- El node es un **triangulador de datos**: gestiona bandwidth y chequea conexiones. No es un simple reverse proxy.
- El agente se redirige al node más cercano o menos cargado; el usuario se redirige al node donde está el agente. La afinidad agente↔node es lo que hace estable la sesión.
  — https://docs.dwservice.net/docs/site/basic-definitions/nodes/ y https://www.dwservice.net/en/contribute-nodes.html

### 3.2 Cifrado — punto crítico

> "All communication between components and between users and agents take place using TCP port 443 (https standard). Communications are encrypted via a SSL certificate in accordance with current security standards."
> — https://www.dwservice.net/en/security.html

**Esto es TLS en tránsito, no cifrado end-to-end.** El node está en el medio de la ruta de datos y por definición "handles data triangulation between users and agents". No hay ninguna afirmación de E2E en ninguna fuente oficial. Esto es una diferencia estructural con nuestro diseño, donde el server sí es el terminus del tráfico de frames.

### 3.3 Datos almacenados por el proveedor

Autenticación (email, password hasheado, datos personales no obligatorios), datos del agent (name, description), datos de Shares (name, configuration, login password), y **access data**: start time, end time, IP address. Ningún payload entre usuario y agente se almacena.
— https://www.dwservice.net/en/security.html

### 3.4 Self-hosting — no existe

> "we are also planning to develop a simplified node version (connected to our infrastructure) so that users can install it on their own servers, where: Passwords will be stored. Custom SSL certificate can be installed..."
> — https://www.dwservice.net/en/security.html

Está en futuro, y aun así requeriría conexión a la infraestructura de DWService. Los nodes hoy son todos operados por DWSNET s.r.l. **No hay nodos self-hosteables.** Esto cierra la puerta a una variante "on-premise" de nuestro producto basada en su infraestructura.

### 3.5 El agente open source

- Licencia: core **MPLv2**, más librerías y componentes con licencias distintas. Lista completa por componente (Core, UI, App. Desktop, App. FileSystem, App. LogWatch, App. Resource, App. Shell, App. TextEditor, Lib. GDI, Lib. OSUtil, Lib. ScreenCapture, Lib. SoundCapture = MPLv2; Lib. Z = zlib; Lib. TurboJPEG = BSD-style; Lib. Opus = BSD-style; Lib. RtAudio = MIT-style).
  — https://www.dwservice.net/en/download.html
- Repo: https://github.com/dwservice/agent — 583 stars, 116 forks, último push 2026-09-18, lenguaje Python, rama `master`.
- Estructura real: `app_desktop/`, `app_filesystem/`, `app_logwatch/`, `app_resource/`, `app_shell/`, `app_texteditor/`, `core/`, `lib_core/`, `lib_gcc/`, `lib_gdi/`, `lib_opus/`, `lib_osutil/`, `lib_rtaudio/`, `lib_screencapture/`, `lib_soundcapture/`, `lib_stdcpp/`, `lib_turbojpeg/`, `lib_unwind/`, `lib_z/`, `os_linux/`, `os_mac/`, `os_win_installer/`, `os_win_launcher/`, `os_win_service/`, `os_win_updater/`, `ui/`, `make/`. Hay un `LICENSE` por carpeta.
  — https://github.com/dwservice/agent
- README: "The code is written in python2 and several libraries are written c++". Build: `python3 ./compile_all.py` y `python3 ./create_config.py` desde `agent/make`, luego `python3 ./agent.py` desde `agent/core`. En Windows requiere MinGW-w64. Wayland en Linux requiere `libpipewire-0.3-dev`, `libdbus-1-3`, `libdbus-1-dev`.
  — https://github.com/dwservice/agent/blob/master/README.md
- **Los updates del agente los empuja DWService**: "the Agent updates are automatically sent to the software every time it is connected to the infrastructure of the Application. Updates apply to Agent-related modules only."
  — https://www.dwservice.net/en/terms-and-conditions.html

### 3.6 Qué implicaría para nuestro server

Si adoptáramos su arquitectura, habría que reemplazar nuestro modelo de un server central con: (a) un registro de agentes con conexión persistente saliente, (b) una capa de afinidad agente↔nodo, (c) manejo de bandwidth como recurso de primera clase. Nuestro stack actual (Postgres + Redis + Socket.IO en Dokploy) ya resuelve (a) y parcialmente (b), pero no tiene (c) ni tiene un concepto de nodo. El bandwidth es su unidad de negocio; el nuestro es la auditoría y el RBAC.

---

## 4. API pública / integrabilidad

**Veredicto: la API es real, está documentada, responde y es usable.** Es REST plano sobre HTTPS con JSON, con documentación completa de request/response por endpoint. Verificado en vivo: `GET https://www.apiremoteaccess.com/en/api/json/agents` sin credenciales devuelve `HTTP 403` con body `{"message":"Forbidden.","status":403}` — o sea, el endpoint existe y está sirviendo.

### 4.1 Base y autenticación

- Base URL: `https://www.apiremoteaccess.com/en/api/json/`
  — https://docs.dwservice.net/docs/api/getting-started/
- Obtener credenciales: registro en `https://api.dwservice.net/signup.html`, luego *My Account / Account* → sección **"API Key"** → *Generate New Key* → se obtienen **API Key y Secret**.
  — https://docs.dwservice.net/docs/api/getting-started/authentication/
- Método 1 (no recomendado): `Authorization: Basic base64(<key>:<secret>)`.
- Método 2 (recomendado): header `X-DW-Authorization: HM1 <key>:base64(hashHMAC(<curtime>,<secret>)):<curtime>)`, con HMAC-**SHA1**, `curtime` en milisegundos desde epoch, expiración de 10 minutos.
  — https://docs.dwservice.net/docs/api/getting-started/authentication/
- Prerrequisito: nuestro web server necesita **certificado SSL** para que funcione el IFrame.
  — https://docs.dwservice.net/docs/api/getting-started/prerequisites/

### 4.2 Semántica HTTP

`<base>/<resource>`, con GET / PUT / POST / DELETE. Códigos: `200` OK, `400` Bad Request, `403` Forbidden (auth inválida), `404` Not Found. Los errores incluyen un objeto de error adicional.
— https://docs.dwservice.net/docs/api/getting-started/request-structure/ y https://docs.dwservice.net/docs/api/getting-started/response-structure/

### 4.3 Recursos

**`/account`** — https://docs.dwservice.net/docs/api/account-resource/
- `GET ?request=info` → email, company, firstName, lastName, country, address, `credit`, `agentsInstalled`, `agentsAllowed`, `channelsBasicAllowed`, `channelsAllowed`, `priceList { unit, ticketCurrency, ticketPrice, agentCost, channelBasicCost }`, `cost { agents, channelsBasic, total }`, `channelsBasicIDs`.
  — https://docs.dwservice.net/docs/api/account-resource/get-account-info/
- `PUT ?request=addServices[&simulate=true]` con `{ agents, channelsBasic }` → compra slots de agent y de channel consume créditos. `simulate=true` devuelve el costo sin cobrar.
  — https://docs.dwservice.net/docs/api/account-resource/add-services/
- `GET ?request=creditTransactions&days=<n>` → historial de `ADD_SERVICES` / `ADD_CREDIT`.
  — https://docs.dwservice.net/docs/api/account-resource/get-credit-transactions/

**`/agents`** — https://docs.dwservice.net/docs/api/agent-resource/
- `POST { name, description }` → `{ id, installCode }`.
  — https://docs.dwservice.net/docs/api/agent-resource/create-an-agent/
- `GET` (listar todos) → por agente: `state`, `osType`, `installCode`, `supportedApplications`, `name`, `description`, `id`. Además `PUT` (modify), `DELETE`, `GET /:id`.
  — https://docs.dwservice.net/docs/api/agent-resource/list-all-agents/
- **Estados**: `W` = Wait installation, `N` = Online, `F` = Offline, `D` = Disabled. **OS**: `1` = Windows, `2` = Linux, `3` = Mac OS. `supportedApplications` = lista separada por `;` (p. ej. `filesystem;texteditor;logwatch;resource;desktop`).
  — https://docs.dwservice.net/docs/api/agent-resource/

**Esto responde la pregunta clave: sí, se puede consultar el estado de un dispositivo de forma programática** (`state` Online/Offline/Disabled, `osType`, apps soportadas) y se puede dar de alta, renombrar y dar de baja dispositivos.

**`/sessions`** — https://docs.dwservice.net/docs/api/sessions-resource/
- `POST` con `{ idChannel, idAgent, locale, fullAccess, hideAppsBar, showAppOnLoad, postMessageOrigin, applications { ... } }` → `{ idChannel, url, tempcode }`. `tempcode` viene presente **solo si `idAgent` está vacío**, lo que crea una sesión temporal sin agent registered.
  — https://docs.dwservice.net/docs/api/sessions-resource/create-a-new-session/
- `GET` (listar), `GET /:id`, `DELETE` (cerrar). Campos: `id`, `idChannel`, `idAgent`, `initTime`, `ipAddress`, `frozen`, `frozenTime`. **Frozen tras 20 min de inactividad; destruida tras 24 h.**
  — https://docs.dwservice.net/docs/api/sessions-resource/
- ACL por aplicación y por ruta cuando `fullAccess: false`:
  - `desktop`: `fullAccess`, `allowScreenInput`, `allowAudio`, `hideToolBar`, `backgroundColor`, `messageBackgroundColor`, `messageColor`
  - `filesystem`: `paths: [{ name, path, edit, download, upload }]`
  - `texteditor`: `paths: [{ name, path, edit }]`
  - `logwatch`: `paths: [{ name, path, edit }]`
  - `resource`, `shell`: `fullAccess` booleano
  — https://docs.dwservice.net/docs/api/sessions-resource/create-a-new-session/
- IFrame: `postMessageOrigin` para restringir el origen de embebido; existen páginas dedicadas Open / Close / Show App in IFrame session.
  — https://docs.dwservice.net/docs/api/develop-the-web-application/ y https://docs.dwservice.net/docs/api/develop-the-web-application/open-iframe-session/

**Custom installer (white-label + run-only)** — https://docs.dwservice.net/docs/api/customize-the-installer/
- `install.json`: `{ name, mainurl, listenport, title, logo, topinfo, mode, runputcode, runtoptext, topimage, installputcode }`, con `mode: "run"` + `runtoputcode: true` para el modo portátil sin instalar, o `mode: "install"` + `installputcode: true`.
  — https://docs.dwservice.net/docs/api/customize-the-installer/example-configuration/
- Linux: `customize_installer_linux.sh <srcinstaller> <dstinstaller> <files>`.
  — https://docs.dwservice.net/docs/api/customize-the-installer/linux/
- Windows: abrir `dwagent_x86.exe` con 7-Zip, inyectar `install.json` + imágenes, renombrar. La doc **advierte explícitamente** que al inyectar archivos Avast/AVG probablemente lo marcan como malware y recomienda whitelisting ante AVG, Avast, F-Secure y Microsoft.
  — https://docs.dwservice.net/docs/api/customize-the-installer/windows/
- Ejemplos oficiales en PHP, C# y Java.
  — https://docs.dwservice.net/docs/api/php-example/

### 4.4 Modelo comercial de la API

> "the API allows the User to integrate the Application into their software. The User must purchase credits called 'tickets' to unlock some features provided by the API service. Credits can only be purchased by the account holder. The Owner does not authorize the transfer of credits from one account to another. Therefore, an API account cannot resell credits to another User. Tickets are valid for 24 months..."
> — https://www.dwservice.net/en/terms-and-conditions.html

Costos observados en el ejemplo de respuesta de `get-account-info`: `ticketPrice: 0.1` (USD), `agentCost: 3` tickets, `channelBasicCost: 60` tickets, `unit: mo` (mes). Es decir, del orden de **USD 0,30 por agent/mes y USD 6,00 por channel/mes** con esos valores de ejemplo.
— https://docs.dwservice.net/docs/api/account-resource/get-account-info/

**Trampa:** los "credits" no son transferibles entre cuentas y una API account **no puede revender credits**. Si nuestro producto vendiera sesiones, el modelo de reventa de credits está explícitamente restringido; hay que confirmar con DWSNET si revender *sesiones* (no credits) está permitido. **No verificado.**

### 4.5 Lo que la API NO expone

- **No hay webhooks ni eventos push.** El polling de `state` vía `GET /agents` es el único mecanismo de notificación de cambio de estado. No hay `POST` de eventos hacia nosotros.
- No hay endpoint para consultar **métricas** de una sesión (CPU, RAM, procesos) — `Resources` es una app de la sesión web, no un recurso de API.
- No hay API para **histórico de auditoría**; `Analyze events` es una vista del dashboard, no un endpoint documentado.
- No hay API de **usuarios/grupos/contactos**. De hecho la doc de API omite por completo cualquier recurso de usuarios: la API es deliberadamente *headless* de identidad, el modelo de usuarios lo aporta tu propia aplicación.
- No hay endpoint documentado de **file transfer** programático: el upload/download ocurre dentro del IFrame de la sesión.
- No hay versioning de API (`/v1/`): el path es `/en/api/json/`, con el idioma en la URL. No se documentó estrategia de deprecación.

### 4.6 Estado de la API hoy (verificación práctica)

- `https://www.apiremoteaccess.com/en/api/json/agents` → `HTTP 403`, body `{"message":"Forbidden.","status":403}`. Servidor vivo.
- `https://www.apiremoteaccess.com/en/api/json/account?request=info` → `HTTP 403`.
- `https://www.apiremoteaccess.com/` → `HTTP 404` en raíz; el host sirve solo bajo `/en/api/json/`.
- `https://api.dwservice.net/` → `HTTP 200` pero es **solo una página de redirect** (`<meta http-equiv="refresh" content="0;url=/en/home.html">`, 503 bytes). La URL de signup documentada (`api.dwservice.net/signup.html`) redirige al home general, así que **no pude verificar en vivo** las afirmaciones de "una sola API account para todos tus usuarios" que aparecen en material indexado de esa página. Queda como **no verificado contra la página en vivo**.

---

## 5. Estado actual de remote-monitoring-platform

| Feature | Dónde vive |
|---|---|
| Server Express + helmet + CORS + rate limit (general y login) | `server/src/server.ts` |
| WebSocket, namespaces `/admin` y `/agent` | `server/src/websocket/index.ts` |
| Auth JWT + refresh tokens, bcrypt | `server/src/security/jwt.ts`, `security/password.ts`, `services/auth.service.ts` |
| RBAC con 3 roles (SUPER_ADMIN, ADMIN, OPERATOR) y 12 permisos | `server/src/security/permissions.ts`, `middleware/rbac.ts`, tabla `RolePermission` |
| Registro de agentes + heartbeat 30s | `POST /api/devices/register`; `heartbeat` en `websocket/index.ts` y `agent/src/agent.ts` |
| Comandos remotos con workflow de aprobación | `POST /api/commands`, `POST /api/commands/:id/approve`, `/:id/reject`; `CommandStatus` = PENDING/APPROVED/EXECUTING/COMPLETED/FAILED/REJECTED |
| Capturas PNG bajo demanda, persistidas a disco | `POST /api/screenshots/request`, `services/screenshot.service.ts`, tabla `Screenshot` |
| Vista en vivo (frames JPEG por WS, no persistidos) | `live-view-frame` / `live-command` / `live-frame-result` en `websocket/index.ts`; `takeLiveFrame()` en `agent/src/commands.ts` |
| Grabación de video en el navegador → `.webm` | `client/src/pages/DeviceDetailPage.tsx` (MediaRecorder + canvas) |
| Auditoría de acciones de usuario | tabla `AuditLog`, `services/audit.service.ts`, `GET /api/audit` |
| Eventos por dispositivo | tabla `DeviceEvent` |
| Config del agente (machine-wide + fallback por usuario) | `agent/src/config.ts`: `%ProgramData%\RemoteMonitoringAgent\agent.json` y `%APPDATA%\remote-monitor-agent.json` |
| Captura multiplataforma con fallback | `agent/src/commands.ts`: `screenshot-desktop` + PowerShell/System.Drawing (bbox multi-monitor, máx 1280px, JPEG q70) |
| Deploy single-image en Dokploy | `Dockerfile` raíz, `nginx.conf` (proxy `/api`, `/socket.io`, `/uploads` → :3000), `dokploy.env.example` |

**Comandos que hoy soporta el agente** (`CommandType` en `server/prisma/schema.prisma`): `SCREENSHOT`, `SYSTEM_INFO`, `PROCESS_LIST`, `LOCK_SCREEN`, `SHUTDOWN`, `RESTART`, `LOGOUT`.

**Endpoints REST actuales:**

| Método | Ruta |
|---|---|
| POST | `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/profile` (GET) |
| GET/POST/PUT/DELETE | `/api/users`, `/api/users/:id`, `POST /api/users/:id/password` |
| POST | `/api/devices/register` |
| GET | `/api/devices/stats`, `/api/devices/`, `/api/devices/:id` |
| PUT/DELETE | `/api/devices/:id` |
| GET | `/api/commands/`, `/api/commands/device/:deviceId`, `/api/commands/device/:deviceId/pending` |
| POST | `/api/commands/`, `/api/commands/:id/approve`, `/api/commands/:id/reject` |
| GET | `/api/screenshots/`, `/api/screenshots/device/:deviceId`, `/api/screenshots/:id` |
| POST/DELETE | `/api/screenshots/request`, `/api/screenshots/:id` |
| GET | `/api/audit/` |
| GET | `/api/health` |

**Huecos evidentes frente a DWService:**

1. **Vista en vivo es read-only.** No hay inyección de input (mouse/teclado). Es el gap más grande: hoy el operador mira pero no toca.
2. **No hay file transfer**, ni terminal, ni editor de texto, ni tail de logs.
3. **No hay gestión de recursos/servicios** (start/stop servicios, terminar procesos) — solo *listar* procesos.
4. **El ACL es plano.** `CommandType` es un enum global; el permiso es "puede mandar comandos", no "puede mandar *este* comando *en esta* carpeta". No hay noción de compartir un device con otro usuario con permisos distintos.
5. **No hay sesiones de acceso remoto como entidad.** `AuditLog` registra acciones de admin, pero no existe un registro de "quién abrió una vista en vivo sobre qué device, desde qué IP, cuánto duró". Es el hueco más grave para un producto de auditoría.
6. **No hay control de bandwidth/calidad de streaming** más allá de intervalos fijos (1s/2s/5s).
7. **Agente solo Windows.** Sin Linux ni macOS.
8. **No hay auto-update del agente.**
9. **No hay modo run-only / portátil** para soporte puntual sin instalar.
10. **No hay branding propio en el instalador.**

---

## 6. Qué se puede extraer

Leyenda de la última columna: **API** = requiere usar la API de DWService (nos convertimos en clientes suyos, el server de ellos sigue siendo el centro). **Reimpl.** = reimplementación propia nuestra, sin dependencia.

| Capacidad DWService | Valor para nosotros | Viabilidad | Esfuerzo | Vía |
|---|---|---|---|---|
| **Modelo de ACL por app y por ruta** (`fullAccess:false` + whitelist de apps + `paths[{edit,download,upload}]`) | Cierra el hueco #4: pasar de `CommandType` plano a permisos granulares. Es el mejor concepto que nos queda | Alta | 1-2 días | **Reimpl.** (patentar la idea, no el código) |
| **IFrame de sesión con `postMessageOrigin`** | Resolver "operador toca el escritorio" sin reescribir control remoto | Alta (si hay SSL) | 2-4 días (proof of concept) | **API** |
| **Sesión como entidad con `initTime` / `ipAddress` / `frozen` / `frozenTime`** | Cierra el hueco #5: registro de auditoría de acceso remoto real, que hoy no existe | Alta | 1-2 días | **Reimpl.** del modelo; **API** si usamos sus sesiones |
| **Estados de agente como enum consultable** (`W/N/F/D` = Wait install / Online / Offline / Disabled) | Mejora nuestro `DeviceStatus` (hoy solo ONLINE/OFFLINE) y agrega el estado "esperando instalación" | Alta | 2-4 horas | **Reimpl.** trivial |
| **Consumo de recursos vía API** (`GET /account?request=info` → `credit`, `cost`, `priceList`) | Mostrar costo y consumo al cliente final si integramos con ellos (su `credit` y `cost` ya vienen en la respuesta) | Media | 1 día | **API** |
| **Instalador white-label y run-only** (`install.json`, `mode:"run"`, `runtoputcode`, `listenport:7956`) | Cierra el hueco #9: soporte a un equipo sin instalar nada. Alto valor comercial para venta a clientes | Media | 3-5 días | **API** (usar su custom installer) o **Reimpl.** de un launcher propio |
| **Log watch** (tail de un archivo con pause y multi-tab) | Cierra parte del hueco #2. Trivial de reimplementar sobre nuestro WebSocket | Alta | 1-2 días | **Reimpl.** |
| **Text editor sobre archivo remoto** | Complementa ScreenshotsPage; edición in-place sin descargar | Media | 2-3 días | **Reimpl.** |
| **Files and Folders con permisos** (upload/download/read-only) | Cierra el hueco #2; requiere storing de blobs en nuestro Postgres/disco | Media | 4-7 días | **Reimpl.** |
| **Resources: start/stop servicios, terminar procesos** | Cierra el hueco #3; nuevo `CommandType` + handler en `agent/src/commands.ts` | Alta | 1-2 días | **Reimpl.** |
| **Shell / terminal** | Poderoso pero el de mayor superficie de seguridad y de auditoría. No está en nuestro perfil de riesgo actual | Baja | 1-2 semanas | **Reimpl.** |
| **Auto-update del agente** | Cierra el hueco #8; hoy el deploy de agentes es manual | Media | 1 semana | **Reimpl.** |
| **Agente Linux/macOS** | Amplía el mercado; el repo MPLv2 ya tiene `os_linux/` y `os_mac/` | Media | 2-3 semanas | **Reimpl.** (o forkear `dwservice/agent`, ver licencias) |
| **Módulos de captura de audio y control** (`lib_screencapture`, `lib_soundcapture`, `lib_gdi`, `app_desktop`) | Si nos decidimos ir por control interactivo propio, estos son los componentes de bajo nivel ya resueltos y testeados | Media | 2-3 semanas | **Reimpl.** (módulo por módulo, respetando MPLv2) |
| **Nodos / afinidad agente-nodo / gestión de bandwidth** | Necesario solo si escalamos a miles de agentes. Hoy es sobredimensionado para nuestro deploy | Baja | 1 mes+ | **Reimpl.** |

### 6.1 Integrar con DWService vs. copiar su diseño — la distinción que importa

**Integrar con DWService (usar su API):**
- Nosotros somos un cliente más de su servicio. El tráfico de escritorio, file transfer y shell **pasa por la infraestructura de DWSNET** (Napolés, Italia) y por sus nodes. Para un producto que se vende como "monitoreo autorizado" con auditoría fuerte, esto es un problema de compliance y de privacidad: el cliente final tiene que saber que su escritorio pasa por un tercero, y nosotros no podemos garantizar SLA de esa parte.
- No podemos revender credits (T&C explícito). LaCannalización comercial queda murky.
- No podemos usar su agente en nuestro server, ni principled sus sesiones en nuestro `AuditLog` más allá de copiar el modelo.
- **Aun así tiene valor real como prueba de concepto**: si necesitamos control interactivo *ya*, integrate, medí cuánto tarda, y usalo como referencia de performance. No como arquitectura final.

**Copiar el diseño / reimplementar (nuestro camino):**
- Los **conceptos** (session entity, ACL per-app-per-path, agent state machine, run-only installer) no están protegidos como tal. MPLv2 cubre el *código* del agente, no las ideas del producto — el producto (web app, API, nodes) es software propietario de DWSNET según los T&C.
- MPLv2 es copyleft **por archivo**: si copiamos código del agente a nuestro repo, los archivos modificados hay que publicarlos bajo MPLv2. Mientras más código tomemos, más superficie de copyleft. El repo ya trae un `LICENSE` por carpeta precisamente para esto.
- **Nunca copiar**: `app_desktop` completo + protocol de node + cualquier cosa que hable con `apiremoteaccess.com`. Eso nos ataría a su infraestructura y a sus T&C.
- **Copiar con cuidado y solo lo aislado**: `lib_screencapture`, `lib_soundcapture`, `lib_turbojpeg`, `lib_osutil` (captura multiplataforma, el piece más difícil de reescribir bien y que ya tenemos resuelto a mano con PowerShell).
- **Regla práctica**: reimplementar comportamiento, no copiar archivos. Cuando algo sea demasiado específico para reinventar (ej. captura de audio remoto), tomar el módulo MPLv2 como dependencia vendorizada en su propio directorio con su LICENSE, no mezclado con nuestro código.

---

## 7. Qué NO conviene copiar

1. **El modelo push con node dedicado.** Es infraestructura cara de operar y es exactamente el problema que ya resolvimos con Socket.IO + Postgres. No ganamos nada adoptándola; solo sumamos un node más que operar.
2. **Cifrado solo en tránsito.** Si copiar su modelo de seguridad, nuestra vista en vivo ya es mejor: el tráfico termina en nuestro server, y el README declara que los frames no se persisten. No degrademos eso para parecernos.
3. **Dependencia de un único proveedor de relay.** Si nuestra plataforma es un producto para empresas, que el escritorio del cliente final dependa de `nodeXXXXX.dwservice.net` es un disqualifier para clientes regulados. No lo vamos a poder cambiar nunca (los nodes no son self-hosteables).
4. **Instalar `install.json` dentro del ejecutable.** La propia documentación admite que Avast/AVG lo flagean como malware. Un instalador que dispara quarantine en el endpoint del cliente final es inaceptable para venta empresarial. Si queremos run-only, lo hacemos con nuestro propio launcher firmado.
5. **Modo silencioso.** Está permitido pero los T&C ponen una condición estricta: el agente **no puede** ocultar íconos, procesos ni cualquier mecanismo de detección, y el instalador debe ser transparente para el usuario final con consentimiento revocable. Nuestro positioning ("monitoreo autorizado", footer softgroup.com.ar) **debe** respetar esto. No copiar ninguna variante stealth.
6. **La mecánica de credits/tickets.** Tipo $0,10 por ticket con slots mensuales es un modelo de pricing pensado para su proyecto open source, no para nuestro pricing empresarial.
7. **El agente tal cual.** Python 2 + C++ con MinGW para compilar, y con updates empujados desde la infra de DWService. Un fork se desincroniza del canal de updates desde el día uno. Paranosotros, que ya tenemos agente en TypeScript empaquetado con `pkg`, no tiene sentido.
8. **La ausencia de API de webhooks.** Es la debilidad más grande de su modelo de integrabilidad y una de las razones por las que integrarlos no escala: para enterarnos de que un equipo se cayó habría que pollar `GET /agents` con lo que eso cuesta.

---

## 8. Siguiente paso recomendado

1. **Añadir `DeviceSession` al schema y el modelo de ACL per-path.** Es el 80% del valor y el 0% del riesgo: no depende de DWService, cierra los huecos #4 y #5 (nuestro mayor agujero de auditoría), y es una reimplementación limpia de un concepto, no una copia. Empezar por `model DeviceSession { id, deviceId, userId, startedAt, endedAt, ipAddress, userAgent, frozenAt, applications Json, paths Json }` más un `PathGrant` y extender `Permission` con `DEVICES_SHARE`.

2. **Proof of concept del IFrame de DWService, con reloj.** No para|Ship: para medir. Crear una API account, meter `POST /sessions` en una ruta de experimentación, meter el `X-DW-Authorization` HMAC-SHA1 en `server/src/services/`, y ver en `DeviceDetailPage` si el IFrame con `postMessageOrigin` es usable. El resultado de esa medición decide si compramos control interactivo mientras tanto o lo construimos. **Timebox: 1 día.** Si la latencia o el embedding no funcionan, la decisión sale gratis.

3. **Implementar `LogWatch` y `FileTransfer` como `CommandType` nuevos.** Son las dos capacidades que más rápido se convierten en features vendibles, no dependen de la API de nadie, y el patrón ya existe: `agent/src/commands.ts` agrega un handler, `CommandType` agrega el enum, `websocket/index.ts` rutea. Empezar por LogWatch (es un `fs.watch` + emitting por el mismo canal que ya usan los live frames) y dejar FileTransfer para el sprint siguiente porque toca persistencia.

---

## 9. Fuentes

### Sitio oficial
| URL | Qué se verificó |
|---|---|
| https://www.dwservice.net/en/overview.html | Definición del servicio: acceso remoto vía navegador tras registro + agente |
| https://www.dwservice.net/en/applications.html | Las 6 aplicaciones (Screen, Files and Folders, Resources, Shell, Text editor, Log watch) y sus capacidades exactas |
| https://www.dwservice.net/en/security.html | Arquitectura de 3 componentes, TCP 443, cifrado por certificado SSL (**no E2E**), datos almacenados, nodos self-hosteables **solo planeados**, 2FA TOTP, "accounts are personal accounts" |
| https://www.dwservice.net/en/download.html | Licencias por componente del agente (MPLv2 core + libs), link al repo GitHub, actualizaciones automáticas |
| https://www.dwservice.net/en/about-us.html | Modelo de negocio por suscripciones, sede en Italia |
| https://www.dwservice.net/en/contribute-nodes.html | Los nodes son operados por DWService, el agente se redirige al más cercano/menos cargado |
| https://www.dwservice.net/en/terms-and-conditions.html | Definiciones (Owner = DWSNET s.r.l., Agent, Node, API), "Use of the Agent" (updates automáticos), **"Use of the API"** (tickets, no transferibles, no revender, 24 meses), "Permitted uses" + cláusula de modo silencioso, exención de garantía de performance/disponibilidad |
| https://www.dwservice.net/es/home.html | Link a la app Android, warnings de privacidad, lista de secciones del sitio |

### Documentación funcional
| URL | Qué se verificó |
|---|---|
| https://docs.dwservice.net/docs/site/ | Mapa completo del sitio de docs (165 URLs), navegación de secciones |
| https://docs.dwservice.net/docs/site/basic-definitions/screen-application/ | Toolbar de Screen: fullscreen, copy, paste, keystrokes, Win+Esc, Ctrl+Alt+Del, view-only mode, audio, multi-monitor, calidad |
| https://docs.dwservice.net/docs/site/basic-definitions/log-watch-application/ | Log watch: real-time, Open/Pause/Delete (no borra del archivo)/Tabs/Close |
| https://docs.dwservice.net/docs/site/basic-definitions/analyze-events/ | Event log filtrable del servicio |
| https://docs.dwservice.net/docs/site/basic-definitions/plans/ | Bandwidth por plan: Free 6, Entry 8, Lite 10, Basic 14, Advanced 20, Professional 30, Premium 50 Mbps |
| https://docs.dwservice.net/docs/site/basic-definitions/subscriptions/ | La suscripción no da features extra, solo bandwidth |
| https://docs.dwservice.net/docs/site/basic-definitions/commercial-use/ | Uso comercial explícitamente permitido (empresas, autoridades públicas, etc.) para todos; bandwidth es por sesión; única limitación = bandwidth |
| https://docs.dwservice.net/docs/site/basic-definitions/nodes/ | Función del node y lógica de redirección por carga |
| https://docs.dwservice.net/docs/site/basic-definitions/install-the-agent/ | Dos modos de instalación: con código o con credenciales |
| https://docs.dwservice.net/docs/site/basic-definitions/configure-proxy/ | Soporte de proxy en el agente |
| https://docs.dwservice.net/docs/site/dwservice-installation/how-do-i-run-only-the-agent/ | Modo run-only sin instalación, genera user/password |
| https://docs.dwservice.net/docs/site/dwservice-installation/how-do-i-install-the-agent-silently/ | Instalación silenciosa y su cláusula de no-ocultamiento |
| https://docs.dwservice.net/docs/site/agent-sharing/how-do-i-share-an-agent-with-restrictions/ | Compartir agent con apps específicas en vez de Full Access |
| https://docs.dwservice.net/docs/site/agent-sharing/how-to-share-a-folder-in-read-only-mode/ | Carpeta compartida read-only |
| https://docs.dwservice.net/docs/site/agent-sharing/how-to-disable-mouse-keyboard-for-share-agent/ | Desactivar input en agent compartido |
| https://docs.dwservice.net/docs/site/workarounds/ | Limitaciones conocidas: XWayland no soportado (Raspberry Pi), GNOME Wayland, pantalla negra, conexión lenta, resolución baja, carga de archivos/carpetas, remote printing, conflicto de monitores, shell con autenticación |
| https://docs.dwservice.net/docs/site/troubleshootfaq/ | Limitaciones: screen negro, "status of the agent unavailable", headless sin monitor, agente congelado con AVG/Avira, silent install por GPO, desinstalación manual por SO |

### Documentación de la API
| URL | Qué se verificó |
|---|---|
| https://docs.dwservice.net/docs/api/getting-started/ | Base URL `https://www.apiremoteaccess.com/en/api/json/`, REST/CRUD, recursos agents y sessions |
| https://docs.dwservice.net/docs/api/getting-started/authentication/ | Generación de API Key/Secret, Basic vs `X-DW-Authorization` HMAC-SHA1, expiración 10 min |
| https://docs.dwservice.net/docs/api/getting-started/request-structure/ | Semántica GET/PUT/POST/DELETE y formato `<base>/<resource>` |
| https://docs.dwservice.net/docs/api/getting-started/response-structure/ | Códigos 200/400/403/404 y objeto de error |
| https://docs.dwservice.net/docs/api/getting-started/prerequisites/ | Requisito de certificado SSL para el IFrame |
| https://docs.dwservice.net/docs/api/account-resource/ | Recurso `/account` |
| https://docs.dwservice.net/docs/api/account-resource/get-account-info/ | Estructura de respuesta completa con `priceList` (ticketPrice 0.1, agentCost 3, channelBasicCost 60 USD/mes) |
| https://docs.dwservice.net/docs/api/account-resource/add-services/ | `PUT ?request=addServices[&simulate=true]`, compra de slots con créditos |
| https://docs.dwservice.net/docs/api/account-resource/get-credit-transactions/ | Historial de transacciones ADD_SERVICES / ADD_CREDIT |
| https://docs.dwservice.net/docs/api/agent-resource/ | Campos del agent y **estados W/N/F/D** y **osType 1/2/3** |
| https://docs.dwservice.net/docs/api/agent-resource/create-an-agent/ | `POST` → `{ id, installCode }` |
| https://docs.dwservice.net/docs/api/agent-resource/list-all-agents/ | Listado con `state`, `supportedApplications` |
| https://docs.dwservice.net/docs/api/sessions-resource/ | Campos de sesión, frozen a los 20 min, destrucción a las 24 h |
| https://docs.dwservice.net/docs/api/sessions-resource/create-a-new-session/ | Payload completo de creación de sesión, ACL por app y por path, `tempcode` para sesión temporal |
| https://docs.dwservice.net/docs/api/develop-the-web-application/ | Integración vía IFrame y `postMessageOrigin` |
| https://docs.dwservice.net/docs/api/customize-the-installer/ | Customización del instalador (white-label y run-only) |
| https://docs.dwservice.net/docs/api/customize-the-installer/example-configuration/ | `install.json` completo: `mode`, `runtoputcode`, `listenport:7956`, `logo`, `topimage` |
| https://docs.dwservice.net/docs/api/customize-the-installer/linux/ | `customize_installer_linux.sh` |
| https://docs.dwservice.net/docs/api/customize-the-installer/windows/ | Inyección con 7-Zip + advertencia de falsos positivos AVG/Avast y links de whitelisting |
| https://docs.dwservice.net/docs/api/php-example/ | Ejemplos oficiales PHP, C#, Java |

### Código
| URL | Qué se verificó |
|---|---|
| https://github.com/dwservice/agent | Repo oficial: 583 stars, 116 forks, push 2026-09-18, Python, rama master, LICENSE por carpeta |
| https://github.com/dwservice/agent/blob/master/README.md | Python 2 + C++, pasos de build, deps de Wayland, MPLv2 |
| https://api.github.com/repos/dwservice/agent | Metadatos del repo (actividad, lenguaje, licencia) |
| https://api.github.com/repos/dwservice/agent/git/trees/master?recursive=1 | Estructura real: `app_*`, `core`, `lib_*`, `os_linux`, `os_mac`, `os_win_service`, `os_win_installer`, `os_win_updater`, `ui`, `make` |

### Verificaciones en vivo (curl, 2026-09-25)
| URL | Resultado |
|---|---|
| `https://www.apiremoteaccess.com/en/api/json/agents` | `HTTP 403` — `{"message":"Forbidden.","status":403}`. API activa |
| `https://www.apiremoteaccess.com/en/api/json/account?request=info` | `HTTP 403` |
| `https://www.apiremoteaccess.com/` | `HTTP 404` en raíz; el host solo sirve bajo `/en/api/json/` |
| `https://api.dwservice.net/` | `HTTP 200` pero es solo un redirect HTML de 503 bytes a `/en/home.html`. **No se pudo verificar el cuerpo de marketing** |

### No verificado (marcado como tal)
- **Precios concretos de los planes** (Entry→Premium): la página `contribute-subscriptions.html` carga los precios dinámicamente; no están en el HTML estático. Solo se verificaron los Mbps por plan.
- **Si se permite revender sesiones** (distinto de revender credits, que está prohibido explícitamente). Requiere consulta a DWSNET s.r.l.
- **Si la API tiene SLA, rate limits o límites de undocumented**. No hay ninguno documentado.
- **Volumen de nodos activos y capacidad**: la lista de nodes en `contribute-nodes.html` se carga dinámicamente.
- **"Una sola API account para todos tus usuarios"**: aparece en material indexado de `api.dwservice.net`, pero esa página hoy es un redirect vacío y no se pudo re-verificar el texto original.
- **Si existe un nodo self-hosteable hoy**: la fuente dice que está *planeado*, y la lista de nodos es dinámica. Verificado que no hay ninguno self-hosteable en la documentación actual.
- **Issues del repo oficial**: al momento de la consulta solo había **1 issue abierto** (#74, documentación de versión de Python). El tracker público de GitHub no es el canal de soporte real, así que **la densidad de issues no es una señal fiable** sobre limitaciones del producto.

---

## Archivos del proyecto leídos para la comparación

- `README.md`, `agent/README.md`
- `agent/src/commands.ts`, `agent/src/config.ts`, `agent/src/agent.ts`
- `server/src/server.ts`, `server/src/websocket/index.ts`
- `server/src/routes/{auth,user,device,command,screenshot,audit}.routes.ts`
- `server/prisma/schema.prisma`
- `nginx.conf` (raíz), `Dockerfile` (raíz), `dokploy.env.example`
