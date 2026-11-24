// Co-op balance constants. All tuning lives here.
'use strict';
(function () {
  const F = window.F;
  if (!F) throw new Error('coop-config.js needs as2.js loaded first');
  if (F.coop) return;

  const COOP = F.coop = {};

  COOP.PARTY_MAX = 5;
  COOP.BONUS_PER_EXTRA_PLAYER = 0.05;
  COOP.ENEMY_HP_PER_EXTRA_PLAYER = 0.05;
  COOP.ENEMY_FOCUS_PER_EXTRA_PLAYER = 0.05;
  COOP.DROP_BONUS_PER_EXTRA_PLAYER = 0.03;
  COOP.DROP_BONUS_CAP = 0.12;
  COOP.SHOP_PRICE_MULT = 2;
  COOP.FOCUS_ON_BASIC_ATTACK = 7;
  COOP.FOCUS_BUFF_TURNS = 3;

  const extra = (size) => Math.max(0, Math.min(COOP.PARTY_MAX, size || 1) - 1);

  COOP.partyBonusFactor = (size) => 1 + COOP.BONUS_PER_EXTRA_PLAYER * extra(size);
  COOP.enemyHpMult = (size) => 1 + COOP.ENEMY_HP_PER_EXTRA_PLAYER * extra(size);
  COOP.enemyFocusMult = (size) => 1 + COOP.ENEMY_FOCUS_PER_EXTRA_PLAYER * extra(size);
  COOP.dropBonus = (size) => Math.min(COOP.DROP_BONUS_CAP, COOP.DROP_BONUS_PER_EXTRA_PLAYER * extra(size));
  COOP.shopPrice = (base) => Math.round(base * COOP.SHOP_PRICE_MULT);
})();