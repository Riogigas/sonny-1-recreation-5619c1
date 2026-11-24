// Co-op balance constants. Every tuning number lives here so it can be changed
// in one place instead of hunted across scripts.js.
'use strict';
(function () {
  const F = window.F;
  if (!F) throw new Error('coop-config.js needs as2.js loaded first');
  if (F.coop) return;

  const COOP = F.coop = {};

  COOP.PARTY_MAX = 5;
  COOP.ENEMY_HP_MULT = 1.25;
  COOP.ENEMY_FOCUS_MULT = 1.25;
  COOP.DROP_BONUS_PER_EXTRA_PLAYER = 0.03;
  COOP.DROP_BONUS_CAP = 0.12;
  COOP.SHOP_PRICE_MULT = 2;
  COOP.FOCUS_ON_BASIC_ATTACK = 7;
  COOP.FOCUS_BUFF_TURNS = 3;
  COOP.EXP_FLOOR = 0.33;

  // 1.00 solo -> 0.75 at a full party
  COOP.partyExpFactor = (size) => {
    const extra = Math.max(0, Math.min(COOP.PARTY_MAX, size) - 1);
    return 1 - (0.25 / (COOP.PARTY_MAX - 1)) * extra;
  };

  // anti-farm: 3% less per level over the content, floored at 0.33
  COOP.levelExpFactor = (playerLevel, contentLevel) => {
    const over = Math.max(0, playerLevel - contentLevel);
    return Math.max(COOP.EXP_FLOOR, 1 - 0.03 * over);
  };

  COOP.expMultiplier = (size, playerLevel, contentLevel) =>
    Math.max(COOP.EXP_FLOOR, COOP.partyExpFactor(size) * COOP.levelExpFactor(playerLevel, contentLevel));

  COOP.dropBonus = (size) =>
    Math.min(COOP.DROP_BONUS_CAP, Math.max(0, size - 1) * COOP.DROP_BONUS_PER_EXTRA_PLAYER);

  COOP.shopPrice = (base) => Math.round(base * COOP.SHOP_PRICE_MULT);
})();