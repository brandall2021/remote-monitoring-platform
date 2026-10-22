# Auditoría de seguridad y funcionalidad — remote-monitoring-platform

Repositorio analizado: `https://github.com/brandall2021/remote-monitoring-platform.git` (clon fresco, rama `master`).
Fecha: 2026-10-21.

Esta revisión tuvo **tres pasadas**:

1. **Pasada 1 — auditoría (solo lectura).** No se modificó ni una línea del código; no se hizo commit ni push. Son las secciones 1 a 8, que quedan tal como se redactaron en ese momento.
2. **Pasada 2 — remediación.** A pedido del dueño del repo se implementó la lista de la sección 8 en el working tree. **Las secciones 1-8 describen el estado *anterior* a los fixes** (hay que leerlas junto con la sección 10, que marca qué se cerró, cómo se verificó y qué queda abierto). Tampoco acá se hizo commit ni push: los cambios están en el árbol de trabajo sin stagear.
3. **Pasada 3 — el agente se ve (bandeja) + instalador regenerado** (sección 11). Pedido posterior: que el agente corra minimizado en el tray y que exista un instalador. Cambia la sección 6 (aviso al usuario), agrega superficie nueva en el agente y vuelve a producir los tres `.exe`.


---

## 1. Resumen ejecutivo

El sistema es una plataforma RMM (monitoreo remoto) compuesta por tres piezas: un servidor Express + Socket.IO + Prisma/PostgreSQL, un cliente SPA React/Vite/MUI, y un agente Windows compilado con `pkg` que corre como SYSTEM y captura screenshots y escritorio en vivo. Desde la sección 11 el agente **no es invisible para el usuario**: muestra un icono de bandeja con el estado y el instalador trae una pantalla de aviso.

El producto funciona y está bien integrado entre sus partes, pero **en el estado auditado no era seguro para estar expuesto a una red corporativa**. Los problemas no son detalles de estilo: había cinco vías distintas por las que una persona autorizada de bajo privilegio —o cualquier usuario local de una máquina monitoreada— podía terminar viendo escritorios ajenos o apagando equipos.

Hallazgos más graves, en una línea cada uno, con el estado tras la pasada 2 (detalle en la sección 10):

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| C-1 | Crítica | El `seed` reasigna `admin123` al SUPER_ADMIN **en cada arranque del contenedor**; la contraseña fuerte se revierte sola. | ✅ Cerrado + test |
| C-2 | Crítica | El namespace WebSocket `/admin` **no evalúa permisos**: un OPERATOR autenticado puede apagar, reiniciar, bloquear sesiones y ver el escritorio en vivo de cualquier equipo. | ✅ Cerrado + test |
| C-3 | Crítica | Los screenshots de escritorio se sirven por `/uploads/screenshots` **sin autenticación**: basta la URL. | ✅ Cerrado + test |
| C-4 | Crítica | `GET /api/devices` devuelve el `registrationToken` de **todos** los agentes a cualquiera con `DEVICES_READ` (incluido OPERATOR). Con ese token se suplanta al agente. | ✅ Cerrado + test |
| C-5 | Crítica | Un ADMIN puede crear/promover usuarios a SUPER_ADMIN y resetearle la contraseña, porque las rutas de usuarios cuelgan de `USERS_WRITE`. Escalada de privilegios completa. | ✅ Cerrado + test |
| H-1 | Alta | El instalador concede **Modify al grupo Users** sobre el `agent.json` de ProgramData, que contiene el token del dispositivo: cualquier usuario local puede rotarlo y redirigir el tráfico de un agente que corre como SYSTEM. | ✅ Cerrado (trade-off documentado) |
| H-2 | Alta | La named pipe `\\.\pipe\rmagent-session` acepta **cualquier** conexión local como "worker" suplante. | ✅ Cerrado + test |
| H-3 | Alta | Sin `trust proxy` detrás de nginx: el rate-limit por IP se vuelve lockout global y el registro de auditoría queda sin IP real. | ✅ Cerrado + test |
| H-4 | Alta | Tokens JWT de acceso y refresh (7 días) en `localStorage`: un XSS es toma de control total. | ✅ Cerrado (parcial: ver 10.4) |
| H-5 | Alta | `npm audit` en el árbol de producción: 1 `critical` (`proxy-addr`) y varios `high` (`engine.io`). | ✅ 0 avisos de producción |
| H-6..H-9 | Alta | Payloads sin cota, placeholder default + comparación no constante, `Math.random()`, binarios commitados. | ✅ los tres primeros; ⚠️ H-9 sigue abierto (en la sección 11 se regeneraron los tres `.exe`, pero continúan siendo inaudibles desde el fuente) |

Además hay un componente que no es un bug sino un riesgo legal: el instalador declaraba explícitamente *"El agente se ejecutara oculto al arrancar Windows"*. Monitorear el escritorio de empleados sin consentimiento informado choca con la Ley 25.326 de Protección de Datos Personales (Argentina). Lo dejo señalado en la sección 6 porque es decisión del dueño del producto, no del código. **Tras la sección 11 está parcialmente cerrado**: hay icono visible en la bandeja y pantalla de aviso en el instalador; falta el aviso de privacidad formal.

---

## 2. Alcance y método

Se leyó el 100 % de la superficie expuesta: `server/src/**` (middleware, controladores, servicios, rutas, WebSocket, config), `prisma/schema.prisma` + `seed.ts`, `agent/src/**`, `agent/installer/**` (PowerShell + Inno Setup), `client/src/**`, los `Dockerfile`s, ambos `docker-compose` y las configuraciones de nginx.

Sobre ese reading se hicieron tres verificaciones activas:

1. **Build y tests**: `npm install` + `tsc` + `vitest` en `server`, `agent` y `client`; `vite build` en el cliente.
2. **`npm audit`** en el árbol de producción.
3. **Sondeo HTTP en runtime**: se arrancó el server con `JWT_SECRET` y `AGENT_REGISTRATION_TOKEN` vacíos sobre un directorio de uploads temporal (`server/tmp-uploads`, ya eliminado) y se le consultaron rutas reales. El proceso quedó detenido y el puerto 3999 liberado.

Cómo leer la etiqueta de cada hallazgo:

- **(V)** = verificado en runtime: hay una petición real con una respuesta concreta que lo prueba.
- **(I)** = solo inspección de código: la conclusión sale de leer la fuente; no se pudo ejercitar porque requiere PostgreSQL/Redis y agentes vivos, inexistentes en esta máquina.

---

## 3. Hallazgos críticos

> **Estado tras la pasada 2:** los cinco están cerrados y cubiertos por tests. Detalle por hallazgo en 10.2.


### C-1. El seed resetea la contraseña del superadministrador en cada arranque (V)

`server/prisma/seed.ts:29-31` calcula `bcrypt.hash("admin123", 12)` y lo pasa en la cláusula `update:` de un `prisma.user.upsert`. Como `Dockerfile:41` ejecuta `node dist/prisma/seed.js` dentro del `CMD`, **cada vez que el contenedor arranca, se reinicia, se escala o Dokploy lo redeployea**, la contraseña del SUPER_ADMIN vuelve a `admin123`.

Consecuencia práctica: no sirve cambiar la contraseña desde el panel. Cualquier persona que sepa que este es el proyecto público de GitHub de la empresa tiene la credencial de superadmin permanentemente vigente.

El README no advierte de este comportamiento; lo describe como "prisma db push + seed" como si fuera un paso de bootstrap inicial.

### C-2. `/admin` (WebSocket) ignora todo el modelo RBAC (I)

`server/src/websocket/index.ts:59` autentifica el JWT y marca `socket.isAdmin = true`. A partir de ahí **ningún handler vuelve a consultar permisos**. Los mismos middlewares `requirePermission(...)` que protegen las rutas HTTP no existen en el canal en tiempo real, que justamente es el que tiene las acciones más destructivas:

- `:91` `request-screenshot` — captura pantalla de cualquier `deviceId`.
- `:116` `send-command` — reenvía `data.commandType` al agente sin whitelist: shutdown, reboot, logout, lock.
- `:147` `live-view-frame` — se une a la sala `live:${deviceId}` y ordena al agente empezar a emitir escritorio en vivo.

`src/types/index.ts:67-87` sí define que OPERATOR no tiene `COMMANDS_WRITE`, y `src/middleware/rbac.ts` está implementado y funcionando. El problema es puramente de cableado: el autor escribió el control de acceso y se olvidó de conectarlo al namespace donde vive el poder real. Un OPERATOR —el rol de "muchachito de mesa de ayuda"— puede apagar la notebook del contador o mirar su pantalla.

### C-3. Screenshots de escritorio públicos sin autenticación (V)

`server/src/server.ts:55-56` monta `express.static` en `/uploads/screenshots` **antes** de las rutas de API y sin middleware de auth. Se verificó en runtime: un `GET /uploads/screenshots/prueba.png` sin cabecera `Authorization` devolvió `200` con el archivo.

 nginx refuerza la exposición en vez de cerrarla: `nginx.conf:41-43` y `client/nginx.conf:29-31` proxean `/uploads` también sin auth y sin cabeceras de seguridad.

Motivo del diseño: `client/src/pages/ScreenshotsPage.tsx:48-49,228` y `DeviceDetailPage.tsx:685-686` construyen `<img src="/uploads/screenshots/${filePath.split('/').pop()}">`, y un `<img>` no manda Bearer token. Es decir, se sacrificó la confidencialidad de todo el archivo de monitoreo para no implementar un endpoint firmado.

Riesgo real: las capturas de escritorio contienen lo que el empleado tiene abierto —homebanking, mail, legajos, datos de clientes—. Son el activo más sensible del sistema y están indexables por cualquier spider, filtrables por el `Referer` y accesibles para todo el que adivine un UUID (o lea la lista del paso C-4).

### C-4. `GET /api/devices` filtra el token de registro de todos los agentes (I)

`server/src/services/device.service.ts:76` genera un `crypto.randomBytes(24).toString("base64url")` por dispositivo y lo guarda como su credencial. Pero `findAll` y `findById` devuelven la fila Prisma **completa**, incluyendo `registrationToken` y `agentVersion`, y la ruta `GET /api/devices` está abierta a cualquiera con `DEVICES_READ`. Según `src/types/index.ts:67-87`, OPERATOR tiene `DEVICES_READ`.

Una vez que un OPERATOR (o quien robe una sesión de OPERATOR) tiene el token de un dispositivo, se conecta al namespace `/agent` y **es ese equipo** a los ojos del servidor: recibe comandos y manda screenshots falsos. Es el equivalente a dejar las llaves de todos los agentes colgadas del clavo de la recepción.

### C-5. Escalada ADMIN → SUPER_ADMIN por `USERS_WRITE` (I)

`src/types/index.ts:67-87` da a ADMIN los permisos `USERS_READ` y `USERS_WRITE`. `src/routes/user.routes.ts:21-40` protege `POST /`, `PUT /:id` y `POST /:id/password` exactamente con `USERS_WRITE`. Y `src/controllers/user.controller.ts:6-21` acepta `role: z.enum(["SUPER_ADMIN","ADMIN","OPERATOR"])` en el body sin comparar con el rol del solicitante.

Resultado: un ADMIN puede (a) crear un usuario con `role: "SUPER_ADMIN"`, (b) cambiarle el rol al suyo propio, o (c) resetear la contraseña del SUPER_ADMIN por `POST /:id/password`. Ninguna de las tres operaciones está reservada a SUPER_ADMIN. La escalada es un `curl`.

---

## 4. Hallazgos de severidad alta

> **Estado tras la pasada 2:** H-1 a H-8 cerrados (H-4 y H-1 con trade-offs documentados); **H-9 sigue abierto**. Detalle en 10.3.


### H-1. El agente expone su credencial a cualquier usuario local (I)

`agent/installer/install-silent.ps1:135` ejecuta `icacls $ConfigDir /grant "*S-1-5-32-545:(OI)(CI)M" /T`, donde `S-1-5-32-545` es el grupo **Users** local y `M` es **Modify** con herencia, recursivamente sobre `C:\ProgramData\RemoteMonitoringAgent\`. Ahí vive `agent.json`, y `agent/src/config.ts:19-23` confirma que `MACHINE_CONFIG_FILE` guarda `serverUrl` y el `registrationToken` del equipo.

El supervisor corre en sesión 0 como SYSTEM (`install-silent.ps1:137-157`, `New-ScheduledTaskPrincipal -UserId "S-1-5-18" -RunLevel Highest`). Cualquier empleado con una sesión normal en la máquina monitoreada puede:

1. Leer su propio token → suplantar a su agente desde otra máquina y ver qué comandos le llegan.
2. Editar `serverUrl` → el agente con SYSTEM empieza a mandar los cuadros de escritorio del usuario a **un servidor controlado por el empleado**, y el panel legítimo deja de recibir datos (monitoreo silenciosamente ciego).

Es exactamente el escenario que este producto debería defender: el monitoreado no debe poder desactivar ni redirigir el agente. Acá basta un `notepad` con permisos de usuario estándar.

Nota: el `/T` recursivo hace que el permiso también aplique a los binarios instalados en ese directorio.

### H-2. La named pipe del agente no autentifica al worker (I)

`agent/src/sessionProtocol.ts:26` define `SESSION_PIPE_NAME = "\\\\.\\pipe\\rmagent-session"`. `sessionSupervisor.ts:47-59` la crea con `net.createServer` sin DACL explícito y `attachWorker` (`:107-120`) **acepta como worker legítimo a cualquier socket que conecte**; `pickWorker()` toma el primero vivo.

Un usuario local puede conectarse antes (o en paralelo) y hacer dos cosas: responder con frames falsos (una imagen fija de un escritorio limpio mientras el usuario hace otra cosa) o saturar al supervisor con conexiones para que el worker real nunca quede electo → el escritorio en vivo deja de funcionar. En un sistema de control laboral, la capacidad de un empleado de inyectar un frame arbitrario anula el propósito del producto.

`MAX_PAYLOAD_BYTES = 32 MB` además permite que un suplante mande 32 MB por frame por cada socket, sin cotas por cliente.

### H-3. Falta `trust proxy`: rate limit roto y auditoría sin IP (V)

`grep -rn "trust proxy" server/src` no devuelve nada, y el despliegue de producción (`Dockerfile` + `nginx.conf`) pone nginx delante del Node en `:3000`. Sin `app.set('trust proxy', ...)`, Express ve como origen de **toda** petición la IP del contenedor nginx (`127.0.0.1`).

Dos consecuencias, ambas verificadas por inspección del `express-rate-limit` en `src/server.ts`:

- El limiter de login (`10 intentos / 15 min`) se comparte entre todos los usuarios del planeta. Diez malententados —o un scanneador— bloquean el login **global**, o sea lockout de todo el sistema con una sola IP. Es un DoS trivial y no intencional.
- `req.ip` usado en la auditoría es siempre `127.0.0.1`. El registro de quién hizo qué pierde la única pista forense que sirve.

`proxy-addr` está además en el árbol de dependencias con aviso `critical` (ver H-5), así que el componente que hace falta para arreglar esto es justamente el que tiene el advisory.

### H-4. JWT de acceso y refresh de 7 días en `localStorage` (I)

`client/src/hooks/useAuth.tsx:29,49-50` lee y escribe `accessToken` y `refreshToken` en `localStorage`; `client/src/services/api.ts:28,55` hace lo mismo en el interceptor de refresh. Cualquier XSS en la SPA —que con un bundle de 924 kB sin dividir y dependencias de terceros es del todo plausible— exporta las dos credenciales y habilita sesión válida durante siete días, sin importar que el usuario cierre el navegador.

El patrón correcto acá es cookie `HttpOnly` + `SameSite=Strict` para el access token, o al menos refresh en cookie HttpOnly. `cookie-parser` ya está montado (`server/src/server.ts:6,52`) pero sin `csurf`/verificación de origen: hay infraestructura de cookies disponible y no se usa.

Complemento: `client/src/App.tsx:15-20,64-69` solo tiene un guard `isAuthenticated`; no hay guard por rol en las rutas, así que la UI de un OPERATOR muestra los botones de shutdown/reboot que el servidor (mal) le va a dejar usar.

### H-5. Dependencias con avisos en producción (V)

`npm audit` en el árbol de producción del server reporta **1 crítico** (`proxy-addr`) y varios **altos** (`engine.io`, transitivo de `socket.io`). No se puede publicar un fix sin tocar versiones; hay que actualizar `socket.io` y Express.

### H-6. Sin límite ni validación en lo que manda el agente (I)

`src/websocket/index.ts:197-251`, handler `command-result`:

- Acepta un `commandId` **cualquiera** sin comprobar que ese comando pertenezca a ese `deviceId`. Un agente comprometido (ver C-4) puede escribir resultados sobre comandos de otros dispositivos.
- Toma `data.result.imageBase64` y lo persiste con `fs.writeFileSync(path.join(screenshotsDir, uuidv4()+'.png'))` sin validar tamaño ni tipo de contenido.
- No se configura `maxHttpBufferSize` en ninguna parte, así que rige el default de socket.io (1 MB). Para el stream JPEG en vivo pedido a pantallas grandes es demasiado chico: **los frames se truncan** (bug funcional, ver sección 5).

### H-7. Token de registro por defecto y comparación no constante (V/I)

`src/config/index.ts:23`: `registrationToken: process.env.AGENT_REGISTRATION_TOKEN || "change-this"`. Verificado en runtime: `POST /api/devices/register` con `"registrationToken":"change-this"` devuelve **201** cuando la variable de entorno está vacía. Un deploy que olvide la envVar queda con la puerta abierta con el valor que está publicado en un README de GitHub.

`docker-compose.yml:46-47,54` repite el patrón con defaults embebidos para `JWT_SECRET` y `JWT_REFRESH_SECRET`: si no se exportan, el server firma tokens con un secreto que conoce todo el mundo. `docker-compose.dokploy.yml` además pasa los secretos crudos a `DATABASE_URL` sin escapar.

En el mismo registro (`src/controllers/device.controller.ts:44-57`) la comparación es `device.registrationToken !== token`, con `!==` de strings: temporalmente distinguible, y `deviceService.register(req.body)` recibe el body **sin esquema zod**, con lo que un cliente puede fijar campos a su antojo. Y en el error se devuelve `error.message` crudo: se verificó que un `POST` malformado responde un mensaje interno de Prisma a un llamador **no autenticado**.

### H-8. Generación de tokens con `Math.random()` (I)

`src/security/password.ts:16-23` construye `generateToken()` acumulando `chars.charAt(Math.floor(Math.random() * chars.length))`. `Math.random()` no es CSPRNG: con el seed observado en pocas llamadas se puede predecir la salida. Hoy se usa para los enlaces firmados de envío de mail (password reset / invitaciones), así que es directamente una vía de takeover de cuenta. `randomBytes` de Node está disponible, solo que no se usa acá (en el token de dispositivo sí).

### H-9. Binarios compilados commitados (I)

El repo incluye `agent-live.exe` y `RemoteMonitoringAgentSetup.exe`. Nadie puede verificar que esos ejecutables correspondan al código fuente de `agent/src`. Son una cadena de suministro inauditable: cualquiera con permiso de escribir en la rama puede publicar un binario distinto sin que aparezca en ningún diff.

---

## 5. Hallazgos de severidad media

> **Estado tras la pasada 2:** cerrados, salvo HSTS, bundle sin dividir, CORS de un único origin y el adaptador Redis de socket.io. Detalle en 10.4 y 10.7.


- **Sin auditoría de las acciones destructivas.** `src/middleware/audit.ts` define `auditLog()`, pero `grep` no muestra ninguna importación: es código muerto. Y cuando se active, serializa `{ body: req.body }` completo en `details`, o sea volcaría payloads de contraseñas en la tabla de auditoría. Hoy el sistema puede apagar equipos y resetear usuarios sin dejar rastro.
- **Paginación sin límite superior.** Los controladores aceptan `limit` del query sin techo: `?limit=1000000` es un DoS por agotamiento de memoria.
- **Inconsistencia de migraciones.** `server/Dockerfile:29` usa `prisma migrate deploy`, pero solo existe `prisma/migrations/20260810_add_device_alias/migration.sql` (un `ALTER TABLE "devices" ADD COLUMN "alias" TEXT;`), y la imagen raíz hace `prisma db push`. Son dos caminos de esquema incompatibles: en un ambiente con la base ya creada por `db push`, `migrate deploy` no va a aplicar la columna `alias`, y a la inversa el estado de `/_prisma_migrations` queda inconsistente.
- **Sin CSP ni HSTS para la SPA.** Los `nginx.conf` no emiten `Content-Security-Policy`, `X-Frame-Options` ni `Strict-Transport-Security`. Con tokens en `localStorage` (H-4), la ausencia de CSP es la que deja el vector abierto.
- **Bundle de 924 kB sin dividir.** `vite build` emite un único chunk; no hay `manualChunks` ni lazy loading de rutas. Incide en TTI y es el riesgo clásico de un `<script>` de terceros en una app de monitoreo.
- **Comparaciones de credencial no constantes** en `websocket/index.ts:77` (token de agente) y en el registro HTTP.
- **`helmet()` con la config default** y CORS con `origin: config.cors.origin` único: no hay CSP configurada dentro de helmet, y un único origin sin validación de protocolo/hostname es frágil ante un typo en la envVar.
- **Redis declarado pero sin uso.** Está en arquitectura y compose, pero ningún code path leído lo consulta. El estado de sockets vive en memoria: **impide escalar a más de una réplica** del server (un agente conectado a la réplica A no recibe el comando emitido desde la réplica B), que es el motivo por el que Redis suele estar en estos diseños.
- **El heartbeat marca offline a 60 s** (`setInterval(markOfflineDevices, 60000)`) contra un heartbeat declarado de 30 s: solo dos de tolerancia. Un Windows con Session 0 ocupado en el logon va a parpadear online/offline.

---

## 6. Dimensión legal y de gobernanza (no es un bug de código)

`agent/installer/RemoteMonitoringAgent.iss` declaraba: *"El agente se ejecutara oculto al arrancar Windows"*. `install.ps1:6` instala en `%LOCALAPPDATA%` con tarea `AtLogOn` y el `.iss` fija como servidor por defecto `https://monitor.recuperocrediticio.com`, un dominio de producción ajeno al nombre del repo.

Sobre el producto en sí: capturar el escritorio en vivo de empleados es tratamiento de datos personales sensibles. En Argentina cae bajo la Ley 25.326 y su reglamento, que exige consentimiento informado y finalidad declarada, más registro en la bases de datos de la AAIP. Monitoreo encubierto sin política ni notificación escrita es, además de un problema de clima laboral, un riesgo legal concreto para la empresa que lo use. El software puede estar bien; el modo de usarlo puede no estarlo. Corresponde que el dueño del proyecto lo resuelva con un aviso legal, un cartel visible del agente y una política interna, no con un parche.

El dominio hardcodeado es otro tema: cualquiera que forkee este instalador va a estar mandando escritorios al servidor de un tercero.

> **Estado tras la sección 11:** la parte técnica de este hallazgo está **parcialmente cerrada**. Ya no hay un texto que declare "oculto": el `.iss` muestra una pantalla de aviso (`TOutputMsgMemoWizardPage`) que describe qué se instala, qué se captura y cómo se quita, y el agente ahora deja un **icono visible en la bandeja** del usuario con el estado del monitoreo. Lo que sigue abierto es lo que no es código: el aviso de privacidad formal (responsable del dato, finalidad, registro AAIP) y la política interna. Ver 10.7 punto 2.

---

## 7. Evaluación funcional

Lo que **sí** funciona y está bien hecho, con la evidencia de la verificación:

**Servidor** — `tsc --noEmit` limpio, compila sin errores. La lógica de dominio (dispositivos, comandos, screenshots, roles, auth con access/refresh y refresh persistido en base) es coherente y está tipada de punta a punta con zod en la capa HTTP. Arquitectura legible: routes → controllers → services.

**Agente** — **44 tests pasan** (`vitest run`) y `tsc` exit 0. Esta es la parte mejor escrita del proyecto. El diseño del puente de sesión es técnicamente correcto y poco común: un supervisor en sesión 0 como SYSTEM no puede dibujar en el escritorio del usuario, así que usa `WTSGetActiveConsoleSessionId` + `WTSQueryUserToken` + `CreateProcessAsUser` con `"winsta0\\default"` (`start-session.ps1:100-150`) para lanzar un worker en la sesión interactiva y hablar con él por named pipe. Está bien pensado. `commands.ts` restringe el vocabulario a un set fijo de verbos (screenshot, info de sistema, `Get-Process`, `rundll32 user32.dll,LockWorkStation`, `shutdown /s|/r|/l`), sin pasar comandos arbitrarios del server al shell —esto es un acierto de seguridad notable—. El fallback de captura en PowerShell escala a 1280 px de ancho con JPEG calidad 70: decisión de ancho de banda sensata.

**Cliente** — `vite build` exitoso. La bomba de frames de live view en `DeviceDetailPage.tsx:108-300` usa `setInterval` + `<canvas>` + `MediaRecorder` con limpieza correcta en el `useEffect` teardown, sin fugas evidentes. El manejo de refresh en el interceptor de `api.ts` es razonable.

Divergencias entre el README y el código (funcionalidad prometida vs entregada):

1. *"Auditoría completa, roles y permisos (RBAC)"* → el RBAC existe para HTTP pero **no se aplica al canal en tiempo real** (C-2), y el log de auditoría es **código muerto** (H-5/media). Las dos acciones más sensibles del sistema no están ni controladas ni registradas.
2. *"Descarga del `.webm` grabado con MediaRecorder"* → funciona en el cliente, pero choca con el `maxHttpBufferSize` default de 1 MB (H-6): en resoluciones reales los frames se truncan y la grabación sale con huecos.
3. *"Prisma db push + seed"* como paso de arranque → no es bootstrap, es un reseteo de contraseña recurrente (C-1).
4. Dos `Dockerfile` con estrategias de esquema incompatibles (`db push` vs `migrate deploy`) y un `docker-compose.dokploy.yml` que inyecta secretos crudos a la connection string.
5. El heartbeat de 30 s contra un detector de offline a 60 s deja dos latidos de tolerancia (ver sección 5).

Lo que **no** se pudo ejercitar y por qué: no hay PostgreSQL ni Redis accesibles en esta máquina ni en el path de CI local, así que el flujo completo login → screenshot → live view → descarga `.webm` **no se corrió end-to-end**. Lo que sí se obtuvo en runtime con el server arrancado sobre un directorio temporal: `/api/health` → 200; `/api/devices` sin token → 401 (el gate HTTP funciona); `/uploads/screenshots/prueba.png` sin token → **200 con el archivo**; registro de dispositivo con `change-this` → **201** y con `NOPE` → 403; body malformado → 400 con el mensaje interno de Prisma filtrado al cliente. `server/tmp-uploads` se eliminó después de las pruebas y el proceso quedó detenido.

Y la limitación más grande de **la pasada 1**: **el server no tenía ningún test** (`vitest run` respondía "No tests found, exiting with code 1"). El agente tenía 44. Todo lo que está en las secciones 3 y 4 del lado del server era concluyente por lectura de fuente y por los probes anteriores, pero no había una suite que lo sostuviera ni que impidiera que volviera a romperse. Eso cambió en la pasada 2: hoy el server tiene 99 tests en 9 suites y el agente 63 en 7 (sección 10.5).

---

## 8. Remediación priorizada

**Bloqueante antes de cualquier redeploy (una tarde):**

1. Sacar el `seed.js` del `CMD` del `Dockerfile:41` y correrlo solo en bootstrap, o que saltee el `update` si el usuario ya existe. Rotar la contraseña del SUPER_ADMIN inmediatamente. (C-1)
2. Hacer `fail-fast` en el arranque si `JWT_SECRET`, `JWT_REFRESH_SECRET` o `AGENT_REGISTRATION_TOKEN` están vacíos o valen los placeholders. (H-7)
3. Borrar el `express.static` de `/uploads/screenshots` de `src/server.ts:55-56` y reemplazarlo por `GET /api/screenshots/:id` detrás de `requireAuth` + `requirePermission(SCREENSHOTS_VIEW)` que haga `res.sendFile` con un `Content-Disposition` seguro. Ajustar las dos páginas de cliente que arman el `<img src>`. Borrar el `location /uploads` de ambos nginx. (C-3)
4. Proyectar las entidades en el servicio: `device.service.findAll/findById` debe devolver `select` explícito sin `registrationToken`. (C-4)

**Semana 1:**

5. Aplicar `requirePermission` dentro del namespace `/admin`: un helper `withPermission(socket, PERM)` llamado en los cuatro handlers (`request-screenshot`, `send-command`, `live-view-frame`, `stop-live-view`), más una whitelist de `commandType` en el server. (C-2)
6. Reservar las tres rutas de `user.routes.ts` a SUPER_ADMIN —o validar que `body.role` no exceda el rol del solicitante y que no se toque a un SUPER_ADMIN desde un ADMIN—. (C-5)
7. `app.set('trust proxy', 1)` y actualizar `proxy-addr`/`engine.io`/`socket.io` con `npm audit fix`, revisando los breaking. (H-3, H-5)
8. Cambiar el storage de tokens a cookie `HttpOnly; Secure; SameSite=Strict` (o al menos refresh en cookie HttpOnly) y agregar CSP con `default-src 'self'` y HSTS en nginx. (H-4, media)

**Semana 2 — agente (requiere reinstalar los endpoints):**

9. En `install-silent.ps1`, quitar el `Users:(OI)(CI)M` sobre el config. Dejar el `.ps1` con `Administrators:F, SYSTEM:F, Users:R` o mejor sin lectura para Users, y mover el token del config a **Guardado de Credenciales de Windows** o a una clave de registro ACL-eada a SYSTEM. (H-1)
10. Proteger `\\.\pipe\rmagent-session` con un `CreatePipeSecurityDescriptor` que solo conceda acceso al SID del supervisor, y verificar en `attachWorker` el peer SID o un challenge-secret pasado por el entorno del proceso hijo. (H-2)
11. Reemplazar `Math.random()` por `randomBytes` en `security/password.ts`. (H-8)
12. Validar ownership de `commandId` en `command-result`, cotas de tamaño sobre `imageBase64`, y setear `maxHttpBufferSize` acorde al stream JPEG (2-5 MB). (H-6)
13. Borrar los `.exe` commitados y publicarlos como artefactos de CI firmados. (H-9)

**Mejora continua:**

14. Escribir tests del server antes de tocar cualquier otra cosa: el RBAC de `/admin`, la escalada de C-5, la proyección de C-4 y el gate de uploads son los cuatro tests que hay que escribir primero, y cada uno prueba que un fix de arriba no se vuelve a romper.
15. Activar `auditLog()` en las mutaciones (login, comandos, cambios de usuarios) con sanitización de `req.body`, y agregar la auditoría a los handlers WebSocket.
16. Unificar `db push` y `migrate deploy` en una sola estrategia y generar la migración inicial completa.
17. Techo en `limit` de paginación; dividir el bundle con `manualChunks`/lazy routes; conectar Redis como adaptador de socket.io si se piensa escalar.
18. Definir la política de privacidad y el aviso al empleado antes de seguir desplegando agentes. (sección 6)

---

## 9. Notas finales de la revisión (pasada 1)

En la pasada 1 el repo no se modificó. Al cierre de esa primera entrega se propuso armar un branch con los fixes bloqueantes (1-4) más los cuatro tests de regresión del punto 14. La respuesta fue **"fixes todo"**, y eso es la sección 10.

---

## 10. Remediación aplicada (pasada 2, 2026-10-21)

Se implementó la práctica totalidad de la sección 8 sobre el working tree de `master`. **No se hizo commit ni push**: el árbol tiene 59 archivos modificados (+2203 / −1232 líneas en los trackeados) y 27 archivos nuevos, sin stagear. Este informe tampoco está commitado.

### 10.1 Cómo se verificó

Ejecutado al cierre, sobre el código ya remediado:

| Comando | Resultado |
|---|---|
| `server: npx tsc --noEmit` | limpio |
| `server: npm run build && npm run build:seed` | OK |
| `server: npx jest` | **10 suites, 103 tests, todos en verde** (antes: 0 tests) |
| `agent: npx tsc --noEmit` | limpio |
| `agent: npx vitest run` | **8 archivos, 80 tests** (antes: 44; tras la sección 11: +17) |
| `client: npm run build` (`tsc -b && vite build`) | OK, un solo chunk de 948.47 kB (gzip 296 kB) |
| `npm audit --omit=dev` en `server`, `client`, `agent` | **0 vulnerabilidades** en los tres (antes: 1 critical + varios high) |

El server ahora se puede probar sin base de datos: se extrajo `createApp()` a `server/src/app.ts` (y `server.ts` quedó solo en el arranque del proceso), y `prisma/seed.ts` pasó a exportar `runSeed()` con un cliente inyectable. `src/app.test.ts` levanta un HTTP server real (`http.createServer(createApp())` en `127.0.0.1:0`) y hace peticiones con `fetch`, así que las pruebas de C-3 y C-5 son aserciones sobre respuestas HTTP reales, no sobre funciones aisladas.

### 10.2 Críticos

**C-1 — seed idempotente + fail-fast de secretos.** `runSeed()` ahora hace `upsert` de los 3 roles y `create` del admin **solo si no existe**; si existe, reconcilia nombre y apellido y **nunca escribe `passwordHash`**. La contrasena inicial sale de `SEED_ADMIN_PASSWORD` (mínimo 12 caracteres) o se genera con `randomBytes` y se imprime **una sola vez** con el marcador `CONTRASEÑA INICIAL DEL SUPERADMIN`. `server/src/config/index.ts` rechaza arrancar en producción si `JWT_SECRET`, `JWT_REFRESH_SECRET` o `AGENT_REGISTRATION_TOKEN` están vacíos o valen alguno de los placeholders históricos del repo (`change-this`, `secret`, etc.); en desarrollo usa secretos efímeros por proceso y avisa por consola. El CMD de la imagen raíz corre `migrate deploy` en lugar de `db push`. Cobertura: `prisma/seed.test.ts` (incluye "la update no trae `passwordHash`" y "`bcrypt.compare("admin123", hash)` da false").

**C-2 — RBAC en el namespace `/admin`.** Nuevo `server/src/websocket/commandPolicy.ts` con allowlist de tipos de comando y `requiredPermissionFor()`. Cada handler (`send-command`, `request-screenshot`, `live-view-frame`, `stop-live-view`) pasa por `requireAdminPermission(socket, Permission.X)`, que evalúa `ROLE_PERMISSIONS` sobre el rol del usuario autenticado y **audita el rechazo** (`WS_send-command_DENIED`) en vez de dejarlo mudo. El OPERATOR queda afuera de apagado, reinicio, bloqueo y live view, igual que en HTTP. Cobertura: `adminAuthorization.test.ts` (socket stub, denegación con mensaje y auditoría) y `commandPolicy.test.ts`.

**C-3 — capturas autenticadas.** Se borró el `express.static("/uploads/screenshots")` que se montaba antes que las rutas de API. El binario solo se sirve por `GET /api/screenshots/:id/image` con `authenticate` + `requirePermission(SCREENSHOTS_VIEW)`, y `screenshot.service.resolveFile` verifica que la ruta resuelta quede **dentro de `SCREENSHOTS_DIR`** (rechaza traversal y subdirectorios fuera de la cota). `filePath` salió del payload de la API y de los tipos del cliente. Del lado nginx se sacaron los dos `location /uploads`. El cliente consume las imágenes con `useAuthorizedScreenshot` (fetch autenticado → `Blob` → `createObjectURL`, con revoke en el cleanup) y la CSP permite `img-src 'self' blob:`. Cobertura: `screenshot.service.test.ts` y el caso "`/uploads/screenshots/captura.png` devuelve 404" en `app.test.ts`.

**C-4 — `registrationToken` no se filtra.** `device.service` proyecta con `DEVICE_PUBLIC_SELECT`, que no incluye el token; `findAll`/`findById` no lo devuelven nunca. El token por dispositivo se entrega **una sola vez**, en la respuesta de `POST /api/devices/register`, que es el único camino legítimo (decisión de diseño documentada: el agente lo persiste en su config local). Cobertura: `device.service.test.ts`.

**C-5 — anti-escalada de roles.** `server/src/security/permissions.ts` agrega `ROLE_RANK`, `canAssignRole()` y `canManageUser()`: un rol solo puede asignar o gestionar roles de rango **estrictamente inferior**, y solo SUPER_ADMIN toca a otro SUPER_ADMIN (incluido su propio usuario, para no autobloquearse). La regla se aplica en las rutas **y** dentro de `user.service` (crear, editar, cambiar rol, resetear contraseña, borrar, desactivar), con bloqueo adicional de auto-desactivación y auto-borrado. `changePassword` revoca los refresh tokens del usuario. Cobertura: `permissions.test.ts` (matriz completa), `user.service.test.ts` y los tuples 403 de `app.test.ts`.

### 10.3 Altos

**H-1 — ACLs del config del agente.** `install-silent.ps1` ya no concede `Users:(OI)(CI)M`. Ahora hace `icacls /inheritance:r` y deja `SYSTEM` + `Administradores` con control total; el `agent.json` se ACL-ea igual. **Trade-off asumido:** en modo logon `Users` queda **solo lectura** (`RX`/`R`), porque el agente debe poder leer el bootstrap como usuario interactivo y romper eso deja de funcionar el despliegue actual; el script emite un `Write-Warning` explícito cuando eso implica que cualquier usuario local puede leer el token. En Session 0 (el camino del `.iss`) `Users` no tiene acceso. La mitigación de fondo —mover el token a Guardado de Credenciales— queda abierta (10.7).

**H-2 — admisión en la named pipe.** Nuevo `agent/src/sessionSecret.ts` (`randomBytes(32)`, comparación con digestos SHA-256 y `timingSafeEqual`, validación de forma y longitud). `sessionProtocol.ts` suma un frame `hello` obligatorio como primer mensaje; `SessionSupervisor` nace con un secreto por arranque, tiene una ventana de 3 s para el `hello`, y **nunca** promueve una conexión que no lo presentó correctamente (la descarta). El worker lo envía apenas conecta. El secreto viaja **solo por el bloque de entorno** del `CreateProcessAsUser` (`start-session.ps1` tiene un `BuildEnvironmentWithSecret` que agrega `RM_SESSION_SECRET` al entorno de la token del usuario), nunca por la línea de comandos, que es legible por cualquier sesión consola. El worker hace **fail-closed**: sin `RM_SESSION_SECRET` se sale con código 1. Cobertura: 5 casos nuevos de `sessionSupervisor.test.ts` (conexión silenciosa, secreto incorrecto, request en lugar de hello, supervisor sin secreto), `sessionSecret.test.ts` y un test de extremo a extremo supervisor↔worker sobre una pipe real.

**H-3 — `trust proxy`.** `app.set("trust proxy", TRUST_PROXY_HOPS || 1)`, configurable porque `express-rate-limit` rechaza `true`. Limiters separados para `/api/auth/login` (10 intentos **fallidos** / 15 min, `skipSuccessfulRequests`) y `/api/auth/refresh` (60), más el general de 300. Sin esto, 10 intentos desde cualquier origen bloqueaban el login global y `req.ip` de la auditoría era `127.0.0.1`.

**H-4 — tokens fuera de `localStorage`.** El refresh token ahora viaja en una cookie `HttpOnly; SameSite=Lax; Secure; Path=/api/auth` (`server/src/lib/cookies.ts`), y el server dejó de mandarlo en el JSON de login/refresh. En el cliente hay un store de acceso en memoria (`client/src/services/tokenStore.ts`) con refresh silencioso en **single-flight** (las recargas concurrentes comparten una sola llamada a `/refresh`) y renovación al cargar la app. Socket.IO pasa el token por el callback `auth`, no por la query string. **Adicional no pedido en la auditoría:** los refresh tokens se persisten **hasheados** (`hashToken`, SHA-256) en `refresh_tokens`, así que un dump de la base deja de exportar sesiones de 7 días; la rotación y el logout buscan por digesto. Consecuencia del deploy: las sesiones abiertas con tokens en claro caen y cada usuario vuelve a loguearse una vez (recomendado `TRUNCATE refresh_tokens;`). Cobertura: `auth.service.test.ts` (4 casos).

**H-5 — dependencias.** `npm audit --omit=dev` = 0 avisos en los tres paquetes (server, client, agente). Se sacó `uuid` + `@types/uuid` del server (estaba declarado y no se usaba) y también del agente, cuyo `v4()` pasó a `crypto.randomUUID`. Se subió `react-router-dom` a `^7` en el cliente verificando que `tsc -b && vite build` siguiera pasando, y se actualizaron las cadenas de lock correspondientes. No se forzó ningún major que rompiera runtime.

**H-6 — cotas y ownership en el canal.** `maxHttpBufferSize` configurable (`WS_MAX_BUFFER_BYTES`, default 16 MB) porque el default de 1 MB truncaba los frames JPEG del live view; `MAX_SCREENSHOT_BYTES` (12 MB) como cota dura por frame subido, medida sobre el base64 y sobre el buffer ya decodificado. `command-result` valida que el `commandId` reportado **pertenezca a ese `deviceId`**; si no, loguea y audita `ownership mismatch` en lugar de escribir el resultado. La imagen se detecta por **magic bytes** (`server/src/lib/image.ts`), no por la extensión ni el MIME declarado.

**H-7 / H-8 — credenciales.** Comparaciones en tiempo constante con digestos (`safeCompare` en el token de onboarding y en el token por dispositivo), longitud mínima de 16 caracteres para `AGENT_REGISTRATION_TOKEN`, y `generateToken()` hecho con `randomBytes` en lugar de `Math.random()`.

**H-9 — binarios commitados.** **No se hizo.** Ver 10.7, punto 1: es el único hallazgo alto que queda abierto y tiene un efecto práctico inmediato.

### 10.4 Medios

Activados y probados: auditoría con `sanitizeForAudit` (lista negra de claves: `password`, `token`, `registrationtoken`, `imagebase64`, etc.; truncado de strings largos y de arrays; un único punto de escritura `writeAuditLog()` usado por HTTP **y** por los handlers WebSocket); techo de paginación (`MAX_PAGE_SIZE = 100` en `middleware/pagination.ts`); una sola estrategia de esquema (migración inicial completa `20260810000000_init`, `migrate deploy`, con el comando de baseline documentado para bases que venían de `db push`); CSP, `X-Frame-Options DENY`, `Referrer-Policy no-referrer` y `Permissions-Policy` en ambos `nginx.conf`; ventana de offline configurable a 3 latidos (`DEVICE_OFFLINE_AFTER_MS`, 180 s) contra heartbeat de 30 s; `server/.dockerignore`.

Del lado cliente: permisos centralizados en `client/src/lib/permissions.ts` y usados para filtrar el menú y las páginas, de forma que el gate de UI coincida con el del server (antes un OPERATOR veía botones que el server ya no le deja usar por HTTP, pero el WebSocket sí).

Del lado despliegue: `docker-compose.yml` y `docker-compose.dokploy.yml` usan `${VAR:?motivo}` para los secretos obligatorios (así el `up` falla antes que arrancar un server inseguro), documentan que `POSTGRES_PASSWORD` tiene que ser alfanumérica para no romper la connection string, agregan `SEED_ADMIN_PASSWORD` y `COOKIE_SECURE`, y eliminan el `version:` obsoleto. Los dos `Dockerfile` quedaron coherentes con `migrate deploy`; ojo con que el `server/Dockerfile` (imagen solo-API, que no usa el despliegue actual de Dokploy) **no** corre el seed en su CMD, mientras que la imagen combinada de la raíz sí.

**Trade-offs documentados, no "olvidados":** (a) `SameSite=Lax` con `Path=/api/auth` en vez de `Strict`, porque la SPA y la API comparten origen bajo Dokploy y `Strict` corta el primer `refresh` después de un link externo; (b) la CSP vive en nginx y no en helmet, porque helmet la emitiría también desde el origen `:3000` del API duplicando headers; (c) el token por dispositivo se devuelve una sola vez en `/register`, así que reemplazar un agente implica volver a registrar; (d) el modo logon mantiene lectura de `Users` sobre el config (ver H-1).

### 10.5 Suite de tests nueva

Server, 10 suites / 103 tests: `security/permissions.test.ts` (matriz de rangos), `websocket/commandPolicy.test.ts`, `websocket/adminAuthorization.test.ts`, `services/device.service.test.ts`, `services/screenshot.service.test.ts`, `services/user.service.test.ts`, `services/auth.service.test.ts`, `security/security.test.ts` (`safeCompare`, `generateToken`, `hashPassword`, `parsePagination`, `detectImage`), `app.test.ts` (HTTP real: 404 en `/uploads`, ausencia de `x-powered-by`, 401 sin token en las 6 rutas, 401 con JWT forjado, 403 por RBAC en las mutaciones de OPERATOR y ADMIN), `prisma/seed.test.ts`. Config: `jest.config.js` + `tsconfig.test.json` (los tests quedan fuera del `tsconfig.json` de build).

Agente, 8 archivos / 80 tests: `sessionSecret.test.ts` (nuevo), `sessionWorker.test.ts` (nuevo), `sessionProtocol.test.ts` (+hello), `sessionSupervisor.test.ts` (reescrito con el flujo de admisión), `agentStatus.test.ts` (nuevo, 12 casos, ver 11.3) y los cuatro preexistentes.

### 10.6 Documentación y despliegue

`README.md` reescrito en las partes que mentían: el diagrama y el CMD ya no dicen `db push`, la tabla de variables quedó completa, Paso 6 explica de dónde sale la contraseña del SUPER_ADMIN, la sección Seguridad describe los controles reales (cookie HttpOnly, RBAC en WS, pipe con admisión, ACLs), el troubleshooting pierde la fila "el seed resetea admin123" y gana las del fail-fast y las capturas autenticadas. `server/.env.example` y `dokploy.env.example` reescritos con los obligatorios, `COOKIE_*`, `TRUST_PROXY_HOPS`, cotas y `SEED_ADMIN_PASSWORD`. Se agregó `npm run seed` al server para poder bootstrapear en local.

### 10.7 Lo que queda abierto (con su severidad real)

1. **Los `.exe` commitados siguen siendo una cadena de suministro inauditable (H-9), pero ya no están obsoletos.** Con la sección 11 se regeneraron `agent/agent-live.exe`, `agent/tray/RmTray.exe` y `RemoteMonitoringAgentSetup.exe` contra el código actual, así que H-1/H-2 sí están aplicados en el binario que se instala. Lo que sigue abierto es la forma: un repo público sin CI no permite verificar que el `.exe` salga de este fuente. La recomendación sigue siendo publicarlos como artefactos firmados de CI y sacarlos del repo.
2. **Legal / gobernanza (sección 6): parcialmente cerrado por la sección 11.** El aviso visible existe (icono de bandeja con estado + pantalla de aviso en el instalador) y el texto *"El agente se ejecutara oculto al arrancar Windows"* ya no está en el `.iss`. Sigue sin resolverse lo que no es código: el aviso de privacidad formal de la Ley 25.326 (responsable del dato, finalidad, registro AAIP) y la política interna. Eso sigue siendo decisión del dueño del producto.
3. **`RemoteMonitoringAgent.iss` sigue pasando `-RegistrationToken` por la línea de comandos de PowerShell** (línea 140), legible por cualquier usuario local mientras dura la instalación. (El `install-silent.ps1` ya acepta `RM_SERVER_URL` / `RM_REGISTRATION_TOKEN` por entorno, así que el arreglo natural es que el `.iss` levante por ahí o escriba un archivo temporal ACL-eado en lugar de armar la línea de comandos.)
4. **Dominio hardcodeado como default en `RemoteMonitoringAgent.iss:86`** (`https://monitor.recuperocrediticio.com`): un fork del instalador Inno Setup sigue mandando escritorios al servidor de un tercero si el operador no cambia ese campo. En `install.ps1` es solo texto de ejemplo del prompt, y `install-silent.ps1` exige el parámetro, así que el único default real vive en el `.iss`.
5. **Redis no está cableado como adaptador de socket.io.** Hoy el estado de sockets vive en memoria: **una sola réplica**. Con dos réplicas, un agente conectado a A no recibe el comando emitido desde B. Queda documentado en el README y en `.env.example`; hace falta `@socket.io/redis-adapter` si se piensa escalar.
6. **HSTS no lo emite este nginx** (se agregó CSP y los demás headers, pero `Strict-Transport-Security` corresponde a la capa TLS que termina Dokploy/Traefik). Verificarlo desde el navegador en producción.
7. **Bundle sin dividir**: un único chunk de 948 kB (296 kB gzip). No hay `manualChunks` ni lazy loading de rutas; sigue siendo el mejor punto de partida para performance y para reducir el impacto de un tercero inyectado.
8. **CORS con un único `origin` string** tomado de la envVar, sin validación de protocolo/hostname. Un typo en `CORS_ORIGIN` (o un `*` puesto a mano) vuelve a abrir la puerta.
9. **Rate limiting y `trust proxy` no tienen test de regresión.** `app.test.ts` cubre headers, gates 401/403 y 404 de `/uploads`, pero no ejercita ventanas de 429 ni el cálculo de `req.ip`; es el hueco de cobertura más grande que dejé.
10. **Reuso de refresh token no está detectado** (rotación sí; "si aparece un token ya usado, revoco toda la familia" no). Con el digesto en base el riesgo baja, pero la detección activa de robo de sesión sigue sin implementarse.

### 10.8 Checklist antes de redeployar

1. Rotar los tres secretos (`openssl rand -hex 32`) y ponerlos en Dokploy; verificar que el contenedor **arranque** (si no arranca, es el fail-fast y falta una variable).
2. Definir `SEED_ADMIN_PASSWORD` (12+ caracteres) o leer la generada del log del primer arranque; si la base ya tenía `admin123`, rotarla desde el panel.
3. `TRUNCATE refresh_tokens;` y avisar que todos los usuarios vuelven a loguearse (H-4).
4. Si la base se creó con `db push`, correr el baseline de migraciones que figura en el README.
5. ~~Regenerar `agent-live.exe` y el instalador~~ — **hecho en la sección 11**: `agent-live.exe`, `tray/RmTray.exe` y `RemoteMonitoringAgentSetup.exe` están compilados contra el código actual. Falta **desplegarlos** en los endpoints; hasta que eso no pase, H-1/H-2 siguen abiertos en las máquinas ya instaladas.
6. Al desplegar en modo Session 0, verificar que aparezca la tarea nueva `RemoteMonitoringAgent-Tray` y que el empleado vea el icono (es el aviso, no un adorno).
7. Probar desde el navegador: `/uploads/screenshots/*` debe dar 404, un OPERATOR no debe poder apagar un equipo ni ver el escritorio en vivo, y las miniaturas de capturas deben seguir renderizando (ahora por `blob:`).



---

## 11. Addendum: el agente se ve (bandeja) + instalador regenerado

Este bloque es posterior a la remediación de la sección 10. Nace de un pedido del dueño del
proyecto: que el agente **se ejecute y quede minimizado en la bandeja del sistema**, y que exista
un instalador. Dos decisiones de alcance quedaron explícitas antes de escribir código:

- El menú del icono es **solo informativo, sin salida**. No hay "Salir", ni "Pausar capturas", ni
  "Desconectar". Si el empleado pudiera apagar el monitoreo desde la bandeja, C-2/H-1 volverían a
  abrirse por la ventana: el canal sigue siendo un proceso que corre como SYSTEM y que un usuario
  local no puede matar.
- Los artefactos (binarios + setup) **quedan en el repo**, no en una carpeta de salida.

### 11.1 Arquitectura del aviso

El agente no puede ser su propia bandeja: en el modo desplegado (`-Session 0`) el proceso que sabe
si hay conexión es un supervisor corriendo como SYSTEM en Session 0, y desde ahí **no puede pintar
en la bandeja de un usuario ni escribir en su perfil**. La solución son dos piezas:

1. **`agent/src/agentStatus.ts`** escribe `status.json` en dos destinos (`%ProgramData%` y
   `%LOCALAPPDATA%`), atómico (`*.tmp` + rename) y modo `0600`, proyectando solo una allowlist de
   nueve campos.
2. **Un cuadro nuevo en el protocolo de la pipe** (`kind: "status"`): el supervisor le *empuja* el
   estado al worker, y el worker —que sí corre como el usuario interactivo— lo persiste en su
   perfil. `sessionSupervisor.broadcastStatus()` escribe el mismo frame en todos los workers vivos.

`RmTray.exe` (C# / WinForms `NotifyIcon`, 14,5 KB, compilado con el `csc.exe` de .NET Framework 4 que
viene con Windows) lee el más nuevo de los dos archivos y muestra punto de color + tooltip + menú.
En modo logon además levanta y vigila al agente (rearma con tope de 5 reaperturas por hora); en
Session 0 corre con `--status-only` para no duplicar el agente.

### 11.2 Superficie nueva y por qué no afloja nada

| Riesgo | Control |
|--------|---------|
| Que el archivo de estado filtre una credencial | Allowlist de 9 campos en `agentStatus.ts` **y** saneado al emitir en `sessionProtocol.createStatusHeader`; el `registrationToken` se descarta dos veces. Test dedicado. |
| Que un proceso local inyecte estado falso por la pipe | El cuadro `status` solo se acepta **después** del `hello` con el secreto de arranque (H-2). Un suplante no puede escribir en el perfil de otro usuario: el worker escribe como ese usuario. |
| Que el icono se vuelva un control del empleado | Sin ítem de salida ni de pausa; el watchdog solo *levanta* procesos, nunca los mata. |
| Que la bandeja sea un vector con privilegios | Corre en la sesión del usuario, sin elevación, y solo lee un JSON plano. |

### 11.3 Verificación

- `agent: npx tsc --noEmit` limpio; `npx vitest run` → **8 archivos / 80 tests** (63 + 12 nuevos en
  `agentStatus.test.ts`, 3 en el bloque "status push" de `sessionProtocol.test.ts`, 2 en
  `sessionWorker.test.ts` para el broadcast que termina en disco).
- **Prueba del binario, no solo del fuente:** `RmTray.exe` se lanzó con `LOCALAPPDATA`/`ProgramData`
  apuntados a un sandbox en cuatro escenarios — sin `status.json`, con estado `connected`, con JSON
  corrupto, y una segunda instancia — y en los cuatro quedó vivo (o salió solo, en el caso del mutex)
  sin lanzar excepciones.
- El icono se verificó por reflexión: se cargó el ensamblado compilado, se invocó `DrawnIcon` con los
  cuatro colores y se inspeccionó el resultado (16×16, punto de color sobre pastilla clara para que
  sobreviva a la pérdida de alfa de la bandeja).
- El parser de la bandeja se probó **contra un `status.json` real generado por el código del agente
  compilado** (`dist/agentStatus.js`), no contra un JSON escrito a mano: los siete campos que lee la
  bandeja salieron bien, incluido el `serverUrl` con `https://`.
- `install-silent.ps1` corrido en sandbox (`-SkipTaskRegistration`, `-InstallDir`/`-ConfigDir` a
  temporales): copia `agent.exe` + `RmTray.exe` + `start-session.ps1`, borra el `run-hidden.vbs`
  legado y deja `agent.json` con `SYSTEM:F / Administradores:F / Usuarios:R`.
- `npm run installer` → Inno Setup 6.7.3 compila y produce `RemoteMonitoringAgentSetup.exe`
  (13.065.788 bytes) con `RmTray.exe` como payload.

### 11.4 Lo que NO se verificó

1. **Instalación real sobre una PC.** No se corrió el setup con permisos de administrador ni se
   registraron las tareas del servidor de producción: eso cambia el estado de esta máquina y
   corresponde a una decisión del dueño. La lógica de registro de tareas está leída y parseada
   (PowerShell `Parser::ParseFile` sin errores), no ejecutada.
2. **Circuito completo agente → server → bandeja.** Requiere un server arriba con un equipo
   registrado; el despliegue de Dokploy quedó explícitamente fuera de alcance en este pedido.
3. **Riesgo residual aceptado y conocido:** un empleado puede matar `RmTray.exe` desde el
   Administrador de tareas y **ocultar el aviso** hasta el próximo logon. El monitoreo sigue
   corriendo igual (es el punto de H-1/H-2), pero el icono deja de estar. La única defensa extra
   sería una tarea con `RestartOnFailure` o un segundo watchdog; se dejó afuera a propósito porque
   agrega superficie sin cerrar el caso (el usuario puede deshabilitar la tarea si es admin local).
4. **El aviso de la Ley 25.326 sigue siendo un template.** El `.iss` ahora muestra una pantalla de
   aviso con qué se instala y cómo se quita, pero el texto de "responsable del dato" y la política de
   privacidad la tiene que completar el empleador antes de desplegar.

---

## 12. Hallazgo de despliegue (2026-10-21): nginx no arrancaba y el dominio daba 502

**D-1 (despliegue, introducido por la remediación).** El commit `feef1fb` agregó hardening a las dos
configuraciones de nginx y con él una directiva que no existe: `proxy_set_buffering off;` en el
`location /socket.io` de `nginx.conf` y de `client/nginx.conf`. La correcta es `proxy_buffering off;`.
Nginx la rechaza en el parseo (`[emerg] unknown directive "proxy_set_buffering"`), no levanta, y como
el `CMD` de la imagen combinada es `nginx && migrate deploy && seed && server` (todo con `&&`, con `sh -c`
de PID 1), el fallo de nginx se lleva puesto al API: el contenedor entra en crash-loop y Traefik
responde **502 en todo el dominio, incluido `/`**. Evidencia observada el 2026-10-21 23:09 UTC:
`/api/health`, `/` y `/socket.io/?EIO=4&transport=polling` devolvían 502 con `Alt-Svc: h3` (proxy, sin
backend sano), mientras el build de imagen había terminado ✅.

**Segundo defecto en la misma familia (no llegó a manifestarse).** `client/nginx.conf` declaraba el
bloque `map $http_upgrade $connection_upgrade` **dentro** de `server`. `map` solo es válida en contexto
`http`; ese archivo se incluye desde `conf.d/` (que ya está dentro de `http`), así que en el despliegue
con `docker-compose.dokploy.yml` nginx habría fallado con `"map" directive is not allowed here`. En la
imagen combinada no ocurría porque ahí el `map` está correctamente en `http`.

**Arreglo.** `proxy_buffering off;` en ambas configs y `map` movido al nivel de archivo en
`client/nginx.conf`. Además los dos `Dockerfile` (raíz y `client/`) ahora corren **`RUN nginx -t`**
después de copiar la config: una directiva inválida o fuera de contexto tiene que romper el build, no
producción. Ese fue el agujero real del hallazgo — no había ninguna validación de la config de nginx
en el pipeline, y `tsc`/jest no la cubren.

**Verificación.** `grep -rn proxy_set_buffering` sin resultados sobre directivas (queda solo en un
comentario), balance de llaves y anidación revisados a mano en ambos archivos. **`nginx -t` no se pudo
correr localmente** (no hay nginx ni Docker en esta máquina); queda como verificación pendiente en el
proximo build de Dokploy, donde ahora forma parte del build.

---

## 13. Mejora de la vista en vivo (2026-10-21): de un JPEG por round-trip a una corriente

**No era un hallazgo de seguridad, era un problema de arquitectura.** La vista en vivo pedía un frame
completo por round-trip (`setInterval` del panel → `live-view-frame` → `live-command` → captura →
`live-frame-result` → sala). Con 2000 ms por cuadro y un flag `isCapturing` que descartaba en silencio
los pedidos solapados, la imagen se veía a saltos. Los cambios, en orden de impacto:

1. **Push desde el agente** (`live-start` / `live-stop`, capability `liveProtocol: "2"` en el handshake).
   El agente programa el cuadro siguiente cuando termina el anterior; desaparece el round-trip por frame
   y el descarte por solapamiento. Los agentes ya desplegados siguen en modo `poll` (un `live-command`
   por cuadro) porque el server decide el modo por conexión.
2. **Contador de espectadores en el server** (`server/src/websocket/liveSessions.ts`). Varios paneles del
   mismo PC comparten una sola corriente al ritmo más rápido; el último en irse apaga la captura; los
   frames se descartan si la sala `live:<deviceId>` no tiene espectadores (antes el filtro era
   `adminNamespace.sockets.size`, global). El auditoría `WS_LIVE_VIEW_START` ahora se escribe una vez por
   corriente, no una vez cada 2 s por panel.
3. **Worker de captura persistente** (`agent/src/liveCaptureWorker.ts`). Un solo `powershell.exe` mientras
   hay espectadores, alimentado por stdin y con cuadros binarios por stdout.
4. **Retuning de ping de socket.io** (`25000`/`20000` default). Con `pingTimeout 5000` un pong atrasado
   por el uplink saturado cerraba la conexión y el equipo parpadeaba OFFLINE en el panel.

**Medición (estación real, dos monitores, pantalla virtual 3360x1080, cuadro escalado a 1280 px / q70).**

| Ruta | ms por cuadro | KB por cuadro |
|------|---------------|---------------|
| `powershell.exe` por cuadro (el diseño anterior) | ~1400 | 55 |
| `screenshot-desktop` + re-encode JS (`jpeg-js`) | ~720 | 124 |
| Worker persistente | **~150** | **66** |
| `screenshot-desktop` sin escalar | ~300 | 356 |

El número que importa no es el costo de GDI+ contra JavaScript: es pagar el arranque de PowerShell y del
runtime .NET una vez por corriente en lugar de una vez por cuadro. End-to-end con el binario empaquetado:
a 1 s por cuadro, 6 cuadros en 6 s; al piso de 0,25 s, **23 cuadros en 6 s (~3,8 fps, gap medio 259 ms)**;
después de `live-stop`, 0 cuadros; y quedó **1 solo proceso `powershell.exe`** (el de la propia medición),
es decir, no huérfanos con la captura activa.

**Lado de seguridad y privacidad.** El script del worker es una **constante de texto sin interpolación**:
no recibe ni el config ni payloads del server como código, solo dos enteros ya validados por
`clampInt`/`clampLiveInterval` (`s <ancho> <calidad>` por stdin). No contiene credenciales ni escribe
fuera de su carpeta temporal. El riesgo nuevo concreto era el **proceso huérfano**: un `powershell.exe`
que siga capturando el escritorio después de que el administrador cerró el panel sería un problema de
privacidad, así que el worker se cierra por `live-stop`, por caída del WebSocket, en `SIGINT`/`SIGTERM`,
en el handler `process.on("exit")` (Windows no mata al hijo en un `process.exit()` directo) y por timeout
de inactividad de 70 s como red de seguridad; el worker de sesión lo cierra en su propio `stop()`. Se
agregó `windowsHide: true` para que no aparezca una consola en el escritorio del usuario monitoreado.
El framing binario se corta antes de difundir cualquier cosa que no sea un JPEG de tamaño plausible, así
que un stdout contaminado no llega a las salas.

**Lo que NO cierra este cambio.** Sigue siendo un JPEG completo por cuadro: no hay transferencia por
regiones sucias ni codificación H.264, que es lo que lleva a Radmin a 20+ fps. El techo honesto con esta
arquitectura es ~6 fps y ~250 KB/s de uplink al ritmo mínimo; para más hace falta un codec de video y un
plan de migración del protocolo. Tampoco se verificó contra el server de producción (sección 12: el
dominio seguía en 502), ni con un `agent-live.exe` del build anterior en modo `poll` real —la
compatibilidad `poll` se probó emitiendo `live-command` a un agente nuevo—, ni el renderizado en el
navegador.

**Verificación.** Agente: `tsc --noEmit` limpio y **123 tests** de vitest (incluye el parser de frames y
el ciclo de vida del worker con un hijo falso). Server: `tsc` limpio y **127 tests** de jest (el scheduler
con timers falsos). Cliente: `tsc` + `vite build` OK. `npm audit --omit=dev` en el agente: 0 avisos con
`jpeg-js` agregado. Harness end-to-end con el exe empaquetado contra un server socket.io falso en
`127.0.0.1`, con `ProgramData`/`APPDATA`/`LOCALAPPDATA` apuntando a una carpeta temporal para no tocar la
instalación real de este equipo (los números de la tabla de arriba salen de ahí).
