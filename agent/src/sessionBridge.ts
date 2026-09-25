export interface SessionBridgeDeps {
  runBridge: () => Promise<void>;
  hasLiveWorker: () => boolean;
  now?: () => number;
  retryIntervalMs?: number;
  failureCooldownMs?: number;
}

const DEFAULT_RETRY_INTERVAL_MS = 5000;
const DEFAULT_FAILURE_COOLDOWN_MS = 30000;

export class SessionBridge {
  private readonly runBridge: () => Promise<void>;
  private readonly hasLiveWorker: () => boolean;
  private readonly now: () => number;
  private readonly retryIntervalMs: number;
  private readonly failureCooldownMs: number;

  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private cooldownUntil = 0;

  constructor(deps: SessionBridgeDeps) {
    this.runBridge = deps.runBridge;
    this.hasLiveWorker = deps.hasLiveWorker;
    this.now = deps.now || (() => Date.now());
    this.retryIntervalMs = deps.retryIntervalMs || DEFAULT_RETRY_INTERVAL_MS;
    this.failureCooldownMs = deps.failureCooldownMs || DEFAULT_FAILURE_COOLDOWN_MS;
  }

  start(): void {
    if (this.timer) return;

    void this.ensureWorker();
    this.timer = setInterval(() => {
      void this.ensureWorker();
    }, this.retryIntervalMs);

    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  notifyWorkerDisconnected(): void {
    void this.ensureWorker();
  }

  private async ensureWorker(): Promise<void> {
    if (this.inFlight || this.hasLiveWorker()) return;
    if (this.now() < this.cooldownUntil) return;

    this.inFlight = true;
    try {
      await this.runBridge();
      this.cooldownUntil = 0;
    } catch {
      this.cooldownUntil = this.now() + this.failureCooldownMs;
    } finally {
      this.inFlight = false;
    }
  }
}
