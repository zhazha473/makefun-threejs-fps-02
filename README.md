# Dustline Yard — a three.js tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made
famous, built from scratch on three.js 0.187.0. Single-player against bots,
no network, no build step: serve `game/` with any static server and open
`index.html` in desktop Chrome.

## The game

You are Vanguard, the attacker, alone against four Wardens defending a dusk
container yard. Each round you either plant the charge at **Site A**
(north-east, rust orange) or **Site B** (south-east, teal) and defend it
until it detonates, or eliminate all four Wardens. Lose the round if you are
eliminated, time runs out, or a Warden defuses the charge.

- **Gunplay** — three guns (VK-7 Kestrel rifle, Hornet-9 SMG, P9 Sidearm
  pistol) with recoil, spread that grows while moving or spraying, and
  headshots that pay more than body hits. Crouch to tighten your aim.
- **Tactics** — money every round ($300 win / $150 loss, $300 per kill,
  $800 for a plant) spent in the buy menu (B, during freeze time), a
  Spark-9 frag grenade (G), and bots that patrol lanes, hold sites, react
  to gunfire they hear, and run to defuse a planted charge.
- **Map** — "Dustline Yard": two lanes plus a Mid corridor, three
  chokepoints, crates and containers as cover, amber dusk light against
  cool teal shadow.

## Controls

WASD move · mouse look · click fire · R reload · Ctrl/C crouch ·
1/2/3 weapons · B buy menu (freeze time) · G throw grenade ·
E hold to plant (at a site, while carrying the charge).

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

## Layout

- `game/index.html` — page, HUD and the one import map (`three` → vendored three.js)
- `game/src/main.js` — boot + fixed 60 Hz simulation loop, separate from rendering
- `game/src/state.js` — the single state object every module shares
- `game/src/world.js` — the map, AABB collision, sites, waypoints
- `game/src/player.js` — acceleration movement, crouch, mouse look
- `game/src/weapons.js` — the three guns, recoil/spread, buy prices
- `game/src/bots.js` — Warden AI: patrol / hold / engage / defuse
- `game/src/grenades.js` — thrown frag, fuse, area damage
- `game/src/rounds.js` — freeze → live → planted → end, win/loss, money
- `game/src/hud.js` — health, ammo, timer, score, money, buy menu, feed
- `game/src/input.js` — keyboard + pointer lock
- `game/src/audio.js` — WebAudio-synthesized sounds, no audio files
- `game/src/palette.js` — the six-colour look plan
- `main.ts` — the make.fun entry program (copies game/ + screenshots/ to
  /output and writes dossier.json)

## Screenshots

`?shot=start|play|buy|end&seed=1` stages a deterministic frame for capture.

## License

MIT — see LICENSE.
