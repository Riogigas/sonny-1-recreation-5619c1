// Overlays an ONLINE badge on the title screen. The logo itself is vector art
// in movie.json, so this draws text above the canvas instead of rebuilding shapes.
'use strict';
(function () {
  const badge = document.createElement('div');
  badge.id = 'online-badge';
  badge.textContent = 'ONLINE';
  badge.style.cssText = [
    'position:fixed',
    'left:50%',
    'transform:translateX(-50%)',
    'top:62%',
    'z-index:4',
    'pointer-events:none',
    'font:700 22px Verdana,Arial,sans-serif',
    'letter-spacing:6px',
    'color:#9fd08a',
    'text-shadow:0 0 12px rgba(120,200,90,.7),0 2px 0 #14200f',
    'opacity:0',
    'transition:opacity .35s',
  ].join(';');
  document.body.appendChild(badge);

  requestAnimationFrame(() => { badge.style.opacity = '1'; });

  const hide = () => {
    badge.style.opacity = '0';
    document.removeEventListener('pointerdown', hide, true);
  };
  document.addEventListener('pointerdown', hide, true);

  window.onlineBadge = badge;
})();