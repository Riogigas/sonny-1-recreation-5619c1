# Sonny — JavaScript recreation

A JavaScript port of Krin's *Sonny* (Armor Games, 2008, Flash/AS2). It runs the original art, sounds and game logic in a small Flash-compatible runtime written in plain JS (Canvas 2D and WebAudio). No plugins are needed.

## Play

Serve the folder with any static web server and open `index.html`:

```
npx serve .        # or: python -m http.server
```

Opening the file directly (`file://`) won't work because the game data is loaded with `fetch`. Saves go to `localStorage`, using the original four slots.

## Layout

| Path | Contents |
| --- | --- |
| `index.html` | Entry point, asset loader and mute button |
| `game/engine/` | Runtime: `as2.js` (AVM1 globals: Math, Key, Mouse, SharedObject, Sound, Color…), `display.js` (display list and timelines), `render.js` (Canvas 2D vector/bitmap renderer, filters, color transforms), `text.js` (text fields), `audio.js` (WebAudio event and stream sounds), `player.js` (frame loop, action queue, input) |
| `game/js/scripts.js` | The game's ActionScript, transpiled to JS |
| `game/data/movie.json` | Shapes, sprites, timelines, buttons and fonts |
| `game/img/`, `game/snd/` | Extracted bitmaps (PNG) and sounds (MP3) |
| `tools/` | Build pipeline |

## Rebuilding from the SWF

```
cd tools && npm install
node build.js [path\to\sonny.swf]                    # SWF -> game/data, game/img, game/snd
node transpile.js <ffdec-export>\scripts [sonny.swf]  # AS2 -> game/js/scripts.js
```

`transpile.js` reads the AS2 sources exported by JPEXS FFDec (`ffdec -export script <dir> sonny.swf`).
