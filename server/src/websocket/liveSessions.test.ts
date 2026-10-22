import {
  LIVE_MAX_INTERVAL_MS,
  LIVE_MIN_INTERVAL_MS,
  LiveSessionRegistry,
  LiveStreamScheduler,
  clampLiveInterval,
  liveStallTimeoutMs,
  resolveLiveMode,
} from "./liveSessions";

describe("LiveSessionRegistry", () => {
  it("usa el intervalo del espectador mas exigente", () => {
    const registry = new LiveSessionRegistry();
    registry.addViewer("dev-1", "admin-a", 5000);
    registry.addViewer("dev-1", "admin-b", 1000);

    expect(registry.intervalMs("dev-1")).toBe(1000);

    // El rapido se va: la corriente baja al ritmo del que queda, no se queda en el minimo.
    registry.removeViewer("admin-b", "dev-1");
    expect(registry.intervalMs("dev-1")).toBe(5000);
  });

  it("sin espectadores no hay intervalo", () => {
    const registry = new LiveSessionRegistry();
    registry.addViewer("dev-1", "admin-a", 1000);
    expect(registry.hasViewers("dev-1")).toBe(true);

    registry.removeViewer("admin-a", "dev-1");
    expect(registry.hasViewers("dev-1")).toBe(false);
    expect(registry.intervalMs("dev-1")).toBeNull();
  });

  it("cerrar una pestana saca al espectador de todas las salas", () => {
    const registry = new LiveSessionRegistry();
    registry.addViewer("dev-1", "admin-a", 1000);
    registry.addViewer("dev-2", "admin-a", 2000);

    const affected = registry.removeViewer("admin-a");
    expect(affected.sort()).toEqual(["dev-1", "dev-2"]);
    expect(registry.viewerCount("dev-1")).toBe(0);
    expect(registry.viewerCount("dev-2")).toBe(0);
    expect(registry.devicesOfViewer("admin-a")).toEqual([]);
  });

  it("un mismo espectador no cuenta dos veces por reconectar", () => {
    const registry = new LiveSessionRegistry();
    registry.addViewer("dev-1", "admin-a", 2000);
    registry.addViewer("dev-1", "admin-a", 400);

    expect(registry.viewerCount("dev-1")).toBe(1);
    expect(registry.intervalMs("dev-1")).toBe(400);
  });

  it("un intervalo basura no puede pedir 0 ms ni un minuto por cuadro", () => {
    const registry = new LiveSessionRegistry();
    registry.addViewer("dev-1", "admin-a", "cualquier-cosa");
    expect(registry.intervalMs("dev-1")).toBe(1000);

    registry.addViewer("dev-2", "admin-a", 1);
    registry.addViewer("dev-3", "admin-a", 9_999_999);
    expect(registry.intervalMs("dev-2")).toBe(LIVE_MIN_INTERVAL_MS);
    expect(registry.intervalMs("dev-3")).toBe(LIVE_MAX_INTERVAL_MS);
  });

  it("un agente que cae deja de tener productores pero los paneles siguen suscriptos", () => {
    const registry = new LiveSessionRegistry();
    registry.addViewer("dev-1", "admin-a", 1000);

    expect(registry.dropDevice("dev-1")).toEqual(["admin-a"]);
    expect(registry.hasViewers("dev-1")).toBe(false);
    expect(registry.devicesOfViewer("admin-a")).toEqual([]);
  });

  it("dropDevice de un dispositivo inexistente no inventa nada", () => {
    expect(new LiveSessionRegistry().dropDevice("no-existe")).toEqual([]);
  });
});

describe("clampLiveInterval", () => {
  it("recorta y redondea", () => {
    expect(clampLiveInterval(1500.4)).toBe(1500);
    expect(clampLiveInterval(-1)).toBe(LIVE_MIN_INTERVAL_MS);
  });
});

describe("resolveLiveMode", () => {
  it("solo el agente nuevo entra en modo corriente", () => {
    expect(resolveLiveMode("2")).toBe("stream");
    expect(resolveLiveMode(2)).toBe("stream");
  });

  it("un agente sin el campo (build ya instalado) sigue con un cuadro por round-trip", () => {
    expect(resolveLiveMode(undefined)).toBe("poll");
    expect(resolveLiveMode("1")).toBe("poll");
    expect(resolveLiveMode(null)).toBe("poll");
  });
});

describe("liveStallTimeoutMs", () => {
  it("da margen de sobra antes de declarar la corriente cortada", () => {
    expect(liveStallTimeoutMs(1000)).toBe(5000);
    expect(liveStallTimeoutMs(5000)).toBe(13000);
  });

  it("con intervalos minimos no revive al agente cada medio segundo", () => {
    // 250 ms x2 + 3000 de margen: un cuadro por segundo tiene casi 4 s de aire antes del revive.
    expect(liveStallTimeoutMs(0)).toBe(liveStallTimeoutMs(LIVE_MIN_INTERVAL_MS));
  });
});

describe("LiveStreamScheduler", () => {
  function build() {
    const send = jest.fn();
    const onStall = jest.fn();
    const scheduler = new LiveStreamScheduler({ send, onStall });
    return { send, onStall, scheduler };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-21T00:00:00Z"));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("manda un solo live-start por dispositivo, no un pedido por cuadro", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");

    expect(scheduler.addViewer("dev-1", "admin-a", 1000)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("dev-1", "live-start", { deviceId: "dev-1", intervalMs: 1000 });

    // Ni siquiera con la sala abierta salen pedidos periodicos: el agente produce y el server solo
    // sigue la corriente (cada cuadro deja vivo al watchdog).
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(500);
      expect(scheduler.onFrame("dev-1")).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("el segundo espectador mas rapido reprograma la corriente, sin duplicar el loop", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    scheduler.addViewer("dev-1", "admin-a", 5000);

    expect(scheduler.addViewer("dev-1", "admin-b", 1000)).toBe(false);
    expect(send).toHaveBeenLastCalledWith("dev-1", "live-start", { deviceId: "dev-1", intervalMs: 1000 });

    // El que pidio rapido se va: la corriente vuelve al ritmo del que queda.
    scheduler.removeViewer("admin-b", "dev-1");
    expect(send).toHaveBeenLastCalledWith("dev-1", "live-start", { deviceId: "dev-1", intervalMs: 5000 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("apaga la captura en el agente cuando se va el ultimo espectador", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    scheduler.addViewer("dev-1", "admin-a", 1000);
    scheduler.addViewer("dev-1", "admin-b", 1000);

    scheduler.removeViewer("admin-a", "dev-1");
    expect(send).not.toHaveBeenCalledWith("dev-1", "live-stop", expect.anything());

    scheduler.removeViewer("admin-b", "dev-1");
    expect(send).toHaveBeenCalledWith("dev-1", "live-stop", { deviceId: "dev-1" });

    // Y se apaga de verdad: ni un cuadro mas, ni otro live-stop repetido.
    send.mockClear();
    jest.advanceTimersByTime(20_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("cerrar la pestana sin avisar apaga la corriente igual", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    scheduler.addViewer("dev-1", "admin-a", 1000);
    send.mockClear();

    scheduler.removeViewer("admin-a");
    expect(send).toHaveBeenCalledWith("dev-1", "live-stop", { deviceId: "dev-1" });
  });

  it("un agente viejo recibe un live-command por cuadro y uno solo por dispositivo", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "poll");
    scheduler.addViewer("dev-1", "admin-a", 2000);
    scheduler.addViewer("dev-1", "admin-b", 2000);

    jest.advanceTimersByTime(6000);
    // Tres cuadros en 6 s a 2000 ms, pedidos una sola vez al agente aunque haya dos paneles.
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, "dev-1", "live-command", { deviceId: "dev-1" });

    // Al agente viejo no le existe live-stop: se le deja de preguntar.
    expect(send).not.toHaveBeenCalledWith("dev-1", "live-stop", expect.anything());
  });

  it("el poll del agente viejo se apaga cuando la sala queda vacia", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "poll");
    scheduler.addViewer("dev-1", "admin-a", 1000);
    scheduler.removeViewer("admin-a", "dev-1");

    send.mockClear();
    jest.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("sin agente conectado no se arma nada y se reanuda al reconectar", () => {
    const { send, scheduler } = build();
    expect(scheduler.addViewer("dev-1", "admin-a", 1000)).toBe(true);
    expect(send).not.toHaveBeenCalled();

    scheduler.agentConnected("dev-1", "stream");
    expect(send).toHaveBeenCalledWith("dev-1", "live-start", { deviceId: "dev-1", intervalMs: 1000 });
  });

  it("la caida del agente apaga la corriente y la reconexion la vuelve a encender", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    scheduler.addViewer("dev-1", "admin-a", 1000);
    send.mockClear();

    scheduler.agentDisconnected("dev-1");
    expect(send).toHaveBeenCalledWith("dev-1", "live-stop", { deviceId: "dev-1" });
    expect(scheduler.onFrame("dev-1")).toBe(false);

    send.mockClear();
    jest.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();

    scheduler.agentConnected("dev-1", "stream");
    expect(send).toHaveBeenCalledWith("dev-1", "live-start", { deviceId: "dev-1", intervalMs: 1000 });
  });

  it("onFrame solo retransmite si hay sala y agente, y con eso el watchdog no interviene", () => {
    const { send, onStall, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    expect(scheduler.onFrame("dev-1")).toBe(false);

    scheduler.addViewer("dev-1", "admin-a", 1000);
    expect(scheduler.onFrame("dev-1")).toBe(true);

    send.mockClear();
    for (let i = 0; i < 40; i++) {
      jest.advanceTimersByTime(500);
      expect(scheduler.onFrame("dev-1")).toBe(true);
    }
    expect(onStall).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("si los cuadros se cortan, el watchdog reactiva la corriente", () => {
    const { send, onStall, scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    scheduler.addViewer("dev-1", "admin-a", 1000);
    // liveStallTimeoutMs(1000) = 5000 ms.
    expect(send).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    expect(onStall).toHaveBeenCalledWith("dev-1");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("dev-1", "live-start", { deviceId: "dev-1", intervalMs: 1000 });
  });

  it("un agente que manda cuadros enormes a una sala vacia no se difunde", () => {
    const { scheduler } = build();
    scheduler.agentConnected("dev-1", "stream");
    expect(scheduler.onFrame("dev-1")).toBe(false);
    expect(scheduler.onFrame("dev-que-no-existe")).toBe(false);
  });

  it("dispose deja todos los timers apagados", () => {
    const { send, scheduler } = build();
    scheduler.agentConnected("dev-1", "poll");
    scheduler.agentConnected("dev-2", "stream");
    scheduler.addViewer("dev-1", "admin-a", 500);
    scheduler.addViewer("dev-2", "admin-a", 500);
    send.mockClear();

    scheduler.dispose();
    // Dispose apaga de verdad: avisa live-stop al agente en streaming y despues no queda ningun
    // timer vivo (ni poll ni watchdog) que vuelva a tocar el canal.
    expect(send).toHaveBeenCalledWith("dev-2", "live-stop", { deviceId: "dev-2" });
    send.mockClear();

    jest.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
  });
});
