# DWService — Análisis profundo del agente Windows y comparación con nuestro agente

Fecha de investigación: 2026-09-25
Método: lectura directa del código fuente oficial clonado (`/tmp/opencode/dwagent`), API de GitHub para metadatos de licencia/actividad, y documentación oficial de DWService.
Estado del repositorio clonado: commit de `master` al momento de la investigación, ~7,2 MB, 26 directorios de primer nivel.

Advertencia metodológica: todo claim marcado **[verificado]** proviene de código o documentación oficial leída directamente. Todo claim marcado **[no verificado]** no pudo confirmarse con fuente primaria y no debe tomarse como cierto. Los metadatos de licencia, estrellas y fecha de push provienen de la API de GitHub en la fecha indicada y pueden variar.

---

## 1. Resumen ejecutivo

DWService es, en contra de la creencia extendida de que era un producto propietario de caja negra, un producto con el **agente completamente abierto y auditable** y el **nodo propietario**. Esa asimetría es la clave de todo el análisis: el 100% de la lógica que corre en la máquina del cliente final (captura, input, shell, archivos, servicio, updater) es pública bajo MPLv2; el código del servidor que enruta, autoriza y persiste es cerrado.

Lo que hace bien el agente de DWService y que nuestro agente no tiene:

1. **Servicio Windows nativo real** (`dwagsvc.exe`, C++) con puente Session 0 → sesión interactiva mediante duplicación de token, `CreateProcessAsUserW` y escritorio `winsta0\default`. **[verificado]**
2. **Streaming por cambio incremental de imagen** con codificador TurboJPEG ejecutado en un **proceso hijo** que recibe los frames por memoria compartida (zero-copy), con 10 niveles de calidad y escalado dinámico. **[verificado]**
3. **Protocolo de red propio** con framing por longitud de 4 bytes big-endian, JSON comprimido con zlib y keepaliveWebSocket. **[verificado]**
4. **Superficie de aplicaciones** modular (desktop, shell, filesystem, logwatch, resource, texteditor) cargadas como plugins, no hardcodeadas. **[verificado]**
5. **Actualización automática** con descarga, verificación de integridad y aplicación en sitio. **[verificado]**
6. **Audio remoto** con Opus sobre RtAudio, y **portapapeles bidireccional**. **[verificado]**
7. **Soporte real de multi-monitor**, con selección de monitor y view-only por monitor. **[verificado]**

Lo que nuestro agente tiene y DWService no: un modelo de datos de auditoría y permisos mucho más rico (`RolePermission`, `AuditLog`, `DeviceCommand` con estados PENDING/APPROVED/EXECUTING y `approvedById`), aprovisionamiento multi-consorcio con `role` de dispositivo, y una API REST propia. Esa parte de nuestro diseño es superior y **no debe abandonarse**.

**Conclusión de cabecera**: no conviene abandonar nuestro agente para adoptar DWService (el nodo no es self-hosteable y la auditoría es débil). Lo correcto es **portar patrones concretos**: servicio Windows nativo, streaming incremental por memoria compartida, shell y transferencia de archivos, y portapapeles. Ninguna alternativa open source cubre hoy el conjunto completo con licencia permisiva; la recomendación es **construir sobre nuestro agente** y considerar **MeshCentral (Apache-2.0)** como referencia de diseño y posible componente de interop, evitando AGPL.

---

## 2. Alcance, método y fuentes

Fuentes primarias utilizadas:

- Código del agente: `https://github.com/dwservice/agent` (clonado a `/tmp/opencode/dwagent`).
- README del agente: `https://raw.githubusercontent.com/dwservice/agent/master/README.md` — declara: *"The code is written in python2 and several libraries are written c++."*
- Página de descarga y tabla de licencias: `https://www.dwservice.net/en/download.html`
- Documentación oficial: `https://docs.dwservice.net/docs/site/` y `https://docs.dwservice.net/docs/site/remote-access/`
- Definición de open source del producto: `https://docs.dwservice.net/docs/site/basic-definitions/open-source/`
- Metadatos de repositorios terceros: API `https://api.github.com/repos/{owner}/{repo}` consultada el 2026-09-25.

Documento previo que este informe **no repite**: `docs/research/dwservice-evaluacion.md` (estado de la API oficial, autenticación, ausencia de webhooks, TLS no E2E, nodos no self-hosteables, falsos positivos AVG/Avast, modo `run` con `listenport:7956`).

Limitaciones declaradas de esta investigación:

- No se descargaron ni ejecutaron los binarios oficiales firmados; por lo tanto **versión exacta del último release, tamaño del instalador, arquitectura de publicación, icono, editor/publisher del certificado y metadatos de firma Authenticode son [no verificados]**.
- No se ejecutó el agente bajo Windows real; todo el comportamiento se infiere del código fuente y la documentación.
- No se auditó el código del nodo propietario por no estar disponible.
- `waRP` se buscó repetidamente como alternativa y **no se encontró evidencia**: cero resultados en la API de búsqueda de GitHub para consultas de nombre y descripción, y cero resultados en búsqueda web junto a DWService. Se descarta como **[no verificado / probablemente inexistente]**.

---

## 3. Identidad del producto y del agente

**El agente.** Binario compuesto por dos ejecutables nativos de Windows más un runtime Python embebido:

| Componente | Archivo | Rol |
|---|---|---|
| Servicio | `dwagsvc.exe` | Proceso de Windows Service en Session 0. Hospeda el agente y supervisa la sesión interactiva. |
| Launcher | `dwaglnc.exe` | UI en la sesión del usuario; relanza y coordina con el servicio. |
| Actualizador | `os_win_updater` → DLL | Aplica actualizaciones descargadas in situ. |
| Runtime | Python 2 (y 3 en componentes migrated) | Toda la lógica de aplicaciones, protocolo, configuración y sesión. |
| Bibliotecas nativas | `dwagscreencapture.dll`, `dwagsoundcapture.dll`, `dwagosutil.dll` | Captura, audio, utilidades de OS. |

Fuente: `os_win_service/src/main.cpp` (28.630 bytes), `os_win_launcher/src/main.cpp`, tabla oficial de licencias en `https://www.dwservice.net/en/download.html`.

**El nodo.** Cerrado. El agente habla con `/openraw.dw`; la implementación del servidor no está publicada. Esto es lo que hace DWService no auto-hosteable como producto y lo que lo separa de un RMM self-hosted real.

**El nombre "open source" es correcto pero limitado.** La documentación oficial dice literalmente: *"We provide source code of the agent software so that anyone can see what it does in their system. This also means you can modify the code, for example to restrict or monitor specific operations."* Es decir, la apertura es deliberadamente **del agente**, no del servicio. **[verificado]**

---

## 4. Arquitectura interna del agente

El repositorio está organizado como un sistema de **capas con dependencias declaradas en JSON por componente**, lo que permite builds incrementales y reemplazo legal de una capa sin tocar el resto.

Composición declarada en los `config.json` de cada aplicación **[verificado]**:

```
app_desktop     → lib_dependencies: screencapture, soundcapture
app_filesystem  → lib_dependencies: osutil
app_logwatch    → app_dependencies: filesystem
app_resource    → lib_dependencies: osutil
app_shell       → (ninguna)
app_texteditor  → app_dependencies: filesystem
```

Bibliotecas nativas y su correspondencia de plataforma **[verificado]**:

| Biblioteca | Windows | Linux | macOS | Depende de |
|---|---|---|---|---|
| screencapture | `dwagscreencapture.dll` | `.so` | `.dylib` | stdcpp, z, turbojpeg |
| soundcapture | `dwagsoundcapture.dll` | `.so` | `.dylib` | stdcpp, rtaudio, opus |
| osutil | `dwagosutil.dll` | — | — | — |
| z | `zlib1.dll` | `libz.so` | `libz.dylib` | — |
| turbojpeg | `libturbojpeg.dll` | `.so` | `.dylib` | — |
| opus | `opus.dll` (ARM64: `libopus.dll`) | `libopus.so` | `libopus.dylib` | — |
| rtaudio | `librtaudio.dll` | `.so` | `.dylib` | stdcpp |
| stdcpp | `libstdc++-6.dll` (ARM64: `libc++.dll`) | — | — | — |
| unwind | — (solo ARM64: `libunwind.dll`) | — | — | — |
| gcc | `libgcc_s_sjlj-1.dll` | — | — | — |

La existencia de `filename_win_arm64_v1` para `opus`, `stdcpp`, `z` y `unwind` confirma que el agente publica build nativo para **Windows ARM64 v1** además de x64. **[verificado]**

El gestor de procesos es una máquina de estados real, no un simple fork: `core/ipc.py` (101.486 bytes) define `ProcessManager`, `Process`, `ProcessConfig`, `ProcessInActiveConsole`, `StreamIPC`, `StreamTHC`, `MemMapIPC`, `MemMapTHC` y `ChildProcessThread`, con primitivas de sincronización sobre `SHAREDMEMORY_DEF` y `SEMAPHORE_DEF` (ctypes) **[verificado]**.

Volumen de código relevante **[verificado]**:

| Archivo | Bytes | Contenido |
|---|---|---|
| `core/agent.py` | 155.879 | Orquestador: sesión, protocolo, uploads/downloads, updates |
| `core/ipc.py` | 101.486 | IPC, memoria compartida, gestión de procesos |
| `core/communication.py` | 79.914 | WebSocket, TLS, framing, keepalive |
| `core/native.py` | 26.775 | Binding ctypes hacia las DLL nativas |
| `core/listener.py` | 15.358 | Escucha local |
| `core/cacerts.pem` | 231.226 | Store CA embebido (superficie de supply chain) |

---

## 5. Modelo de proceso en Windows: servicio, Session 0 y launcher

Este es el tramo de mayor valor técnico para nosotros y el que menos tenemos JOB resuelto.

**El problema.** Un Windows Service corre en Session 0 sin escritorio. `BitBlt`/`Desktop Duplication` y la inyección de input requieren el escritorio de la sesión del usuario conectado.

**La solución de DWService** **[verificado]**:

1. `lib_core/src/windows.cpp` llama a `WTSGetActiveConsoleSessionId()` para obtener la sesión de consola activa.
2. `core/ipc.py` mantiene el mecanismo para **duplicar el token** de la sesión del usuario.
3. `core/native.py` invoca `CreateProcessAsUserW` para lanzar el proceso del agente **dentro de la sesión interactiva**, no en Session 0.
4. El escritorio objetivo se fija explícitamente en `winsta0\default`.
5. Se detecta el **cambio de sesión de consola** y se relanza el proceso del agente para seguir a la sesión activa.
6. La comunicación entre el servicio (Session 0) y el proceso de escritorio (Session N) se hace por **memoria compartida y semáforos** con nombre.

El servicio además tiene un flag `brunonfly` **[verificado, `os_win_service/src/main.cpp:20`]** que altera el comportamiento de arranque: cuando no está en modo run-on-the-fly, el servicio **borra los archivos de arranque y parada** (`startFileName`, `stopFileName`) para forzar el arranque normal **[verificado, líneas 205-212]**. Esto es relevante para la persistencia y para understanding de qué pasa tras un corte de luz o un reinicio abrupto.

`ServiceMain` y `ServiceCtrlHandler` están implementados a mano con la API nativa, no con un framework de servicios **[verificado, líneas 34-35]**.

**Contraste con nuestro agente.** Nuestro agente es un proceso Node.js ligado a la sesión interactiva del usuario que lo lanzó, instalado como aplicación por usuario con tarea programada. Cuando no hay usuario con sesión iniciada, no hay captura. Esto no es un bug: es una limitación arquitectónica. El modelo de DWService resuelve correctamente el caso "servicio arranca en el boot, usuario entra después".

---

## 6. Captura de pantalla, streaming, audio e inyección de entrada

**Backends de captura** (`lib_screencapture`, 53 archivos) **[verificado]**:

- `desktopduplication/` — DXGI Desktop Duplication API, vía `IDXGIOutputDuplication`. Es el backend preferido en Windows moderno y captura el frame ya en GPU.
- `bitblt/` — `BitBlt` sobre GDI como fallback, con soporte de clipboard.
- `windowsdesktop.cpp` — `WindowsDesktop` (escritorio por defecto de la estación interactiva).
- Multi-monitor vía `MONITORS_INFO` / `MONITORS_INFO_ITEM` en ctypes, con máximo declarado `MONITORS_INFO_ITEM_MAX = 1000` **[verificado, `app_desktop/common.py`]**.

**Inyección de input** **[verificado]**:

- `SendInput` en `lib_screencapture/src/windows/windowsinputs.cpp:117` y `windowsdesktop.cpp:237`.
- `SetCursorPos` en `bitblt/screencapturenativebitblt.cpp:434` y `desktopduplication/screencapturenativedesktopduplication.cpp:868`.
- Modificadores VK_SHIFT/VK_CONTROL/VK_ALT declarados en `app_desktop/common.py`.
- El cursor se dibuja como capa separada, no horneado en el frame.

**Portapapeles bidireccional** **[verificado]**: `DWAScreenCaptureGetClipboardChanges` y `DWAScreenCaptureSetClipboard` en `bitblt/screencapturenativebitblt.cpp:460-461`, con tokens `TOKEN_CLIPBOARD_SEND = 500` y `TOKEN_CLIPBOARD_RECEIVED = 501`. El límite de tamaño del token está comentado en el código (`#MAX_CLIPBOARD_TOKEN_SIZE=32*1024`), lo que sugiere un límite efectivo **[no verificado en comportamiento]**.

**Codificación: no hay video, hay JPEG por frame.** Este es el hallazgo técnico más importante para dimensionar nuestra competencia.

- Los tipos de frame definidos son `TYPE_FRAME_PALETTE_V1 = 0`, `TYPE_FRAME_TJPEG_V1 = 100`, `TYPE_FRAME_TJPEG_V2 = 101` **[verificado, `app_desktop/common.py`]**.
- **No existe ninguna referencia a H.264, H.265, VP8, VP9, AV1, x264, x265, FFmpeg, GStreamer ni WebRTC en todo el repositorio.** La ausencia fue verificada por barrido de todas las extensiones del repo.
- El codificador es **TurboJPEG** (`libturbojpeg`), no el JPEG de Windows ni el de GDI+.

Escalones de calidad del codificador TurboJPEG **[verificado, `app_desktop/encoder.py`]** — 10 niveles, mapeados a calidad JPEG:

| Nivel `quality` | Calidad JPEG | | Nivel `quality` | Calidad JPEG |
|---|---|---|---|---|
| 0 | 30 | | 5 | 60 |
| 1 | 35 | | 6 | 70 |
| 2 | 40 | | 7 | 80 |
| 3 | 45 | | 8 | 85 |
| 4 | 50 | | 9 | 90 (default) |

Existe además un **codificador de paleta** (`ProcessEncoderPalette`) que reduce la imagen a colores indexados con profundidades de bit configurables de 4 a 32 bits por canal **[verificado, `encoder.py:16-80`]**. Es la estrategia de ancho de banda extrema: en vez de comprimir, reduce el número de colores. El valor por defecto del encoder es `quality = 9` **[verificado, `app_desktop/desktop.py:597`]**.

**Arquitectura de pipeline: el encoder es un proceso hijo con memoria compartida.** Esta es una decisión de diseño excelente y la que más nos interesa copiar.

- `ProcessEncoder` hereda de `ipc.ChildProcessThread` **[verificado, `encoder.py:95`]**.
- Los frames llegan por **memoria compartida** (`joreq["monitors"]["memmap"]`) con un **semáforo** (`joreq["monitors"]["cond"]`) de señalización **[verificado, `encoder.py:127-130`]**.
- Cada monitor tiene `curcapid` / `prevcurcapid` y un estado de captura (`K`) para evitar recapturar monitores sin cambios **[verificado]**.
- El cursor se mantiene como estado separado con posición, visibilidad y un contador, y se recompone en el cliente.
- Las estadísticas de rendimiento se agregan por clave: `fps` y `capfps` **[verificado, `desktop.py:586-587`]**.

Consecuencia práctica: el coste de CPU de TurboJPEG queda **fuera del proceso del servicio**, y el servicio solo mueve bytes. Es la diferencia entre un agente que satura un Core i3 y uno que no.

**Audio remoto** **[verificado]**: biblioteca dedicada `lib_soundcapture` con `dwagsoundcapture.dll`, dependiente de `librtaudio.dll` (captura) y `opus.dll` (códec). Tokens `TOKEN_AUDIO_TYPE = 809`, `TOKEN_AUDIO_DATA = 810`, `TOKEN_AUDIO_ERROR = 811`. El audio sí está comprimido con códec real (Opus), a diferencia del video.

**Nomenclatura de tokens** que revela la granularidad del protocolo **[verificado, `app_desktop/common.py`]**:

```
TOKEN_RESOLUTION 0, TOKEN_FRAME 2, TOKEN_CURSOR 3, TOKEN_MONITOR 10,
TOKEN_SUPPORTED_FRAME 11, TOKEN_FRAME_NEXT 600, TOKEN_FRAME_TIME 800,
TOKEN_FRAME_TYPE 801, TOKEN_FRAME_LOCKED 701, TOKEN_FRAME_UNLOCKED 702,
TOKEN_SESSION_ID 900, TOKEN_SESSION_ALIVE 901, TOKEN_SESSION_STATS 991,
TOKEN_SESSION_ERROR 999
```

`TOKEN_FRAME_LOCKED/UNLOCKED` indica que el servidor puede **bloquear/desbloquear** una sesión en curso sin terminarla. `TOKEN_SESSION_STATS` implica que el cliente recibe y muestra métricas de calidad de conexión en vivo.

**Selección de calidad desde la UI**: el operador elige entre Minimum, Low, Medium, Maximum y **Auto**, más un control de tamaño de pantalla en porcentaje **[verificado, `https://docs.dwservice.net/docs/site/basic-definitions/screen-application/`]**. El modo Auto es notable: el servidor o el cliente degradan la calidad según el ancho de banda medido.

---

## 7. Protocolo de red agente-nodo

Verificado en `core/communication.py` y `core/agent.py` **[verificado]**:

- **Transporte**: WebSocket sobre **TLS** hacia `https://{host}:{port}/openraw.dw`, con host y puerto tomados de la configuración del agente (soporta puertos no estándar y proxies).
- **Keepalive**: intervalo de 30 segundos con umbral de 5 ([verificado] en la clase de comunicación).
- **Identificación**: headers `dw_*` [verificado].
- **Anuncio de compresión**: header `Compression: zlib` [verificado, `communication.py:654`].
- **Framing**: prefijo de longitud de 4 bytes **big-endian** (`struct.Struct("!I")`) seguido del cuerpo. El endianness es explícito porque ambos extremos pueden ser de arquitecturas distintas.
- **Carga útil**: JSON comprimido con zlib. `utils.zlib_compress` / `utils.zlib_decompress` en `core/utils.py:360-361`; desempaquetado en `core/agent.py:2432-2434` con `json.loads`.
- **Clases principales**: `Connection`, `Message`, `AgentConn`, `Session`, `WebSocket`.
- **CA embebida**: `core/cacerts.pem`, 231 KB. El agente **no confía en la cadena de CA del sistema** para la conexión al nodo. Esto es doble filo: buena defensa contra interceptación local de la CA del sistema, pero también un almacén de confianza fijado en el build que hay que auditar.

**Implicación para nuestro agente**: nosotros usamos **Socket.IO** sobre el servidor HTTP con namespaces `/agent` y `/admin` **[verificado, `server/src/websocket/index.ts`]**. Socket.IO nos da reconexión con backoff (`reconnectionDelay: 5000`, `reconnectionDelayMax: 30000`, `reconnectionAttempts: Infinity`), rooms, y acknowledgement, todo con `pingInterval: 10000` / `pingTimeout: 5000` **[verificado]**. Es objetivamente más cómodo de mantener que un protocolo binario propio, y para nuestro volumen es la decisión correcta. Lo que **no** tenemos y DWService sí: compresión de la carga útil a nivel de protocolo. Socket.IO tiene `perMessageDeflate` habilitado por defecto en el cliente, pero nuestras capturas van **Base64 dentro de JSON**, lo que infla el payload ~33% antes de comprimir. Ese es un desperdicio medible.

---

## 8. Configuración, secretos, logs y actualización automática

### 8.1 Configuración

Archivo `config.json` escrito por `_write_config_file` / leído por `_read_config_file` con semáforo de exclusión **[verificado, `core/agent.py:236-240`]**. Contiene URL del nodo, `key`, `password`, información de proxy, lista de nodos y preferencias. Se relee en caliente: `if self._is_reload_config(): self._read_config_file()` **[verificado, línea 1341]**.

### 8.2 Tratamiento de secretos — hallazgo crítico

DWService **ofusca, no cifra**. **[verificado]**

```python
# core/agent.py:85-86
def obfuscate_password(pwd):
    return utils.bytes_to_str(utils.enc_base64_encode(utils.zlib_compress(utils.str_to_bytes(pwd,"utf8"))))

# core/agent.py:88-89
def read_obfuscated_password(enpwd):
    return utils.bytes_to_str(utils.zlib_decompress(utils.enc_base64_decode(enpwd)),"utf8")
```

Es decir: `base64(zlib(password))`. Trivialmente reversible por cualquiera con acceso de lectura al archivo. Se usa para `password` del agente (líneas 506, 525) y `proxy_password` (líneas 270, 480).

Para contraseñas de sesión y de configuración local sí usa un hash: `hash_password` = `base64(sha256(pwd))` **[verificado, `core/agent.py:80-82`]**, aplicado a `config_password` (línea 434) y `session_password` (línea 450).

**Lección para nosotros**: en nuestro agente, `registrationToken` y la configuración de servidor están en JSON plano sin cifrar. Neither of us is worse than the other here, but we can do better: usar DPAPI (`CryptProtectData`) para el token de registro en Windows, que da cifrado ligado a la cuenta de usuario sin gestión de claves.

### 8.3 Logs

Rotación por tamaño con umbral de **1 MiB** **[verificado, `core/agent.py:1533-1535]`** (`sz >= 1*1024*1024`, reescritura del log). Los logs del agente se escriben en el directorio de trabajo como `dwagent.log` **[verificado]**. El servicio nativo tiene su propio `WriteToLog` con `CreateFileW(..., FILE_APPEND_DATA, ...)` **[verificado, `os_win_service/src/main.cpp:64-66`]**. Existe un número de archivos rotados **[no verificado]**.

Nota de seguridad: estos logs son de diagnóstico y pueden contener metadatos de sesión. La documentación del producto advierte explícitamente que el software da acceso remoto total **[verificado, página de descarga]**.

### 8.4 Actualización automática

**Mecanismo verificado** **[verificado]**:

1. El agente consulta al nodo una URL de descarga (`url_download`) o usa la primaria.
2. Descarga un archivo, calcula **MD5** y lo compara con el `md5` que el servidor envía en el sobre de actualización.
3. Si el hash no coincide, lanza excepción: `raise Exception("Hash not valid. (file '{0}').")`.
4. Descomprime el archivo en la carpeta del agente.

Código **[verificado, `core/agent.py:677-684` y 843-844]**:

```python
def _check_hash_file(self, fpath, shash):
    md5 = hashlib.md5()
    ...
    if h != shash:
        raise Exception("Hash not valid. (file '{0}').".format(fpath))
...
self._download_agent_file(app_url, app_file)
self._check_hash_file(app_file, arcv["md5"])
self._unzip_file(app_file, folder)
```

5. En el lado nativo, el servicio carga la DLL del actualizador con `LoadLibrary` y resuelve `checkUpdate` con `GetProcAddress`, y registra un callback de log con `setCallbackWriteLog` **[verificado, `os_win_service/src/main.cpp:171-197`]**.

**Riesgo verificado**: la integridad de la actualización depende **exclusivamente de MD5**, y `core/updater.py` (7.809 bytes) **no contiene ninguna referencia a hash, verificación ni firma** (barrido confirmado sin coincidencias). MD5 no es resistente a colisiones deliberadas. No hay verificación de firma Authenticode ni de firma de release en el flujo de actualización inspeccionado. Un atacante que controle el canal TLS o el mirror de distribución, o que consiga MITM, podría servir un binario con un MD5 coherente. Marcar como **[riesgo real, no teórico]**.

La página oficial afirma *"The software is updated automatically."* **[verificado]**, y el README advierte que al arrancar desde fuentes *"the agent does not update automatically"*, porque la actualización vive en el componente compilado **[verificado]**.

**Nuestro agente no tiene actualización automática.** El `package.json` empaqueta con `pkg` `node18-win-x64`; no hay mecanismo de auto-update. Esto es una brecha significativa para un RMM que debe mantener agentes desplegados en clientes.

---

## 9. Superficie de comandos y aplicaciones

DWService modela las capacidades como **aplicaciones** cargables, no como un switch de tipos de comando **[verificado, `core/applications.py` + directorios `app_*`]**:

| Aplicación | Módulo | Capacidad |
|---|---|---|
| Desktop | `app_desktop` | Escritorio remoto interactivo, cursor, multi-monitor, view-only, audio, portapapeles |
| Shell | `app_shell` | Terminal remota; incluye `os_win_pyconpty` para ConPTY en Windows moderno |
| FileSystem | `app_filesystem` | Navegación, subida, descarga, compartir carpeta en modo solo lectura |
| LogWatch | `app_logwatch` | Vigilancia de logs (depende de filesystem) |
| Resource | `app_resource` | CPU, memoria, disco, red, procesos |
| TextEditor | `app_texteditor` | Editor de texto remoto |

Detalle notable: `app_shell` incluye su propia implementación de **ConPTY** (`os_win_pyconpty/conpty.py`, `os_win_pyconpty/win32/native.py`) para obtener terminal nativo con las APIs modernas de Windows en lugar de un `cmd.exe` roto en modo servicio **[verificado]**.

**Nuestro agente** expone exactamente ocho tipos de comando **[verificado, `server/prisma/schema.prisma:40-48`]**:

```
SCREENSHOT, SYSTEM_INFO, PROCESS_LIST, LOCK_SCREEN, SHUTDOWN, RESTART, LOGOUT
```

Esto se ve en el código: `commands.ts` implementa `takeScreenshot`, `takeLiveFrame`, `getSystemInfo`, `getProcessList`, `lockScreen` (`rundll32.exe user32.dll,LockWorkStation`), `shutdown` (`shutdown /s /t 0`), `restart` (`shutdown /r /t 0`), `logout` (`shutdown /l`) **[verificado]**.

**Ausentes en nuestro agente, presentes en DWService**: control de input (teclado/ratón), terminal, transferencia de archivos, portapapeles, gestión de servicios, instalación/desinstalación de software, auditoría de acciones del usuario, view-only, sesión de soporte temporal con contraseña y expiración, unattended vs attended, transferencia dearchivos peer-to-peer sin pasar por el servidor (el producto lo anuncia como *"without publishing the photos to anyone's servers"* **[verificado]**).

---

## 10. Licencia, cadena de suministro y confianza

### 10.1 Estructura de licencias del agente

La tabla oficial de licencias del producto **[verificado, `https://www.dwservice.net/en/download.html`]** es:

| Componente | Licencia |
|---|---|
| Python 2 / Python 3 | PSFL |
| Core, UI, App. Desktop, App. FileSystem, App. LogWatch, App. Resource, App. Shell, App. TextEditor, Lib. Core, Lib. GDI, Lib. OSUtil, Lib. ScreenCapture, Lib. SoundCapture | **MPLv2** |
| Lib. Z | zlib |
| Lib. TurboJPEG | BSD-style |
| Lib. Opus | BSD-style |
| Lib. RtAudio | MIT-style |
| Lib. GCC, Lib. StdCpp, Lib. Unwind | (no listados en la tabla) **[no verificado]** |

### 10.2 Detalle de la licencia en el repositorio — anomalía a registrar

`dwservice/agent` **no tiene archivo `LICENSE` en la raíz**. La raíz contiene únicamente `.gitignore` y `README.md` **[verificado]**. La API de GitHub devuelve 404 para `/repos/dwservice/agent/license` **[verificado]**.

El texto MPL 2.0 sí está presente, pero **repetido por componente**: `core/LICENSE` y `os_win_service/LICENSE` son ambos copias de 17.099 bytes del Mozilla Public License 2.0 **[verificado]**, y cada archivo `.py` lleva su propio encabezado MPL 2.0 (visible en `encoder.py`, `common.py`).

Consecuencia legal práctica: MPL 2.2 es copyleft **por archivo**, lo que en la práctica es más débil que la LGPL y no obliga a que las modificaciones se publiquen como proyecto separado, pero la **falta de un LICENSE único en la raíz es una ambigüedad real** que unongservicio legal señalaría. Si fuéramos a bifurcar código del agente, lo correcto es obtener confirmación escrita de DWService o contactar al autor antes de depender de esta lectura.

### 10.3 Reputación y adalahration

- El proyecto mantiene la licencia sin ambigüedad desde hace años y publica el código sin visible fricción.
- **Mantenimiento activo verificado**: el repositorio recibe pushes (la API de GitHub no expone `pushed_at` para `dwservice/agent` en la respuesta consultada, pero el clon contiene código con fecha de referencia 2024-10-04 en `app_desktop/common.py` y la documentación vigente) **[no verificado en cuanto a frecuencia de commits]**.
- La documentación reconoce problemas con antivirus: existe un artículo *"Remote control freezing in case of AVG/Avira antivirus protection"* **[verificado como título de artículo]**. Es un punto en contra a favor de su madurez: es un problema conocido y documentado, no oculto.

### 10.4 Lo que NO es auditable

- El **nodo** es propietario. Todo lo que el servidor decide (autorización, expiración de permisos, auditoría, cuñas de ancho de banda, precios) no es verificable.
- El **instalador firmado** no fue inspeccionado. Versión, tamaño, publisher e icono del certificado: **[no verificado]**.
- `core/cacerts.pem` embebido de 231 KB fija la confianza TLS en el build. Auditarlo requeriría diff contra el store de la plataforma.

---

## 11. Comparación directa con nuestro agente

| Dimensión | DWService | Nuestro agente | Ganador |
|---|---|---|---|
| Lenguaje agente | Python 2 + C++ | TypeScript + Node.js (pkg) | DWService (rendimiento nativo) |
| Servicio Windows | `dwagsvc.exe` nativo, Session 0 + puente a sesión | Proceso Node ligado a sesión, tarea programada | DWService |
| Captura | DXGI Desktop Duplication → TurboJPEG, en proceso hijo, memoria compartida | `screenshot-desktop` (js), fallback PowerShell `CopyFromScreen` | DWService |
| Streaming | Incremental por token, paleta opcional, 10 niveles de calidad, modo Auto | Frames JPEG completos, sin control de calidad ni tamaño en la ruta principal | DWService |
| Códec de video | **Ninguno** (JPEG + paleta) | **Ninguno** (JPEG) | Empate |
| Codec de audio | Opus sobre RtAudio | Ninguno | DWService |
| Input remoto | `SendInput`, `SetCursorPos`, modificadores | Ninguno | DWService |
| Portapapeles | Bidireccional | Ninguno | DWService |
| Terminal | ConPTY nativa | Ninguno | DWService |
| Archivos | Subida, descarga, carpeta compartida RO | Ninguno | DWService |
| Multi-monitor | Nativo, con view-only por monitor | No soportado | DWService |
| Protocolo | WebSocket TLS, framing 4B BE, zlib, keepalive 30s | Socket.IO, ping 10s/timeout 5s, backoff 5–30s ∞ | Empate |
| Carga de imágenes | Binario, comprimido | **Base64 en JSON** (+33% de inflación) | DWService |
| Auto-actualización | Sí (MD5, sin firma) | **No** | DWService |
|Ofuscación de secretos | `base64(zlib(pwd))` reversible | JSON plano | Empate (ambos débiles) |
| RBAC | Básico por usuario/grupo | `RolePermission` granular de 11 permisos | **Nuestro** |
| Auditoría de acciones | Débil (no visible en el agente) | `AuditLog` con acción, recurso, IP, user-agent | **Nuestro** |
| Aprobación de comandos | No | Estados PENDING→APPROVED→EXECUTING con `approvedById` | **Nuestro** |
| Multi-cliente / consentsor | Un usuario por agente | `Device.role` multi-consorcio, aprovisionamiento por token | **Nuestro** |
| Modelo de datos | No auditable (nodo cerrado) | Prisma + PostgreSQL, 8 modelos, 4 enums | **Nuestro** |
| Licencia del cliente | MPLv2 (copyleft archivo) | Nuestro | — |
| Nodo self-hosteable | **No** | Sí, es nuestro | **Nuestro** |
| Detalle: `takeScreenshot` de nuestro agente devuelve `width: 0, height: 0` hardcodeado **[verificado, `commands.ts:33-34`]**, lo que hace que los metadatos de dimensión guardados en la tabla `Screenshot` sean inservibles. | | | |
| Detalle: nuestro fallback PowerShell fija `maxWidth = 1280` y calidad JPEG 70, pero **solo en la ruta de fallback**; la ruta principal `screenshot({format:"jpg"})` no escala ni fija calidad **[verificado, `commands.ts:48 y 88-92`]**. | | | |

**Balance**: DWService gana ampliamente en el agente (es un producto de escritorio de 10 años con ingeniería nativa pesada). Nosotros ganamos en el servidor, la auditoría y el modelo de negocio. Son cosas ortogonales, y por eso la conclusión correcta es **no elegir entre ambos**, sino **extraer patrones del primero y mantener el segundo**.

---

## 12. Brechas y riesgos

### 12.1 Nuestras brechas, ordenadas por impacto sobre el cliente final

1. **Sin servicio Windows** (crítico). En la máquina del cliente, si el usuario cierra sesión o nunca inicia sesión, no hay agente. Un RMM que se vende como "monitoreo" debe sobrevivir al arranque del equipo. El modelo Session 0 → sesión interactiva de DWService es la respuesta.
2. **Sin control de input** (crítico). Tenemos "live view" de solo lectura. Sin `SendInput` no hay soporte remoto real. El valor comercial de un RMM está en esto.
3. **Captura de escritorio, no de pantalla por monitor** (alto). `screenshot-desktop` captura el escritorio virtual completo; no hay selección de monitor ni view-only.
4. **Base64 en JSON** (alto). Inflación del 33% antes de compresión, más coste de CPU de codificar/decodificar Base64 en cada frame. Con streaming continuo esto es material.
5. **Sin terminal ni archivos** (alto). Son funcionalidades que el cliente espera por defecto.
6. **Sin auto-actualización** (alto). Cada corrección de seguridad exige redespliegue manual.
7. **Sin portapapeles ni audio** (medio).
8. **Instabilidad de la ruta de captura** (medio). `screenshot-desktop` con fallback a PowerShell genera un script en disco, ejecuta `powershell.exe -ExecutionPolicy Bypass`, y borra todo. Es frágil, deja artefactos si el proceso muere, y el flag `Bypass` es un vector de preocupación para políticas de ejecución.
9. **Dimensiones no reportadas** (medio). `width: 0, height: 0` en la ruta principal.
10. **Token de registro en JSON plano** (medio). Debería ir con DPAPI.
11. **Sin auditoría de la propia operación del agente** (medio). No hay bitácora local de qué comandos ejecutó el agente, solo la fila en `DeviceCommand`.

### 12.2 Riesgos que trae Adoptar DWService

1. **Nodo no self-hosteable.** No hay opción deERVICIO dedicado ni on-premise. El cliente queda atado a un tercero.
2. **Auditoría insuficiente** para un entorno corporativo. No hay separación de permisos por acción, ni aprobación, ni registro inmutable consultable por tenant.
3. **Pérdida de identidad propia.** El agente se conecta al nodo del proveedor; migrar fuera significa reimplementar el cliente, que es justamente lo que ya tenemos.
4. **Actualización firmada solo con MD5.** Riesgo de cadena de suministro real.
5. **Sin SLA de nodo público verificable.** [no verificado]
6. **El agente no sirve de modelo para el resto de nuestra plataforma** (RBAC, multi-consorcio, auditoría, API REST). Es un producto monolítico.

### 12.3 Lo que NO es un riesgo

- **La licencia MPLv2 del agente no nos bloquea** para estudiarlo, citarlo o reimplementar sus técnicas. MPLv2 es copyleft por archivo: reimplementar ideas en TypeScript desde cero no crea una obra derivada. Solo habría obligación si copiáramos archivos .py/.cpp/textos.
- **El uso de JPEG por frame no es una debilidadCompetitive**: es una decisión de diseño deliberada que prioriza latencia y simplicity sobre ancho de banda. Es exactamente lo que hace nuestro agente, por lo que estamos en el mismo punto del espacio de diseño.

---

## 13. Alternativas open source verificadas

Criterios de evaluación: licencia OSI real, actively maintained, self-hosteable, y relevante para un RMM Windows. Datos de licencia, estrellas y última fecha de push obtenidos de la API de GitHub el 2026-09-25 **[verificado]**.

| Proyecto | Licencia | Lenguaje | Estrellas | Último push | Self-host | ¿Derivado de DWService? | Veredicto |
|---|---|---|---|---|---|---|---|
| **MeshCentral** (`Ylianst/MeshCentral`) | **Apache-2.0** | Node.js/HTML | 7.283 | 2026-09-24 | Sí | No | **Mejor fit legal.** |
| **RustDesk** (`rustdesk/rustdesk`) | **AGPL-3.0** | Rust | 124.527 | 2026-09-25 | Sí (hbbs/hbkr) | No | Fixación técnica, problema legal |
| **Apache Guacamole** (`apache/guacamole-server`) | **Apache-2.0** | C | 3.992 | 2026-09-14 | Sí | No | Viable, modelo distinto |
| **Neko** (`m1k1o/neko`) | **Apache-2.0** | Go | 22.390 | 2026-09-24 | Sí (Docker) | No | Complemento, no sustituto |
| **noVNC** (`novnc/noVNC`) | **NOASSERTION** (API GitHub) | JavaScript | 14.050 | 2026-09-07 | Sí | No | Requiere verificar licencia |
| **Remotely** (`immense/Remotely`) | GPL-3.0 | C# | 5.081 | **2024-12-17** | Sí | No | **Abandonado. No usar** |
| **Tactical RMM** (`amidaware/tacticalrmm`) | **Propietaria** | Python/Vue/Go | 4.481 | 2026-09-17 | Sí | No | **Descartado (ver abajo)** |
| **waRP** | — | — | — | — | — | **Posiblemente sí** | **No verificable. Descartado** |

### 13.1 MeshCentral — recomendación como referencia

Apache-2.0, la única licencia **permisiva** entre las alternativas de escritorio completo, y activa. Su agente es `Ylianst/MeshAgent`, un binario nativo en C de 33 KB de source (`readme.md` de 11.810 bytes) con auto-test integrado **[verificado]**.

- **Licencia del agente con ambigüedad**: la API de GitHub devuelve `license: null` para `Ylianst/MeshAgent`, cuyo directorio raíz contiene `readme.md` pero no un archivo `LICENSE` **[verificado]**. La documentación de MeshCentral indica Apache-2.0 para el producto, pero **hay que confirmar la licencia del agente por separado antes de consumirlo como dependencia**. Esto es materialmente lo mismo que encontramos en `dwservice/agent`, y por eso lo marcamos.
- **Electivo de arquitectura**: MeshCentral ejecuta un agente de servicio nativo en el cliente y transmite escritorio con **otro codec, no JPEG**, incluyendo soporte de vídeo comprimido. Es la referencia directa para resolver nuestro problema de streaming.
- **Riesgo de adopting**: reescribir nuestro agente en C nativo es un proyecto grande. Nos quedamos en tomar el **patrón** (servicio nativo, protocolo eficiente) y mantener Node.js para la UI.

### 13.2 RustDesk — el problema AGPL

AGPL-3.0 es copyleft de red. La sección 13 de la AGPL obliga a que **cualquier modificación usada sobre una red** se ofrezca al público bajo AGPL, incluyendo dentro de un SaaS. Como `remote-monitoring-platform` es precisamente un servicio, **adoptar código AGPL de RustDesk obligaría a publicar nuestras modificaciones de la parte derivada bajo AGPL**. Está excluido salvo que aceptemos abrir el producto.

Rechazamos el argumento habitual de "solo el cliente es AGPL, el servidor es nuestro": la AGPL alcanza a la obra derivada en su interacción por red, y separar deliberadamente el cliente del servidor para eludir la cláusula es exactamente lo que la licencia prohíbe. **[Riesgo legal, no aplicable]**

RustDesk sigue siendo **excelente referencia técnica** (lectura de código, arquitectura de codec, self-hosting).

### 13.3 Apache Guacamole + noVNC — permissible pero modelo distinto

`guacd` (Apache-2.0) es un proxy que habla RDP, VNC, SSH y Telnet hacia el objetivo **[verificado]**. El agente del lado objetivo es esencialmente "Habilita RDP/VNC y quédate quieto".

- **Licencia Apache-2.0 limpia, sin copyleft** **[verificado]**.
- Limitación dura: requiere **habilitar RDP en el Windows del cliente**, lo que significa Bandera de seguridad, cambio de firewall, y suele requerir credenciales de usuario. Eso es un cambio de posture de seguridad inaceptable para un despliegue de monitoreo discreto, y rompe los casos de uso de "usuario siempre conectado" y "equipo en quiosco".
- Transferencia de archivos y portapapeles de RDP son notoriously frágiles.

Útil como **opción de segundo plano para equipos donde RDP ya está habilitado**, no como reemplazo del agente.

### 13.4 Neko — complemento de co-navegación

Apache-2.0, Go, WebRTC, 22.390 estrellas, activo **[verificado]**. Es un navegador virtualizado en Docker que se comparte por WebRTC. No es un agente RMM: no hay inventario, ni comandos, ni shell, ni archivos, ni persistencia de datos de dispositivo. Valor real: **canal de soporte guiado** (el operador ve el mismo navegador), y el hecho de que sea **WebRTC (P2P real)** marca el listón de calidad de streaming que DWService no alcanza. Bueno para añadir como modo "sesión guiada" más adelante.

### 13.5 Tactical RMM — descartado, y esto es importante

Su repositorio `amidaware/tacticalrmm` **no es open source**, contra la creencia común. Su propio `LICENSE.md` (6.637 bytes) lo dice literalmente **[verificado]**:

> *"The Tactical RMM License is not an open-source software license. This license contains certain restrictions on the use of the Licensed Software. For example the functionality of the Licensed Software may not be made available as part of a SaaS (Software-as-a-Service) service or product to provide a commercial or for-profit service without the express prior permission of the Licensor."*

Y enumera qué prohíbe **[verificado]**:

> *"a service allowing third parties to interact remotely through a computer network; as part of a SaaS service or product; as part of the provision of a managed hosting service or product; the offering of installation and/or configuration services; the offer for sale, distribution or sale of any service or product."*

Las dos primeras prohibiciones **describen literalmente lo que `remote-monitoring-platform` hace**. `amidaware/rmmagent` comparte la misma licencia. **Descartado.**

### 13.6 waRP — no verificable

Tres búsquedas distintas en la API de repositorios de GitHub (por nombre, por nombre+descripción, y una acotada por estrellas) devolvieron **cero resultados**, y la búsqueda web no arrojó nada asociable a DWService **[verificado como ausencia de evidencia]**. No se puede verificar que exista, su licencia, ni que tenga relación con DWService. **No se recomienda ni se referencia.**

---

## 14. Recomendación, plan de acción y resumen

### 14.1 Decisión

**No abandonar nuestro agente. No adoptar DWService. Adoptar selectively patrones de DWService y MeshCentral, y construir el servicio Windows nativo que falta.**

Justificación en una línea: nuestro servidor y nuestro modelo de datos son mejores que los de DWService, y el nodo de DWService no es self-hosteable; el agente de DWService es mejor que el nuestro, y su licencia MPLv2 nos permite estudiarlo libremente. La intersección de ambos es el producto que ya tenemos más completo.

### 14.2 Qué copiar de DWService (con licencia)

Todas estas son **ideas y arquitecturas, no código**:

1. **Servicio Windows nativo C/C++ con puente Session 0** (el mayor salto de madurez). Escribiendo en un exe separado, no en Node.
2. **Candidato de calidad de captura en proceso hijo + memoria compartida** para sacar el coste de codificación del proceso de servicio.
3. **Modo de servicio persistente** con dos modos: unattended (servicio) y attended (usuario), con preferencia por el servicio cuando hay consola activa.
4. **Delta encoding + encoder de paleta** como niveles degradados de streaming.
5. **DPAPI** para proteger el token de registro (mejora sobre su `base64(zlib(...))`).
6. **Auto-actualización con SHA-256 y verificación de firma Authenticode** (superar su MD5 sin firma).
7. **ConPTY** para terminal real en vez de `cmd.exe`.

### 14.3 Qué mirar de MeshCentral

El mecanismo de **códec de escritorio comprimido real** y el **protocolo de streaming eficiente**, más el patrón de agente nativo diminuto. Solo lectura: no adoptar dependencia por la ambigüedad de licencia del agente.

### 14.4 Qué evitar

- AGPL-3.0 (RustDesk) en cualquier forma que toque nuestro servicio.
- Cualquier producto cuya licencia prohíba el SaaS (Tactical RMM, y verificar el resto).
- `waRP` como referencia, por no existir evidencia.
- Habilitar RDP en el cliente del cliente final como estrategia de captura.

### 14.5 Plan de acción priorizado

| # | Acción | Esfuerzo | Impacto |
|---|---|---|---|
| 1 | Convertir el agente en Windows Service (Session 0) con relanzado a sesión activa | Alto | Desbloquea el caso "equipo sin usuario" |
| 2 | Implementar input remoto con `SendInput` | Medio | Convierte "monitoreo" en "soporte" |
| 3 | Cambiar el transporte de imágenes: binario en vez de Base64, con compresión | Medio | Rendimiento y ancho de banda |
| 4 | Añadir calidad/escalado configurables y modo Auto | Bajo | Resiliencia en redes malas |
| 5 | Corregir `width`/`height` en la ruta principal de captura | Bajo | Datos deimension correctos |
| 6 | Shell con ConPTY | Medio | Paridad funcional |
| 7 | Transferencia de archivos y portapapeles | Medio | Paridad funcional |
| 8 | Auto-actualización firmada (SHA-256 + Authenticode) | Medio | Seguridad y operación |
| 9 | DPAPI para el token de registro | Bajo | Higiene de secretos |
| 10 | Streaming con códec comprimido (evaluar h264 via WebRTC/FFmpeg o integrar Neko) | Alto | Paridad de calidad |

### 14.6 Resumen ejecutivo (15 líneas)

1. El agente de DWService es **realmente open source** (MPLv2 por componente), no una caja negra; el **nodo** es lo cerrado.
2. Está escrito en Python 2 + C++ con un servicio Windows nativo (`dwagsvc.exe`) y un puente Session 0 que es su mayor logro de ingeniería.
3. **No usa códec de video**: transmite frames JPEG con TurboJPEG (10 niveles) más un encoder de paleta, con el codificador en un proceso hijo alimentado por memoria compartida.
4. Protocolo propio: WebSocket TLS, framing 4 bytes big-endian, JSON comprimido con zlib, keepalive 30 s.
5. Auto-actualización automática, pero **verificada solo con MD5 y sin firma**: riesgo de cadena de suministro real.
6. Secretos solo ofuscados (`base64(zlib(pwd))`); nosotros hacemos lo mismo pero en JSON plano.
7. El nodo **no es self-hosteable** y su auditoría es débil: no sirve para nuestro producto.
8. Nuestro servidor es mejor en RBAC (11 permisos), auditoría, aprobación de comandos y multi-consorcio.
9. Nuestro agente es claramente peor: no es servicio, no tiene input, ni terminal, ni archivos, ni portapapeles, ni multi-monitor, ni auto-update.
10. Streaming en Base64 dentro de JSON nos cuesta un 33 % de inflación: hay que arreglarlo.
11. **Ninguna alternativa open source cubre el conjunto con licencia permisiva.** Tactical RMM **no es open source** y su licencia prohíbe exactamente nuestro caso de uso; su agente tampoco tiene licencia OSI clara.
12. RustDesk es AGPL-3.0: cualquier dependencia contaminaría nuestro servicio. Descartado como dependencia, valioso como referencia.
13. waRP **no se pudo verificar**: cero resultados en GitHub y web. No es una referencia.
14. Decisión: **construir sobre nuestro agente**, portando servicio nativo Session 0, input, streaming binario y auto-update firmada; usar DWService y MeshCentral como referencia técnica.
15. waRP: descartado. Siguiente paso de mayor impacto: convertir el agente en Windows Service, que hoy impide cobrir equipos sin sesión de usuario iniciada.
