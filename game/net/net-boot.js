// Boots the deterministic RNG. Seed comes from ?seed= in the URL, otherwise the
// clock. Online sessions will take the seed from the server instead.
'use strict';
(function () {
  const F = window.F;
  const params = new URLSearchParams(location.search);
  const raw = params.get('seed');
  const seed = raw !== null && raw !== '' ? (Number(raw) >>> 0) : (Date.now() >>> 0);

  F.rng.seed(seed);
  F.rng.install();

  F.net = {
    seed,
    online: params.has('online'),
    calls: () => F.rng.calls(),
    matches: (expected) => F.rng.calls() === expected,
  };

  console.info('[net] seed', seed, '| online:', F.net.online);
})();