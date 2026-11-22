// The Velvet Vault — top-down stealth heist, one museum room.
// Canvas 2D only, no external assets, no network. Play offline.
(() => {
  "use strict";
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = 960, H = 640;
  const WALL = 36; // room border thickness

  const params = new URLSearchParams(location.search);
  const shot = params.get("shot") || "start";

  // ---- room layout: cover that blocks movement and sight ----
  // Each obstacle: {x, y, w, h, kind} — kind "column" (marble) or "case" (display case).
  const obstacles = [
    { x: 250, y: 150, w: 46, h: 46, kind: "column" },
    { x: 480, y: 130, w: 46, h: 46, kind: "column" },
    { x: 690, y: 210, w: 46, h: 46, kind: "column" },
    { x: 330, y: 380, w: 46, h: 46, kind: "column" },
    { x: 580, y: 400, w: 46, h: 46, kind: "column" },
    { x: 180, y: 250, w: 110, h: 52, kind: "case" },
    { x: 420, y: 290, w: 120, h: 52, kind: "case" },
    { x: 700, y: 420, w: 120, h: 52, kind: "case" },
    { x: 200, y: 470, w: 110, h: 52, kind: "case" },
  ];
  const idol = { x: 838, y: 118, r: 16 };
  const pedestal = { x: 800, y: 84, w: 76, h: 68 };
  const exitZone = { x: 76, y: 66, w: 104, h: 72 }; // glowing skylight, top-left

  // ---- state ----
  const startPos = { x: 130, y: 560 };
  const state = {
    player: { x: startPos.x, y: startPos.y, r: 13, sneaking: false },
    alarm: 0, hasLoot: false, pellets: 1, smokeUntil: 0,
    time: 0, won: false, caught: false, caughtAt: 0, flash: 0,
    message: "Steal the golden idol. Stay out of the cones.",
  };

  function makeGuards() {
    return [
      { // patrols the middle gallery horizontally
        x: 300, y: 240, r: 13, speed: 62, dir: 1, axis: "x",
        min: 240, max: 700, angle: 0, range: 175, color: "#2b3a55",
      },
      { // patrols the lower gallery vertically
        x: 640, y: 480, r: 13, speed: 52, dir: -1, axis: "y",
        min: 330, max: 560, angle: -Math.PI / 2, range: 165, color: "#3a2b55",
      },
    ];
  }
  function makeCameras() {
    return [
      { x: 480, y: WALL + 6, base: Math.PI / 2, sweep: 0.85, speed: 0.55, phase: 0, range: 225 },
      { x: 900, y: 320, base: Math.PI, sweep: 0.7, speed: 0.42, phase: 1.6, range: 215 },
    ];
  }
  let guards = makeGuards();
  let cameras = makeCameras();

  // ---- shot presets (for screenshots) ----
  if (shot === "loot") {
    state.player.x = 760; state.player.y = 200;
    guards[0].x = 560; guards[0].y = 240; guards[0].angle = 0;
    guards[1].x = 640; guards[1].y = 430; guards[1].angle = Math.PI / 2;
    cameras[0].phase = 0.9; cameras[1].phase = 0.4;
    state.time = 47.3;
    state.message = "Almost there — the idol is on its pedestal.";
  } else if (shot === "alarm") {
    state.player.x = 520; state.player.y = 250; state.player.sneaking = true;
    state.alarm = 92;
    guards[0].x = 430; guards[0].y = 240; guards[0].angle = 0;
    state.time = 61.8;
    state.message = "SPOTTED! Break line of sight — now!";
  } else if (shot === "win") {
    state.hasLoot = true; state.won = true; state.time = 83.4;
    state.player.x = 128; state.player.y = 102;
    state.message = "Clean getaway.";
  }

  // ---- input ----
  const keys = {};
  addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === "q" || e.key === "Q") useSmokePellet();
    if (e.key === "r" || e.key === "R") resetRoom();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  function resetRoom() {
    state.player.x = startPos.x; state.player.y = startPos.y;
    state.alarm = 0; state.hasLoot = false; state.pellets = 1;
    state.smokeUntil = 0; state.time = 0; state.won = false;
    state.caught = false; state.flash = 0;
    state.message = "Steal the golden idol. Stay out of the cones.";
    guards = makeGuards(); cameras = makeCameras();
  }

  // ---- geometry helpers ----
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }
  function segHitsRect(x1, y1, x2, y2, r) {
    // Slab test: does segment (x1,y1)-(x2,y2) cross rect r?
    const dx = x2 - x1, dy = y2 - y1;
    let tmin = 0, tmax = 1;
    for (const [p, q] of [[-dx, x1 - r.x], [dx, r.x + r.w - x1], [-dy, y1 - r.y], [dy, r.y + r.h - y1]]) {
      if (p === 0) { if (q < 0) return false; }
      else {
        const t = q / p;
        if (p < 0) { if (t > tmax) return false; if (t > tmin) tmin = t; }
        else { if (t < tmin) return false; if (t < tmax) tmax = t; }
      }
    }
    return true;
  }
  function cover(x1, y1, x2, y2) {
    // True when any obstacle blocks the sight line — crouch behind it and cones can't see you.
    for (const o of obstacles) if (segHitsRect(x1, y1, x2, y2, o)) return true;
    return false;
  }
  function collides(x, y, r) {
    if (x - r < WALL || x + r > W - WALL || y - r < WALL || y + r > H - WALL) return true;
    for (const o of obstacles) {
      const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h);
      if (dist(x, y, cx, cy) < r) return true;
    }
    // Pedestal blocks walking (the idol is grabbed from its edge).
    const px = clamp(x, pedestal.x, pedestal.x + pedestal.w);
    const py = clamp(y, pedestal.y, pedestal.y + pedestal.h);
    if (dist(x, y, px, py) < r) return true;
    return false;
  }

  // ---- vision ----
  function smokeActive(now) { return now < state.smokeUntil; }
  function inCone(ox, oy, angle, range, halfAngle, px, py, now) {
    if (smokeActive(now)) return false;
    const d = dist(ox, oy, px, py);
    if (d > range || d < 1) return false;
    if (Math.abs(normAngle(angleTo(ox, oy, px, py) - angle)) > halfAngle) return false;
    if (cover(ox, oy, px, py)) return false;
    return true;
  }
  function visionCone(guard, now) {
    const range = state.player.sneaking ? guard.range * 0.78 : guard.range;
    return inCone(guard.x, guard.y, guard.angle, range, 0.55, state.player.x, state.player.y, now);
  }
  function cameraSweep(cam, now) {
    const angle = cam.base + Math.sin(now * cam.speed + cam.phase) * cam.sweep;
    const seen = inCone(cam.x, cam.y, angle, cam.range, 0.42, state.player.x, state.player.y, now);
    return { angle, seen };
  }
  function anyWatcherSees(now) {
    if (smokeActive(now)) return false;
    for (const g of guards) if (visionCone(g, now)) return true;
    for (const c of cameras) if (cameraSweep(c, now).seen) return true;
    return false;
  }

  // ---- alarm meter ----
  function alarmMeter(dt, now) {
    if (state.won || state.caught) return;
    if (anyWatcherSees(now)) {
      const rate = state.player.sneaking ? 30 : 48;
      state.alarm = clamp(state.alarm + rate * dt, 0, 100);
      state.message = "SPOTTED! Break line of sight — now!";
      if (state.alarm >= 100) {
        state.caught = true; state.caughtAt = now; state.flash = 1;
        state.message = "ALARM! The room resets — press R.";
      }
    } else {
      // Unseen is a chance to recover; under smoke the meter drains twice as fast.
      const drain = smokeActive(now) ? 40 : 20;
      state.alarm = clamp(state.alarm - drain * dt, 0, 100);
      if (state.alarm < 1 && !state.hasLoot) state.message = "Steal the golden idol. Stay out of the cones.";
      if (state.alarm < 1 && state.hasLoot) state.message = "Got it! Reach the glowing skylight exit.";
    }
  }

  // ---- patrol ----
  function patrol(g, dt) {
    if (state.won || state.caught) return;
    if (g.axis === "x") {
      g.x += g.speed * g.dir * dt;
      if (g.x > g.max) { g.x = g.max; g.dir = -1; }
      if (g.x < g.min) { g.x = g.min; g.dir = 1; }
      g.angle = g.dir > 0 ? 0 : Math.PI;
    } else {
      g.y += g.speed * g.dir * dt;
      if (g.y > g.max) { g.y = g.max; g.dir = -1; }
      if (g.y < g.min) { g.y = g.min; g.dir = 1; }
      g.angle = g.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  // ---- smoke pellet: one tool, at a cost ----
  function useSmokePellet() {
    if (state.won || state.caught || state.pellets <= 0) return;
    state.pellets -= 1;
    state.smokeUntil = state.time + 4;
    state.message = "Smoke! Every cone is blind for 4 seconds — move!";
  }

  // ---- loot + exit ----
  function loot(now) {
    if (!state.hasLoot && dist(state.player.x, state.player.y, idol.x, idol.y) < 34) {
      state.hasLoot = true;
      state.message = "Got it! Reach the glowing skylight exit.";
    }
  }
  function exit(now) {
    if (!state.hasLoot || state.won) return;
    const p = state.player;
    if (p.x > exitZone.x && p.x < exitZone.x + exitZone.w && p.y > exitZone.y && p.y < exitZone.y + exitZone.h) {
      state.won = true;
      state.message = "Clean getaway.";
    }
  }

  // ---- movement ----
  function movePlayer(dt) {
    if (state.won || state.caught) return;
    let dx = (keys["d"] || keys["arrowright"] ? 1 : 0) - (keys["a"] || keys["arrowleft"] ? 1 : 0);
    let dy = (keys["s"] || keys["arrowdown"] ? 1 : 0) - (keys["w"] || keys["arrowup"] ? 1 : 0);
    if (!dx && !dy) { state.player.sneaking = !!keys["shift"]; return; }
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    state.player.sneaking = !!keys["shift"];
    const speed = state.player.sneaking ? 95 : 185;
    const nx = state.player.x + dx * speed * dt;
    const ny = state.player.y + dy * speed * dt;
    if (!collides(nx, state.player.y, state.player.r)) state.player.x = nx;
    if (!collides(state.player.x, ny, state.player.r)) state.player.y = ny;
  }

  // ---- rendering ----
  function drawFloor() {
    ctx.fillStyle = "#191627"; ctx.fillRect(0, 0, W, H);
    // marble tiles
    ctx.strokeStyle = "rgba(255,255,255,0.045)"; ctx.lineWidth = 1;
    for (let x = WALL; x <= W - WALL; x += 48) { ctx.beginPath(); ctx.moveTo(x, WALL); ctx.lineTo(x, H - WALL); ctx.stroke(); }
    for (let y = WALL; y <= H - WALL; y += 48) { ctx.beginPath(); ctx.moveTo(WALL, y); ctx.lineTo(W - WALL, y); ctx.stroke(); }
    // red carpet runner down the middle
    ctx.fillStyle = "#5e1f24"; ctx.fillRect(430, WALL, 100, H - 2 * WALL);
    ctx.fillStyle = "#7a2a30"; ctx.fillRect(438, WALL, 84, H - 2 * WALL);
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 2; ctx.strokeRect(438, WALL, 84, H - 2 * WALL);
    // wall trim + paintings
    ctx.fillStyle = "#241f33"; ctx.fillRect(0, 0, W, WALL); ctx.fillRect(0, H - WALL, W, WALL);
    ctx.fillStyle = "#241f33"; ctx.fillRect(0, 0, WALL, H); ctx.fillRect(W - WALL, 0, WALL, H);
    ctx.strokeStyle = "#6b5a2e"; ctx.lineWidth = 2; ctx.strokeRect(2, 2, W - 4, H - 4);
    const paintings = [[150, 8, 90, 20], [330, 8, 70, 20], [620, 8, 90, 20], [790, 8, 70, 20]];
    for (const [x, y, w, h] of paintings) {
      ctx.fillStyle = "#3d2f16"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#c9a227"; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#8a6d3b"; ctx.fillRect(x + 8, y + 5, w - 16, h - 10);
    }
  }
  function drawExit(now) {
    const pulse = 0.55 + 0.25 * Math.sin(now * 2.2);
    const g = ctx.createRadialGradient(128, 102, 8, 128, 102, 110);
    g.addColorStop(0, `rgba(255, 240, 170, ${pulse})`);
    g.addColorStop(1, "rgba(255, 240, 170, 0)");
    ctx.fillStyle = g; ctx.fillRect(20, 20, 220, 170);
    ctx.fillStyle = "#ffe9a8"; ctx.fillRect(exitZone.x, exitZone.y, exitZone.w, exitZone.h);
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 3; ctx.strokeRect(exitZone.x, exitZone.y, exitZone.w, exitZone.h);
    ctx.fillStyle = "#5a4a12"; ctx.font = "bold 13px Georgia"; ctx.textAlign = "center";
    ctx.fillText("SKYLIGHT EXIT", 128, 106);
  }
  function drawObstacles() {
    for (const o of obstacles) {
      if (o.kind === "column") {
        ctx.fillStyle = "#8f8a9e"; ctx.beginPath(); ctx.arc(o.x + 23, o.y + 23, 24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#b9b4c8"; ctx.beginPath(); ctx.arc(o.x + 23, o.y + 23, 17, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6f6a80"; ctx.beginPath(); ctx.arc(o.x + 23, o.y + 23, 8, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#2e2a3e"; ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#4a4460"; ctx.fillRect(o.x + 5, o.y + 5, o.w - 10, o.h - 10);
        ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 1.5; ctx.strokeRect(o.x + 5, o.y + 5, o.w - 10, o.h - 10);
        ctx.fillStyle = "#d8c98a"; ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function drawIdol(now) {
    if (state.hasLoot) return;
    const glow = 0.5 + 0.3 * Math.sin(now * 3);
    const g = ctx.createRadialGradient(idol.x, idol.y, 4, idol.x, idol.y, 52);
    g.addColorStop(0, `rgba(255, 215, 90, ${glow})`); g.addColorStop(1, "rgba(255, 215, 90, 0)");
    ctx.fillStyle = g; ctx.fillRect(idol.x - 52, idol.y - 52, 104, 104);
    ctx.fillStyle = "#3a2f16"; ctx.fillRect(pedestal.x, pedestal.y, pedestal.w, pedestal.h);
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 2; ctx.strokeRect(pedestal.x, pedestal.y, pedestal.w, pedestal.h);
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath(); ctx.moveTo(idol.x, idol.y - 14); ctx.lineTo(idol.x + 11, idol.y + 8);
    ctx.lineTo(idol.x, idol.y + 14); ctx.lineTo(idol.x - 11, idol.y + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff3b0"; ctx.beginPath(); ctx.arc(idol.x, idol.y - 4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e8d27a"; ctx.font = "bold 11px Georgia"; ctx.textAlign = "center";
    ctx.fillText("GOLDEN IDOL", idol.x, pedestal.y + pedestal.h + 16);
  }
  function drawCone(ox, oy, angle, range, halfAngle, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, range, angle - halfAngle, angle + halfAngle); ctx.closePath(); ctx.fill();
  }
  function drawGuards(now) {
    const blind = smokeActive(now);
    for (const g of guards) {
      const seen = visionCone(g, now);
      drawCone(g.x, g.y, g.angle, state.player.sneaking ? g.range * 0.78 : g.range, 0.55,
        blind ? "rgba(160,160,170,0.10)" : seen ? "rgba(255,60,60,0.30)" : "rgba(255,220,110,0.20)");
      ctx.fillStyle = g.color; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d8d2e8"; ctx.beginPath(); ctx.arc(g.x, g.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#0e0c16"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(g.x + Math.cos(g.angle) * 18, g.y + Math.sin(g.angle) * 18); ctx.stroke();
      if (seen) { ctx.fillStyle = "#ff4444"; ctx.font = "bold 12px Georgia"; ctx.textAlign = "center"; ctx.fillText("!", g.x, g.y - 20); }
    }
  }
  function drawCameras(now) {
    const blind = smokeActive(now);
    for (const c of cameras) {
      const { angle, seen } = cameraSweep(c, now);
      drawCone(c.x, c.y, angle, c.range, 0.42,
        blind ? "rgba(160,160,170,0.10)" : seen ? "rgba(255,60,60,0.28)" : "rgba(120,200,255,0.16)");
      ctx.fillStyle = "#22202e"; ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = seen ? "#ff4444" : "#57c8ff"; ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#57c8ff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(angle) * 16, c.y + Math.sin(angle) * 16); ctx.stroke();
    }
  }
  function drawPlayer(now) {
    const p = state.player;
    if (smokeActive(now)) {
      ctx.fillStyle = "rgba(200,200,210,0.35)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 46, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#101018"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e8d27a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#e8d27a"; ctx.beginPath(); ctx.arc(p.x, p.y - 3, 4, 0, Math.PI * 2); ctx.fill();
    if (p.sneaking) { ctx.fillStyle = "#b8ad8a"; ctx.font = "10px Georgia"; ctx.textAlign = "center"; ctx.fillText("sneaking", p.x, p.y + 26); }
    if (state.hasLoot) {
      ctx.fillStyle = "#ffd75e"; ctx.beginPath(); ctx.arc(p.x + 12, p.y - 10, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawHUD() {
    ctx.fillStyle = "rgba(8,8,16,0.82)"; ctx.fillRect(0, H - 44, W, 44);
    ctx.fillStyle = "#e8d27a"; ctx.font = "bold 15px Georgia"; ctx.textAlign = "left";
    ctx.fillText(state.hasLoot ? "LOOT: ★ Golden Idol" : "LOOT: — find the idol", 16, H - 16);
    // alarm meter
    ctx.fillStyle = "#3a2a2a"; ctx.fillRect(300, H - 32, 220, 16);
    ctx.fillStyle = state.alarm > 70 ? "#ff4444" : state.alarm > 35 ? "#ffaa33" : "#57c857";
    ctx.fillRect(300, H - 32, 220 * state.alarm / 100, 16);
    ctx.strokeStyle = "#e8d27a"; ctx.lineWidth = 1.5; ctx.strokeRect(300, H - 32, 220, 16);
    ctx.fillStyle = "#e8d27a"; ctx.font = "bold 13px Georgia";
    ctx.fillText("ALARM", 248, H - 19);
    ctx.fillText(`PELLET ×${state.pellets}`, 545, H - 16);
    const t = state.time, mm = String(Math.floor(t / 60)).padStart(2, "0"), ss = String(Math.floor(t % 60)).padStart(2, "0");
    ctx.fillText(`TIME ${mm}:${ss}`, 680, H - 16);
    ctx.fillText("The Velvet Vault", 840, H - 16);
    // objective line — on a dark pill below the top wall, clear of the paintings
    ctx.font = "14px Georgia"; ctx.textAlign = "center";
    const mw = ctx.measureText(state.message).width;
    ctx.fillStyle = "rgba(8,8,16,0.75)";
    ctx.fillRect(W / 2 - mw / 2 - 12, 44, mw + 24, 24);
    ctx.fillStyle = state.alarm > 70 ? "#ff8888" : "#e8dcc0";
    ctx.fillText(state.message, W / 2, 61);
  }
  function drawWinCard() {
    ctx.fillStyle = "rgba(8,8,16,0.78)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#14121f"; ctx.fillRect(230, 170, 500, 300);
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 3; ctx.strokeRect(230, 170, 500, 300);
    ctx.fillStyle = "#ffd75e"; ctx.font = "bold 34px Georgia"; ctx.textAlign = "center";
    ctx.fillText("★ CLEAN GETAWAY ★", W / 2, 240);
    ctx.fillStyle = "#e8e2c8"; ctx.font = "18px Georgia";
    ctx.fillText("You stole the Golden Idol and slipped out", W / 2, 290);
    ctx.fillText("through the skylight. The museum never", W / 2, 318);
    ctx.fillText("knew you were there.", W / 2, 346);
    const t = state.time, mm = String(Math.floor(t / 60)).padStart(2, "0"), ss = String(Math.floor(t % 60)).padStart(2, "0");
    ctx.fillStyle = "#e8d27a"; ctx.font = "bold 20px Georgia";
    ctx.fillText(`Escape time ${mm}:${ss}   •   Never caught`, W / 2, 400);
    ctx.fillStyle = "#b8ad8a"; ctx.font = "14px Georgia";
    ctx.fillText("Press R to run it again", W / 2, 440);
  }
  function drawCaughtFlash() {
    if (state.flash <= 0) return;
    ctx.fillStyle = `rgba(255,40,40,${state.flash * 0.35})`; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px Georgia"; ctx.textAlign = "center";
    ctx.fillText("ALARM!", W / 2, H / 2 - 10);
    ctx.font = "18px Georgia"; ctx.fillText("The guards sweep the room — press R to try again", W / 2, H / 2 + 24);
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);
    drawFloor();
    drawExit(now);
    drawObstacles();
    drawIdol(now);
    drawGuards(now);
    drawCameras(now);
    drawPlayer(now);
    drawHUD();
    if (state.won) drawWinCard();
    drawCaughtFlash();
  }

  // Posed shots (loot / alarm / win) freeze the simulation so the
  // screenshot holds the staged moment instead of playing past it.
  const posed = shot === "loot" || shot === "alarm" || shot === "win";

  // ---- main loop ----
  let last = performance.now();
  function frame(nowMs) {
    const now = nowMs / 1000;
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    if (posed) { render(state.time); requestAnimationFrame(frame); return; }
    if (!state.won) state.time += dt;
    if (state.caught) {
      state.flash = Math.max(0, state.flash - dt * 0.6);
      if (now - state.caughtAt > 1.6) resetRoom();
    } else {
      movePlayer(dt);
      for (const g of guards) patrol(g, dt);
      alarmMeter(dt, state.time);
      loot(state.time);
      exit(state.time);
    }
    render(state.time);
    requestAnimationFrame(frame);
  }
  // Static shot presets render deterministically even before the first frame advances.
  render(state.time);
  requestAnimationFrame(frame);
})();
