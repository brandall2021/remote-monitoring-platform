// Logica de la vista en vivo, separada del transporte para poder probarla con timers falsos y un
// emitter falso.
//
// Como era antes: cada panel tenia su setInterval y cada tick del navegador disparaba un round-trip
// completo (panel -> server -> agente -> captura -> server -> panel). Ver el mismo equipo en dos
// pantallas duplicaba la carga, y si la captura tardaba mas que el intervalo el agente descartaba el
// pedido por estar ocupado: de ahi que la imagen fuera a saltos.
//
// Como es ahora: el server lleva la cuenta de espectadores por equipo y le pide UNA corriente al
// agente, al ritmo del espectador mas exigente. El agente regula su propio paso (ve "live-start") y
// manda cuadros hasta que se le dice "live-stop". Los agentes ya instalados que no conocen el
// protocolo siguen con el modo viejo ("poll": un live-command por cuadro) hasta que se actualicen.

export type LiveMode = "stream" | "poll";

export const LIVE_DEFAULT_INTERVAL_MS = 1000;
// Mismo piso que el agente (liveStream.ts): 250 ms es lo que entrega el worker de captura persistente
// (~170 ms por cuadro). Si el server permitiera 100 ms, el agente igual los recorta; mejor un solo numero.
export const LIVE_MIN_INTERVAL_MS = 250;
export const LIVE_MAX_INTERVAL_MS = 60000;

// Un payload basura (null, "", "abc") no puede significar "intervalo 0 ms": va al default.
function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
  return NaN;
}

export function clampLiveInterval(raw: unknown): number {
  const parsed = toNumber(raw);
  if (!Number.isFinite(parsed)) return LIVE_DEFAULT_INTERVAL_MS;
  return Math.min(Math.max(Math.round(parsed), LIVE_MIN_INTERVAL_MS), LIVE_MAX_INTERVAL_MS);
}

/** Cuanto tarda el server en dar por cortada una corriente: dos cuadros perdidos mas un margen fijo. */
export function liveStallTimeoutMs(intervalMs: number): number {
  return Math.max(clampLiveInterval(intervalMs), LIVE_MIN_INTERVAL_MS) * 2 + 3000;
}

/**
 * Modo del agente. Los builds nuevos declaran liveProtocol "2" en el handshake y aceptan live-start;
 * un agente sin el campo es un build ya desplegado, y a ese solo le pides cuadros de uno en uno.
 */
export function resolveLiveMode(liveProtocol: unknown): LiveMode {
  return String(liveProtocol ?? "") === "2" ? "stream" : "poll";
}

interface LiveDeviceSession {
  // socketId del panel -> intervalo pedido. Agregar y quitar espectadores sin recorrer las salas.
  viewers: Map<string, number>;
}

export class LiveSessionRegistry {
  private readonly byDevice = new Map<string, LiveDeviceSession>();
  private readonly devicesByViewer = new Map<string, Set<string>>();

  addViewer(deviceId: string, socketId: string, intervalMs: unknown): void {
    const interval = clampLiveInterval(intervalMs);
    let session = this.byDevice.get(deviceId);
    if (!session) {
      session = { viewers: new Map() };
      this.byDevice.set(deviceId, session);
    }

    session.viewers.set(socketId, interval);

    let devices = this.devicesByViewer.get(socketId);
    if (!devices) {
      devices = new Set();
      this.devicesByViewer.set(socketId, devices);
    }
    devices.add(deviceId);
  }

  /** @returns los dispositivos afectados, para que el llamador reactive o apague cada corriente. */
  removeViewer(socketId: string, deviceId?: string): string[] {
    if (deviceId) {
      this.detach(socketId, deviceId);
      return [deviceId];
    }

    const devices = this.devicesByViewer.get(socketId);
    if (!devices) return [];

    // Copia antes de iterar: detach() vacia ese mismo Set, y devolverlo vivo dejaba la lista en blanco.
    const affected = [...devices];
    for (const id of affected) this.detach(socketId, id);
    this.devicesByViewer.delete(socketId);
    return affected;
  }

  /** El agente se desconecto: nadie puede producir cuadros, pero los paneles siguen suscriptos. */
  dropDevice(deviceId: string): string[] {
    const session = this.byDevice.get(deviceId);
    if (!session) return [];
    const sockets = [...session.viewers.keys()];
    this.byDevice.delete(deviceId);
    for (const socketId of sockets) this.devicesByViewer.get(socketId)?.delete(deviceId);
    return sockets;
  }

  hasViewers(deviceId: string): boolean {
    const session = this.byDevice.get(deviceId);
    return !!session && session.viewers.size > 0;
  }

  viewerCount(deviceId: string): number {
    return this.byDevice.get(deviceId)?.viewers.size ?? 0;
  }

  /** El intervalo mas corto entre los espectadores: el mas rapido manda sobre la corriente. */
  intervalMs(deviceId: string): number | null {
    const session = this.byDevice.get(deviceId);
    if (!session || session.viewers.size === 0) return null;
    let fastest = LIVE_MAX_INTERVAL_MS;
    for (const interval of session.viewers.values()) {
      if (interval < fastest) fastest = interval;
    }
    return fastest;
  }

  devicesOfViewer(socketId: string): string[] {
    return [...(this.devicesByViewer.get(socketId) ?? [])];
  }

  private detach(socketId: string, deviceId: string): void {
    const session = this.byDevice.get(deviceId);
    if (session) {
      session.viewers.delete(socketId);
      if (session.viewers.size === 0) this.byDevice.delete(deviceId);
    }
    this.devicesByViewer.get(socketId)?.delete(deviceId);
  }
}

interface LiveRunState {
  mode: LiveMode;
  intervalMs: number;
  // Solo el modo "poll" (agente viejo) necesita que el server pregunte: un setInterval por dispositivo,
  // jamas uno por navegador.
  pollTimer: NodeJS.Timeout | null;
  pollTimerIntervalMs: number | null;
  watchdog: NodeJS.Timeout | null;
  lastFrameAt: number;
}

export interface LiveSchedulerDeps {
  /** Emite hacia el agente conectado a ese deviceId (sala = id de dispositivo). */
  send: (deviceId: string, event: string, payload?: unknown) => void;
  /** Unica senal visible de que una corriente se cayo; el scheduler la reactiva solo. */
  onStall?: (deviceId: string) => void;
}

export class LiveStreamScheduler {
  private readonly registry = new LiveSessionRegistry();
  private readonly states = new Map<string, LiveRunState>();
  private readonly modes = new Map<string, LiveMode>();

  constructor(private readonly deps: LiveSchedulerDeps) {}

  /** @returns true si este espectador abrio la sala: sirve para auditar el arranque una sola vez. */
  addViewer(deviceId: string, socketId: string, intervalMs: unknown): boolean {
    const wasEmpty = !this.registry.hasViewers(deviceId);
    this.registry.addViewer(deviceId, socketId, intervalMs);
    this.refresh(deviceId);
    return wasEmpty;
  }

  removeViewer(socketId: string, deviceId?: string): void {
    for (const affected of this.registry.removeViewer(socketId, deviceId)) {
      this.refresh(affected);
    }
  }

  agentConnected(deviceId: string, mode: LiveMode): void {
    this.modes.set(deviceId, mode);
    // Si un panel dejo la vista abierta durante la caida, la corriente se reanuda sola.
    if (this.registry.hasViewers(deviceId)) this.refresh(deviceId);
  }

  agentDisconnected(deviceId: string): void {
    this.modes.delete(deviceId);
    this.stop(deviceId);
  }

  hasViewers(deviceId: string): boolean {
    return this.registry.hasViewers(deviceId);
  }

  intervalMs(deviceId: string): number | null {
    return this.registry.intervalMs(deviceId);
  }

  viewerCount(deviceId: string): number {
    return this.registry.viewerCount(deviceId);
  }

  /**
   * Llego un cuadro del agente. Devuelve true solo si vale la pena retransmitirlo: sin espectadores
   * (o sin agente conocido) el frame se tira, que es lo que evita difundir video a salas vacias.
   */
  onFrame(deviceId: string): boolean {
    const state = this.states.get(deviceId);
    if (state) state.lastFrameAt = Date.now();
    return this.registry.hasViewers(deviceId) && this.modes.has(deviceId);
  }

  /** Apaga todo: lo llama el shutdown del server para no dejar timers colgados. */
  dispose(): void {
    for (const deviceId of [...this.states.keys()]) this.stop(deviceId);
    this.modes.clear();
  }

  refresh(deviceId: string): void {
    const intervalMs = this.registry.intervalMs(deviceId);
    if (intervalMs === null) {
      // Quedo sin publico: se apaga la captura en el agente en vez de seguir produciendo al vacio.
      this.stop(deviceId);
      return;
    }

    const mode = this.modes.get(deviceId);
    if (!mode) {
      // Sin agente conectado no hay nada que producir; agentConnected reactiva la sala al reconectar.
      this.stop(deviceId);
      return;
    }

    const existing = this.states.get(deviceId);
    const state: LiveRunState = existing ?? {
      mode,
      intervalMs,
      pollTimer: null,
      pollTimerIntervalMs: null,
      watchdog: null,
      lastFrameAt: Date.now(),
    };
    this.states.set(deviceId, state);
    state.mode = mode;
    state.intervalMs = intervalMs;
    state.lastFrameAt = Date.now();

    if (mode === "stream") {
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.pollTimerIntervalMs = null;
      }
      // Reenviar live-start es idempotente en el agente: ajusta el intervalo y revive la corriente
      // después de una reconexion o de un worker de sesion que se caigo.
      this.deps.send(deviceId, "live-start", { deviceId, intervalMs });
      this.armWatchdog(deviceId, state);
      return;
    }

    // Agente viejo: un live-command por cuadro. Node no permite reprogramar un setInterval, asi que
    // si cambio el intervalo se cierra el timer viejo y se crea uno nuevo.
    if (state.pollTimer && state.pollTimerIntervalMs === intervalMs) return;
    if (state.pollTimer) clearInterval(state.pollTimer);
    const pollTimer = setInterval(() => {
      if (!this.registry.hasViewers(deviceId) || !this.modes.has(deviceId)) {
        this.stop(deviceId);
        return;
      }
      this.deps.send(deviceId, "live-command", { deviceId });
    }, intervalMs);
    if (typeof pollTimer.unref === "function") pollTimer.unref();
    state.pollTimer = pollTimer;
    state.pollTimerIntervalMs = intervalMs;
  }

  private stop(deviceId: string): void {
    const state = this.states.get(deviceId);
    if (!state) return;
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.watchdog) clearTimeout(state.watchdog);
    this.states.delete(deviceId);
    // Solo el agente nuevo entiende live-stop; al viejo le alcanza con no volver a preguntarle.
    if (state.mode === "stream") this.deps.send(deviceId, "live-stop", { deviceId });
  }

  private armWatchdog(deviceId: string, state: LiveRunState): void {
    if (state.watchdog) clearTimeout(state.watchdog);
    const timeout = liveStallTimeoutMs(state.intervalMs);
    const watchdog = setTimeout(() => {
      const current = this.states.get(deviceId);
      if (!current) return;
      current.watchdog = null;
      if (Date.now() - current.lastFrameAt < timeout) {
        this.armWatchdog(deviceId, current);
        return;
      }
      this.deps.onStall?.(deviceId);
      this.refresh(deviceId);
    }, timeout);
    if (typeof watchdog.unref === "function") watchdog.unref();
    state.watchdog = watchdog;
  }
}
