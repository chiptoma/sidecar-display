// =============================================================================
// UNIT TEST - ORCHESTRATION (mock backend, no hardware)
// -----------------------------------------------------------------------------
// Context: Drives the engine-agnostic orchestration against a scripted mock
//   backend, proving the safety invariants with zero hardware: it never writes
//   the main display, never cycles a display, gates writes on a stable display,
//   declines when the iPad is main, and only changes a mode that differs.
// =============================================================================

const sc = require("../.test-build/sidecar");

let failures = 0;

function expect(label, pass, extra = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
  if (!pass) {
    failures += 1;
  }
}

// A configurable fake engine that records every mutation it is asked to make.
function makeBackend(overrides = {}) {
  const calls = [];
  const base = {
    devices: [{ name: "iPad", uuid: "U1" }],
    connected: true,
    mirror: false, // null = display absent
    ipadMain: false,
  };
  const s = { ...base, ...overrides };
  return {
    calls,
    async listDevices() {
      return s.devices;
    },
    async isConnected() {
      return s.connected;
    },
    async setConnected(_n, c) {
      calls.push(`setConnected:${c}`);
      s.connected = c;
    },
    async readMirror() {
      return s.mirror;
    },
    async isIpadMain() {
      return s.ipadMain;
    },
    async extend() {
      calls.push("extend");
      s.mirror = false;
    },
    async mirrorToMain() {
      calls.push("mirrorToMain");
      s.mirror = true;
    },
  };
}

const cfg = (mode = "extend") => ({ ipadName: "iPad", mode, settleTimeoutMs: 3000 });

async function main() {
  // Already extending, asked to extend: no write at all.
  {
    const b = makeBackend({ mirror: false });
    const out = await sc.ensureDisplayMode(b, cfg("extend"));
    expect("extend when already extended is a no-op", !out.changed && out.settled, JSON.stringify(out));
    expect("no mutations on a no-op", b.calls.length === 0, b.calls.join(","));
  }

  // Mirrored, asked to extend: exactly one extend, no main/cycle calls.
  {
    const b = makeBackend({ mirror: true });
    const out = await sc.ensureDisplayMode(b, cfg("extend"));
    expect("extend when mirrored settles", out.changed && out.settled, JSON.stringify(out));
    expect("only extend was called", b.calls.join(",") === "extend", b.calls.join(","));
  }

  // The iPad is the main display: decline, write nothing.
  {
    const b = makeBackend({ mirror: true, ipadMain: true });
    const out = await sc.ensureDisplayMode(b, cfg("extend"));
    expect("declines when the iPad is main", out.skippedReason !== undefined, JSON.stringify(out));
    expect("no mutations when the iPad is main", b.calls.length === 0, b.calls.join(","));
  }

  // Display absent (mirror reads null): refuse, write nothing.
  {
    const b = makeBackend({ mirror: null });
    let threw = false;
    try {
      await sc.ensureDisplayMode(b, cfg("extend"));
    } catch {
      threw = true;
    }
    expect("refuses an absent display", threw);
    expect("no mutations for an absent display", b.calls.length === 0, b.calls.join(","));
  }

  // Mirror mode when extended: exactly one mirrorToMain.
  {
    const b = makeBackend({ mirror: false });
    const out = await sc.ensureDisplayMode(b, cfg("mirror"));
    expect("mirror mode folds the iPad in", out.changed && out.settled && b.calls.join(",") === "mirrorToMain", b.calls.join(","));
  }

  // Connect when already connected + extending: no link write, no mode write.
  {
    const b = makeBackend({ connected: true, mirror: false });
    const out = await sc.connectSidecar(b, cfg("extend"));
    expect("connect when already connected writes nothing", !out.changed && b.calls.length === 0, b.calls.join(","));
  }

  // Connect when disconnected: link write, then settles the mode.
  {
    const b = makeBackend({ connected: false, mirror: false });
    await sc.connectSidecar(b, cfg("extend"));
    expect("connect brings the link up", b.calls.includes("setConnected:true"), b.calls.join(","));
  }

  // Across every scenario above, no mutation ever touched main or cycled a
  // display — the mock only exposes extend/mirrorToMain/setConnected, so a call
  // to anything else would have thrown. That is the structural guarantee.
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("THREW:", error.message);
  process.exit(1);
});
