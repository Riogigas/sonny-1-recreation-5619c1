// Seeded deterministic RNG. This is the gate for all multiplayer: two clients
// given the same seed and the same call order must roll identical numbers.
// Nothing changes by default -- F.rng.install() is opt-in.
'use strict';
(function () {
  const F = window.F;
  if (!F) throw new Error('rng.js needs as2.js loaded first');
  if (F.rng) return;

  const nativeMathRandom = Math.random;
  const nativeRandomFn = window.random;

  let state = 0x9E3779B9 | 0;
  let calls = 0;
  let installed = false;

  // mulberry32
  function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    calls++;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // AS2 random(n) semantics: integer 0..n-1
  function int(n) {
    if (!n || n < 1) return 0;
    return Math.floor(next() * n);
  }

  function seed(n) {
    state = ((n >>> 0) | 0) || 0x9E3779B9;
    calls = 0;
    return state;
  }

  function snapshot() { return { state, calls }; }

  function restore(snap) {
    state = snap.state | 0;
    calls = snap.calls | 0;
  }

  function install() {
    if (installed) return;
    installed = true;
    Math.random = next;
    window.random = int;
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    Math.random = nativeMathRandom;
    window.random = nativeRandomFn;
  }

  // Proves two streams from the same seed match. Run F.rng.selfTest() in console.
  function selfTest(seedValue) {
    seed(seedValue || 12345);
    const a = [next(), next(), int(100), next()];
    const afterA = calls;
    seed(seedValue || 12345);
    const b = [next(), next(), int(100), next()];
    const ok = a.every((v, i) => v === b[i]) && calls === afterA;
    seed(seedValue || 12345);
    return { ok, sample: a };
  }

  F.rng = {
    next, int, seed, snapshot, restore, install, uninstall, selfTest,
    calls: () => calls,
    isInstalled: () => installed,
  };
})();