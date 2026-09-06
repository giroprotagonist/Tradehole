import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach } from "node:test";
import { singleFlight, resetSingleFlightForTests } from "../singleFlight";
import { serveLastGood, resetLastGoodQueueForTests } from "../lastGoodServe";
import { writeLastGood } from "../lastGoodStore";
import {
  ironsightKnownDown,
  _setIronsightProbeForTests,
  fetchIfIronsightUp,
} from "../ironsightHealth";

describe("singleFlight", () => {
  beforeEach(() => {
    resetSingleFlightForTests();
  });

  it("coalesces concurrent callers into one execution", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const work = () =>
      singleFlight("k", async () => {
        runs += 1;
        await gate;
        return 42;
      });
    const a = work();
    const b = work();
    const c = work();
    release();
    assert.deepEqual(await Promise.all([a, b, c]), [42, 42, 42]);
    assert.equal(runs, 1);
  });

  it("runs again after the in-flight work settles", async () => {
    let runs = 0;
    await singleFlight("k", async () => {
      runs += 1;
    });
    await singleFlight("k", async () => {
      runs += 1;
    });
    assert.equal(runs, 2);
  });

  it("allows a retry after a failed flight", async () => {
    await assert.rejects(
      () =>
        singleFlight("k", async () => {
          throw new Error("boom");
        }),
      /boom/,
    );
    const v = await singleFlight("k", async () => 7);
    assert.equal(v, 7);
  });
});

describe("serveLastGood", () => {
  beforeEach(() => {
    resetSingleFlightForTests();
    resetLastGoodQueueForTests();
  });

  it("returns last-good immediately and coalesces the background rebuild", async () => {
    let builds = 0;
    let resolve!: (v: { n: number }) => void;
    const slow = new Promise<{ n: number }>((r) => {
      resolve = r;
    });
    const box: { current: { value: { n: number }; at: number } | null } = {
      current: { value: { n: 1 }, at: Date.now() - 60_000 },
    };
    const serve = () =>
      serveLastGood({
        flightKey: "lg",
        freshTtlMs: 1_000,
        label: "test",
        get: () => box.current,
        build: async () => {
          builds += 1;
          const v = await slow;
          box.current = { value: v, at: Date.now() };
          return v;
        },
      });

    const first = await serve();
    assert.equal(first.n, 1);
    assert.equal(first.stale, true);
    assert.equal(first.fromCache, true);
    assert.equal(first.rebuilding, true);
    assert.match(first.degradedReason ?? "", /last-good/);

    const second = await serve();
    assert.equal(second.n, 1);
    assert.equal(second.stale, true);

    resolve({ n: 2 });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(builds, 1);
    assert.equal(box.current?.value.n, 2);
  });

  it("waits for the first build when there is no last-good", async () => {
    const box: { current: { value: { n: number }; at: number } | null } = {
      current: null,
    };
    const out = await serveLastGood({
      flightKey: "lg-cold",
      freshTtlMs: 1_000,
      label: "test",
      get: () => box.current,
      build: async () => {
        const v = { n: 9 };
        box.current = { value: v, at: Date.now() };
        return v;
      },
    });
    assert.equal(out.n, 9);
    assert.equal(out.stale, false);
    assert.equal(out.rebuilding, false);
  });

  it("force waits for rebuild even when last-good exists", async () => {
    const box: { current: { value: { n: number }; at: number } | null } = {
      current: { value: { n: 1 }, at: Date.now() },
    };
    const out = await serveLastGood({
      flightKey: "lg-force",
      force: true,
      freshTtlMs: 60_000,
      label: "test",
      get: () => box.current,
      build: async () => {
        const v = { n: 3 };
        box.current = { value: v, at: Date.now() };
        return v;
      },
    });
    assert.equal(out.n, 3);
    assert.equal(out.stale, false);
  });

  it("returns an empty rebuilding stub immediately when there is no last-good", async () => {
    let builds = 0;
    const started = Date.now();
    const out = await serveLastGood({
      flightKey: "lg-stub",
      freshTtlMs: 1_000,
      label: "test",
      get: () => null,
      empty: () => ({ n: 0 }),
      build: async () => {
        builds += 1;
        await new Promise((r) => setTimeout(r, 400));
        return { n: 8 };
      },
    });
    assert.ok(Date.now() - started < 80);
    assert.equal(out.n, 0);
    assert.equal(out.rebuilding, true);
    assert.equal(out.stale, true);
    assert.match(out.degradedReason ?? "", /no last-good/);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(builds, 1);
  });

  it("hydrates last-good from disk so reboot first paint does not wait", async () => {
    const prev = process.env.TRADEHOLE_DATA_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "th-lg-"));
    process.env.TRADEHOLE_DATA_DIR = dir;
    try {
      writeLastGood("disk-panel", { n: 11 }, Date.now() - 120_000);
      const mem: { current: { value: { n: number }; at: number } | null } = {
        current: null,
      };
      const out = await serveLastGood({
        flightKey: "lg-disk",
        freshTtlMs: 1_000,
        label: "test",
        persistKey: "disk-panel",
        get: () => mem.current,
        set: (snap) => {
          mem.current = snap;
        },
        empty: () => ({ n: 0 }),
        build: async () => ({ n: 99 }),
      });
      assert.equal(out.n, 11);
      assert.equal(out.fromCache, true);
      assert.equal(out.rebuilding, true);
      assert.equal(mem.current?.value.n, 11);
    } finally {
      if (prev !== undefined) process.env.TRADEHOLE_DATA_DIR = prev;
      else delete process.env.TRADEHOLE_DATA_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ironsightHealth", () => {
  it("fail-fast skips fetch when probe is down", async () => {
    _setIronsightProbeForTests(false);
    assert.equal(ironsightKnownDown(), true);
    const res = await fetchIfIronsightUp("/api/ships", 12_000);
    assert.equal(res, null);
    _setIronsightProbeForTests(null);
  });

  it("panel fetch timeout does not poison host probe", async () => {
    _setIronsightProbeForTests(true);
    assert.equal(ironsightKnownDown(), false);
    // Impossible port — fetch fails; probe must stay up so ELEC/PIKUD aren't
    // falsely "IRONSIGHT offline" when only one panel timed out.
    const prev = process.env.IRONSIGHT_URL;
    process.env.IRONSIGHT_URL = "http://127.0.0.1:1";
    _setIronsightProbeForTests(true);
    const res = await fetchIfIronsightUp("/api/news", 50);
    assert.equal(res, null);
    assert.equal(ironsightKnownDown(), false);
    if (prev === undefined) delete process.env.IRONSIGHT_URL;
    else process.env.IRONSIGHT_URL = prev;
    _setIronsightProbeForTests(null);
  });
});
