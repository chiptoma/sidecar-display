// =============================================================================
// UNIT TEST - KEEP-ALIVE DECISION
// Pure logic; no hardware, no BetterDisplay. Runs anywhere.
// -----------------------------------------------------------------------------
// Context: Proves the state machine reconnects a self-dropped link, backs off,
//   slows to a heartbeat (never abandons), re-arms instantly after the Mac
//   sleeps, and never fights a deliberate disconnect.
// =============================================================================

const { decideKeepAlive, stateForIntent, INITIAL_STATE } = require("../.test-build/keepalive");

const TUNING = {
  fastAttempts: 3,
  backoffBaseMs: 1000,
  backoffCapMs: 60_000,
  dormantRetryMs: 900_000,
  wakeGapMs: 180_000,
};
const NOW = 10_000_000;

let failures = 0;

function expect(label, pass, extra = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
  if (!pass) {
    failures += 1;
  }
}

// A recent tick (not a sleep gap), so wake logic stays out of the way by default.
function connectedState(overrides = {}) {
  return { intent: "connected", failedAttempts: 0, lastAttemptAtMs: 0, lastTickAtMs: NOW - 60_000, ...overrides };
}

function decide(overrides) {
  return decideKeepAlive({ ...TUNING, nowMs: NOW, ...overrides });
}

// A deliberate disconnect is never chased.
expect(
  "does nothing when the user wants it disconnected",
  decide({ isConnected: false, state: { ...connectedState(), intent: "disconnected" } }).action === "none",
);

// Already connected: nothing to do, counters cleared.
{
  const d = decide({ isConnected: true, state: connectedState({ failedAttempts: 2 }) });
  expect("no action when already connected", d.action === "none");
  expect("clears failed attempts when connected", d.nextState.failedAttempts === 0);
}

// A link that dropped while wanted is reconnected.
{
  const d = decide({ isConnected: false, state: connectedState() });
  expect("reconnects a link that dropped on its own", d.action === "reconnect");
  expect("counts the attempt", d.nextState.failedAttempts === 1);
}

// Backoff holds the next attempt until the window elapses.
{
  const tried = connectedState({ failedAttempts: 1, lastAttemptAtMs: NOW - 500 });
  expect("waits out the backoff window", decide({ isConnected: false, state: tried }).action === "none");
  const later = connectedState({ failedAttempts: 1, lastAttemptAtMs: NOW - 5000 });
  expect("retries once the backoff window passes", decide({ isConnected: false, state: later }).action === "reconnect");
}

// After the fast burst it slows to a heartbeat but NEVER abandons.
{
  const spent = connectedState({ failedAttempts: 3, lastAttemptAtMs: NOW - 60_000 });
  expect("holds during the slow-heartbeat window", decide({ isConnected: false, state: spent }).action === "none");

  const heartbeatDue = connectedState({ failedAttempts: 3, lastAttemptAtMs: NOW - 1_000_000 });
  const d = decide({ isConnected: false, state: heartbeatDue });
  expect("still retries on the slow heartbeat (never abandons)", d.action === "reconnect");
  expect("keeps counting past the fast burst", d.nextState.failedAttempts === 4);
}

// Waking the Mac (a long gap since the last tick) re-arms an immediate attempt,
// even deep into the dormant phase.
{
  const asleep = connectedState({ failedAttempts: 20, lastAttemptAtMs: NOW - 60_000, lastTickAtMs: NOW - 1_200_000 });
  const d = decide({ isConnected: false, state: asleep });
  expect("reconnects immediately after waking from sleep", d.action === "reconnect");
  expect("wake resets the attempt counter", d.nextState.failedAttempts === 1);
}

// Every decision advances the tick clock, so wake detection works next time.
expect("records the tick time", decide({ isConnected: false, state: connectedState() }).nextState.lastTickAtMs === NOW);

// Manual intent re-arms cleanly.
expect("stateForIntent re-arms connected", stateForIntent("connected").failedAttempts === 0);
expect("initial state starts disconnected", INITIAL_STATE.intent === "disconnected");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
