import { describe, expect, it } from "vitest";
import { SessionBridge } from "./sessionBridge";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("SessionBridge", () => {
  it("runs the bridge on start when no worker is live", async () => {
    let runs = 0;
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
      },
      hasLiveWorker: () => false,
      retryIntervalMs: 5000,
    });

    bridge.start();
    await tick();

    expect(runs).toBe(1);
    bridge.stop();
  });

  it("does not run the bridge when a worker is already live", async () => {
    let runs = 0;
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
      },
      hasLiveWorker: () => true,
      retryIntervalMs: 5,
    });

    bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(runs).toBe(0);
    bridge.stop();
  });

  it("retries on the interval while no worker is live", async () => {
    let runs = 0;
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
      },
      hasLiveWorker: () => false,
      retryIntervalMs: 5,
    });

    bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    bridge.stop();

    expect(runs).toBeGreaterThan(1);
  });

  it("reacts immediately when a worker disconnects", async () => {
    let runs = 0;
    let live = true;
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
      },
      hasLiveWorker: () => live,
      retryIntervalMs: 60000,
    });

    bridge.start();
    await tick();
    expect(runs).toBe(0);

    live = false;
    bridge.notifyWorkerDisconnected();
    await tick();

    expect(runs).toBe(1);
    bridge.stop();
  });

  it("does not stack bridge runs while one is in flight", async () => {
    let runs = 0;
    const gate = deferred();
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
        await gate.promise;
      },
      hasLiveWorker: () => false,
      retryIntervalMs: 5,
    });

    bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(runs).toBe(1);

    gate.resolve();
    await tick();
    bridge.stop();
  });

  it("backs off after a failure until the cooldown expires", async () => {
    let runs = 0;
    let now = 1000;
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
        throw new Error("bridge exploded");
      },
      hasLiveWorker: () => false,
      now: () => now,
      retryIntervalMs: 5,
      failureCooldownMs: 1000,
    });

    bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(1);

    bridge.notifyWorkerDisconnected();
    await tick();
    expect(runs).toBe(1);

    now += 1500;
    bridge.notifyWorkerDisconnected();
    await tick();
    expect(runs).toBe(2);

    bridge.stop();
  });

  it("is safe to start twice", async () => {
    let runs = 0;
    const bridge = new SessionBridge({
      runBridge: async () => {
        runs += 1;
      },
      hasLiveWorker: () => false,
      retryIntervalMs: 5,
    });

    bridge.start();
    bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    bridge.stop();

    expect(runs).toBeGreaterThan(0);
  });
});
