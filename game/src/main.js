// Dustline Yard — boot and the one loop. A fixed 60 Hz simulation (accumulator)
// feeds rendering at the display rate; rendering never writes game state.
// ?shot=start|play|buy|end&seed=N stages a deterministic frame for capture,
// renders it, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, PHASE, drainEvents } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const isShot = !!shot;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

const state = createState();
state.seed = seed;
const audio = createAudio();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud(state);
const player = createPlayer(scene, camera, world.colliders, state);
const weapons = createWeapons(camera, state, audio);
const bots = createBots(scene, world, state, audio);
const grenades = createGrenades(scene, state, audio);
const rounds = createRounds(state, audio);
const input = createInput(renderer.domElement, () => {});
bots.init();

const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const shootTargets = world.shootables.concat(bots.hitMeshes);
const tracers = [];   // { line, life }
const flashes = [];   // grenade flash meshes { mesh, life, max }
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffc25c, transparent: true, opacity: 0.9 });
let plantProgress = 0;
let buyOpen = false;
let frozen = false;
let shotFrames = 0;

const tmpOrigin = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

function nearSite() {
  const p = player.body.pos;
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) return s;
  }
  return null;
}

function damagePlayer(amount, from) {
  player.damage(amount, from);
  audio.hurt();
}

function onBotKilled(bot) {
  state.kills += 1;
  state.roundKills += 1;
  state.money += 300;
  audio.kill();
  hud.feed(`You eliminated ${bot.name} (+$300)`, 'kill');
  hud.hitmarker(true);
}

function fireShot(shotInfo) {
  const { def, spread } = shotInfo;
  camera.getWorldPosition(tmpOrigin);
  camera.getWorldDirection(tmpDir);
  // Spread: random cone around the view direction.
  tmpDir.x += (rng() - 0.5) * 2 * spread;
  tmpDir.y += (rng() - 0.5) * 2 * spread;
  tmpDir.z += (rng() - 0.5) * 2 * spread;
  tmpDir.normalize();
  player.body.pitch += def.recoil * 0.6; // recoil kicks the view up
  raycaster.set(tmpOrigin, tmpDir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootTargets, false);
  const end = tmpOrigin.clone().addScaledVector(tmpDir, def.range);
  if (hits.length > 0) {
    const hit = hits[0];
    end.copy(hit.point);
    const ud = hit.object.userData;
    if (ud && ud.bot && ud.bot.alive) {
      const isHead = ud.part === 'head';
      const dmg = def.damage * (isHead ? def.headMult : 1);
      const killed = bots.damage(ud.bot, dmg, ud.part);
      audio.hit();
      hud.hitmarker(killed);
      hud.feed(killed ? `You eliminated ${ud.bot.name} (+$300)` : `Hit ${ud.bot.name} — ${Math.round(dmg)}${isHead ? ' HEADSHOT' : ''}`, killed ? 'kill' : '');
      if (killed) onBotKilled(ud.bot);
    }
  }
  // Tracer line from the muzzle to the impact point.
  const muzzle = tmpOrigin.clone().addScaledVector(tmpDir, 0.8);
  muzzle.y -= 0.12; muzzle.x += 0.18;
  const geo = new THREE.BufferGeometry().setFromPoints([muzzle, end]);
  const line = new THREE.Line(geo, tracerMat.clone());
  scene.add(line);
  tracers.push({ line, life: 0.06 });
  bots.hearShot(player.body.pos.x, player.body.pos.z);
}

function throwGrenade() {
  if (weapons.loadout.grenades <= 0) return;
  weapons.loadout.grenades -= 1;
  camera.getWorldPosition(tmpOrigin);
  camera.getWorldDirection(tmpDir);
  grenades.throwGrenade(tmpOrigin.clone().addScaledVector(tmpDir, 0.6), tmpDir.clone());
}

// One fixed simulation step.
function step(dt) {
  state.time += dt;
  input.poll(state);
  const inp = state.input;

  if (state.phase === PHASE.MENU) return;

  // Buy menu: B toggles during freeze; digit keys buy instead of switching.
  if (inp.buy && state.phase === PHASE.FREEZE) {
    buyOpen = !buyOpen;
    hud.setBuy(buyOpen, weapons);
  }
  if (buyOpen && state.phase === PHASE.FREEZE) {
    if (inp.weaponSlot === 1) { if (!weapons.buy('rifle')) weapons.switchTo('rifle'); inp.weaponSlot = 0; }
    if (inp.weaponSlot === 2) { if (!weapons.buy('smg')) weapons.switchTo('smg'); inp.weaponSlot = 0; }
    if (inp.weaponSlot === 3) { weapons.switchTo('pistol'); inp.weaponSlot = 0; }
    if (inp.grenade) { weapons.buyGrenade(); hud.renderBuy(weapons); inp.grenade = false; }
  }

  const stepped = player.step(dt, inp);
  if (stepped) audio.step();

  const live = state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED;
  const shotInfo = weapons.step(dt, inp, player.body, live);
  if (shotInfo && (input.state.locked || isShot)) fireShot(shotInfo);
  if (inp.grenade && live) {
    throwGrenade();
    inp.grenade = false;
  }

  if (state.phase !== PHASE.FREEZE) {
    bots.step(dt, { playerBody: player.body, raycaster, shootables: world.shootables, damagePlayer });
  }
  grenades.step(dt, {
    playerBody: player.body, bots, damagePlayer, flashes,
    onBotKilled,
  });
  plantProgress = rounds.plantStep(dt, { nearSite, input: inp, playerBody: player.body }, plantProgress);
  rounds.step(dt, { playerBody: player.body, bots });
  world.update(dt, state.time);

  // Drain one-shot events into HUD + audio.
  for (const e of drainEvents(state)) {
    if (e.type === 'roundStart') {
      player.reset(world.playerSpawn);
      bots.resetAll();
      weapons.resetRound();
      grenades.clear();
      state.bombCarrier = true;
      buyOpen = false;
      hud.setBuy(false, weapons);
      hud.el.overlay.hidden = true;
      plantProgress = 0;
    } else if (e.type === 'roundEnd') {
      hud.showRoundEnd(e);
    } else if (e.type === 'defused') {
      rounds.endRound(false, `Charge defused by ${e.bot}`);
    } else if (e.type === 'planted') {
      hud.feed(`Charge planted at Site ${e.site} (+$800)`, 'kill');
    } else if (e.type === 'botDown') {
      // handled via onBotKilled / grenade path
    }
  }
  hud.setPlant(plantProgress, nearSite() ? nearSite().label : '');
}

// ---- Shot staging: deterministic frames for screenshots ----
function stageShot() {
  const spawn = world.playerSpawn;
  if (shot === 'start') {
    player.reset(spawn);
    hud.showStart();
  } else if (shot === 'buy') {
    player.reset(spawn);
    rounds.startRound();
    state.money = 2700;
    buyOpen = true;
    hud.setBuy(true, weapons);
    hud.el.overlay.hidden = true;
  } else if (shot === 'play') {
    player.reset(spawn);
    rounds.startRound();
    state.phase = PHASE.LIVE;
    state.roundTime = 78;
    state.money = 2700;
    weapons.buy('rifle');
    weapons.switchTo('rifle');
    weapons.loadout.grenades = 1;
    // Put the player mid-yard, aiming at a Warden in the open.
    player.body.pos.set(-4, 0, -2);
    player.body.yaw = -Math.PI / 2;
    player.body.pitch = 0.0;
    const b = bots.bots[0];
    b.pos.set(3.5, 0, -2.4); b.yaw = Math.PI / 2; b.mode = 'engage';
    b.lastSeen = { x: -4, z: -2, t: 0 };
    bots.bots[1].pos.set(9, 0, -6.5);
    bots.bots[2].pos.set(13, 0, 3);
    for (const bot of bots.bots) {
      bot.mesh.group.position.set(bot.pos.x, 0, bot.pos.z);
      bot.mesh.group.rotation.y = bot.yaw;
    }
    hud.el.overlay.hidden = true;
  } else if (shot === 'end') {
    player.reset(spawn);
    rounds.startRound();
    state.phase = PHASE.END;
    state.roundTime = 5;
    state.score.attack = 1;
    state.roundResult = { win: true, reason: 'All Wardens eliminated' };
    hud.showRoundEnd(state.roundResult);
  }
  // Render a few frames so shadows/HUD settle, then freeze.
  for (let i = 0; i < 3; i++) {
    player.step(0, state.input);
    weapons.render(0.016, 1, player.body);
    renderer.render(scene, camera);
  }
  hud.update(0.016, player.body, weapons);
  frozen = true;
  window.__shotReady = true;
}

// ---- Main loop ----
let last = performance.now();
let accumulator = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  if (isShot && shotFrames === 0) {
    stageShot();
    shotFrames = 1;
    return;
  }
  accumulator += dt;
  let n = 0;
  while (accumulator >= FIXED_STEP && n < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    n += 1;
  }
  // Render: viewmodel motion + tracers + flashes decay here, never in step().
  weapons.render(dt, state.time, player.body);
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    tracers[i].line.material.opacity = Math.max(0, tracers[i].life / 0.06) * 0.9;
    if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.life -= dt;
    f.mesh.scale.setScalar(0.5 + (1 - f.life / f.max) * 8);
    f.mesh.material.opacity = Math.max(0, f.life / f.max) * 0.9;
    if (f.life <= 0) { scene.remove(f.mesh); flashes.splice(i, 1); }
  }
  hud.update(dt, player.body, weapons);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('play').addEventListener('click', () => {
  audio.unlock();
  input.requestLock();
  if (state.phase === PHASE.MENU) {
    hud.el.overlay.hidden = true;
    rounds.startRound();
  } else {
    hud.el.overlay.hidden = true;
  }
});

hud.showStart();
window.__game = { state, player, bots, weapons, world };
// Debug handle: raycast exactly as fireShot does, from the live camera.
window.__game.debugRaycast = () => {
  camera.getWorldPosition(tmpOrigin);
  camera.getWorldDirection(tmpDir);
  raycaster.set(tmpOrigin, tmpDir);
  raycaster.far = 100;
  const hits = raycaster.intersectObjects(shootTargets, false);
  return {
    origin: tmpOrigin.toArray().map((v) => +v.toFixed(2)),
    dir: tmpDir.toArray().map((v) => +v.toFixed(3)),
    pitch: +player.body.pitch.toFixed(3),
    yaw: +player.body.yaw.toFixed(3),
    firstHit: hits.length ? {
      d: +hits[0].distance.toFixed(2),
      part: hits[0].object.userData && hits[0].object.userData.part,
      point: hits[0].point.toArray().map((v) => +v.toFixed(2)),
    } : null,
    bot0: { pos: [bots.bots[0].pos.x, bots.bots[0].pos.z].map((v) => +v.toFixed(2)), mode: bots.bots[0].mode, hp: bots.bots[0].health },
  };
};
requestAnimationFrame(frame);
