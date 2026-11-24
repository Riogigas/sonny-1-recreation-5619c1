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
    partySize: Math.max(1, Math.min(5, Number(params.get('party')) || 1)),
    calls: () => F.rng.calls(),
    matches: (expected) => F.rng.calls() === expected,
krin: () => F.player.root.$.scope.Krin,
    exp: () => F.player.root.$.scope.Krin?.totalXP,
  };

  console.info('[net] seed', seed, '| online:', F.net.online);
    const attach = setInterval(() => {
    if (!F.player || !F.player.root || !F.player.root.$.scope) return;
    clearInterval(attach);
    const sc = F.player.root.$.scope;
    sc.coopExpMult = F.coop.partyBonusFactor(F.net.partySize);
    sc.partyBonus = F.coop.partyBonusFactor(F.net.partySize);
    sc.enemyHpMult = F.coop.enemyHpMult(F.net.partySize);
    sc.enemyFocusMult = F.coop.enemyFocusMult(F.net.partySize);
  }, 50);
})();