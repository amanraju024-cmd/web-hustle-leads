// Stag Run: a one-tap endless runner. Tap / Space / ↑ to jump (double jump allowed).
// Gets faster over time. A round ends on a crash or after GAME_MAX_SECS.

export const GAME_MAX_SECS = 90;
const H = 260, GROUND = 214;                     // virtual canvas height; width follows the screen shape
const GRAVITY = 2400, JUMP = -820, DOUBLE = -700;
const STAG = { x: 70, w: 34, h: 44 };

/** w = virtual world width (720 on a wide screen, narrower on phones; speed scales with it). */
export function newGame(rng = Math.random, w = 720) {
  const W = Math.max(300, Math.min(720, w));
  return { W, f: W / 720, t: 0, speed: 330, dist: 0, coins: 0, y: GROUND - STAG.h, vy: 0, jumps: 0, obstacles: [], items: [], nextObs: 1.1, nextCoin: 2, over: false, rng };
}

export const gameScore = (g) => Math.min(5000, Math.floor(g.dist / g.f / 10) + g.coins * 25);

export function jump(g) {
  if (g.over) return;
  if (g.jumps === 0) { g.vy = JUMP; g.jumps = 1; }
  else if (g.jumps === 1) { g.vy = DOUBLE; g.jumps = 2; }
}

/** Advances the game by dt seconds. */
export function step(g, dt) {
  if (g.over) return g;
  dt = Math.min(dt, 0.05);
  g.t += dt;
  g.speed = Math.min(820, 330 + g.t * 9) * Math.max(0.6, g.f);
  g.dist += g.speed * dt;
  // stag physics
  g.vy += GRAVITY * dt;
  g.y += g.vy * dt;
  if (g.y >= GROUND - STAG.h) { g.y = GROUND - STAG.h; g.vy = 0; g.jumps = 0; }
  // spawn obstacles (gaps shrink as it speeds up, but always jumpable)
  g.nextObs -= dt;
  if (g.nextObs <= 0) {
    const tall = g.rng() < 0.35;
    const w = 22 + Math.floor(g.rng() * 22);
    const h = tall ? 52 + Math.floor(g.rng() * 18) : 28 + Math.floor(g.rng() * 16);
    g.obstacles.push({ x: g.W + 10, w, h, kind: tall ? "tall" : "low" });
    if (g.rng() < Math.min(0.35, g.t / 120)) g.obstacles.push({ x: g.W + 10 + w + 6, w: 20, h: 30, kind: "low" }); // double block later on
    g.nextObs = Math.max(0.62, 1.45 - g.t / 70) + g.rng() * 0.7;
  }
  g.nextCoin -= dt;
  if (g.nextCoin <= 0) {
    g.items.push({ x: g.W + 10, y: GROUND - 70 - Math.floor(g.rng() * 70), r: 9 });
    g.nextCoin = 1.2 + g.rng() * 1.6;
  }
  const dx = g.speed * dt;
  g.obstacles.forEach((o) => { o.x -= dx; });
  g.items.forEach((c) => { c.x -= dx; });
  g.obstacles = g.obstacles.filter((o) => o.x + o.w > -10);
  g.items = g.items.filter((c) => c.x + c.r > -10 && !c.taken);
  // collisions (slightly forgiving hitbox)
  const sx = STAG.x + 6, sw = STAG.w - 12, sy = g.y + 6, sh = STAG.h - 8;
  for (const o of g.obstacles) {
    if (sx < o.x + o.w && sx + sw > o.x && sy + sh > GROUND - o.h) { g.over = true; g.crashed = true; break; }
  }
  for (const c of g.items) {
    if (!c.taken && Math.abs(STAG.x + STAG.w / 2 - c.x) < c.r + 14 && Math.abs(g.y + STAG.h / 2 - c.y) < c.r + 20) { c.taken = true; g.coins++; }
  }
  if (g.t >= GAME_MAX_SECS) g.over = true;
  return g;
}

/** Draws the current frame. img = the stag logo (white on transparent). */
export function draw(ctx, g, img, cw, ch) {
  const W = g.W;
  const s = Math.min(cw / W, ch / H);
  ctx.setTransform(s, 0, 0, s, (cw - W * s) / 2, (ch - H * s) / 2);
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1b0d12"); sky.addColorStop(1, "#0c0708");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // far hills (parallax)
  ctx.fillStyle = "rgba(156,28,48,.25)";
  const off = (g.dist * 0.15) % 240;
  for (let x = -off; x < W + 240; x += 240) { ctx.beginPath(); ctx.ellipse(x + 120, GROUND + 10, 140, 60, 0, Math.PI, 0); ctx.fill(); }
  // ground
  ctx.fillStyle = "#2a1a1d"; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.strokeStyle = "#e2b968"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(W, GROUND); ctx.stroke();
  ctx.fillStyle = "rgba(226,185,104,.25)";
  const doff = g.dist % 40;
  for (let x = -doff; x < W; x += 40) ctx.fillRect(x, GROUND + 14, 14, 2);
  // coins
  for (const c of g.items) {
    ctx.fillStyle = "#f6dca0"; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b98a3c"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", c.x, c.y + 1);
  }
  // obstacles
  for (const o of g.obstacles) {
    ctx.fillStyle = o.kind === "tall" ? "#9c1c30" : "#c2453a";
    ctx.fillRect(o.x, GROUND - o.h, o.w, o.h);
    ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(o.x, GROUND - o.h, o.w, 4);
  }
  // stag
  if (img && img.complete && img.naturalWidth) ctx.drawImage(img, STAG.x, g.y, STAG.w, STAG.h);
  else { ctx.fillStyle = "#fff"; ctx.fillRect(STAG.x, g.y, STAG.w, STAG.h); }
  // HUD
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
