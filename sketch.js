// ============================================================
// CONSTANTS
// ============================================================
const TILE = 50;
const COLS = 9;
const ROWS = 13;
const FROG_SCREEN_ROW = 8;

const ZONES = [
  { name: "swamp", start: -20, end: 5 },
  { name: "river", start: -30, end: -21 },
  { name: "town",  start: -40, end: -31 }
];

const FINISH_LINE = -45;

// ============================================================
// GAME STATE
// ============================================================
let frog;
let lanes = [];
let cameraY = 0;
let laneMap = {};
let gameState = "playing";
let deathTimer = 0;
let winTimer   = 0;
let frogJumping = false;
let jumpProgress = 0;
let jumpDuration = 8;
let particles = [];

let jumpStartX, jumpStartY;
let jumpTargetX, jumpTargetY;

let frogImg;
let frogJumpImg;
let logImg;
let carImg;
let cursiveFont;

// ============================================================
// P5 LIFECYCLE
// ============================================================

function preload() {
  frogImg     = loadImage("images/frog.svg");
  frogJumpImg = loadImage("images/jumpingfrog.svg");
  logImg      = loadImage("images/log.svg");
  carImg      = loadImage("images/car.svg");
  cursiveFont = loadFont("fonts/awesome.ttf");
}

function setup() {
  createCanvas(COLS * TILE, ROWS * TILE);

  frog = {
    x: Math.floor(COLS / 2),
    worldY: ROWS - 1
  };
}

function draw() {
  background(220);
  noStroke();

  // ---- Death screen ----
  // When dead: freeze all game logic, draw black overlay + message,
  // count down 120 frames (~2s), then respawn.
  // The `return` below means nothing after this block executes while dead,
  // which is what prevents the click-through glitch.
  if (gameState === "dead") {
    // Draw the frozen world underneath the overlay
    cameraY = Math.floor(frog.worldY - FROG_SCREEN_ROW);
    cameraY = min(0, cameraY);
    drawLanes();
    drawFrog();

    // Fade in a black overlay over the first 20 frames
    let elapsed = 120 - deathTimer;
    let alpha = min(200, elapsed * 10);
    push();
    noStroke();
    fill(0, 0, 0, alpha);
    rect(0, 0, width, height);
    pop();

    // Message — only show once overlay is mostly opaque
    if (elapsed > 15) {
      push();
      textAlign(CENTER, CENTER);
      noStroke();
      textSize(28);
      fill(255, 80, 80);
      text("Better luck next time!", width / 2, height / 2 - 20);
      textSize(15);
      fill(180, 180, 180);
      text("Thanks for playing!", width / 2, height / 2 + 18);
      pop();
    }

    deathTimer--;
    if (deathTimer <= 0) resetFrog();
    return; // <-- EXIT draw() early: no input, no physics, no glitch
  }

  // ---- Win screen ----
  if (gameState === "win") {
    cameraY = Math.floor(frog.worldY - FROG_SCREEN_ROW);
    cameraY = min(0, cameraY);
    drawLanes();
    drawFrog();

    // Fade in a golden overlay over the first 20 frames
    let winElapsed = 120 - winTimer;
    let winAlpha = min(210, winElapsed * 10);
    push();
    noStroke();
    fill(255, 200, 0, winAlpha * .6); // dark gold tint
    rect(0, 0, width, height);
    pop();

    // Message — wait until overlay is visible
    if (winElapsed > 15) {
      push();
      textAlign(CENTER, CENTER);
      noStroke();
      textSize(36);
      fill(255, 220, 50); // gold
      text("You Win!", width / 2, height / 2 - 22);
      textSize(15);
      fill(200, 200, 150);
      text("Thanks for playing!", width / 2, height / 2 + 18);
      pop();
    }

    winTimer--;
    if (winTimer <= 0) resetFrog();
    return; // freeze all game logic during win screen
  }

  updateJump();

  // Camera: clamp so we never scroll below the start row
  cameraY = Math.floor(frog.worldY - FROG_SCREEN_ROW);
  cameraY = min(0, cameraY);

  updateLanes();
  drawLanes();

  // ---- Hazard checks (only when frog is grounded) ----
  if (!frogJumping) {
    // Finish line check — must come BEFORE lane hazards so a winning
    // frog isn't also killed by water on the same frame
    if (frog.worldY <= FINISH_LINE) {
      triggerWin();
    } else {
      let frogLane = getLane(Math.floor(frog.worldY));
      checkWaterHazards(frogLane);
      checkRoadHazards(frogLane);
      frog.x = constrain(frog.x, 0, COLS - 1);
    }
  }

  // ---- Ambient sparkles ----
  if (random() < 0.1) {
    particles.push({
      x: random(width), y: random(height),
      size: random(2, 5), life: 100,
      vx: random(-0.3, 0.3), vy: random(-0.3, 0.3)
    });
  }

  drawParticles();
  drawFrog();

  // Debug text
  fill(0);
  textSize(14);

  // Screen tint overlay
  push();
  noStroke();
  fill(255, 180, 120, 40);
  rect(0, 0, width, height);
  pop();
}

// ============================================================
// INPUT
// ============================================================

function keyPressed() {
  if (gameState === "dead") return; // block ALL input during death screen
  if (gameState === "win")  return; // block ALL input during win screen
  if (frogJumping) return;

  let dx = 0, dy = 0;
  if (keyCode === UP_ARROW)    dy = -1;
  if (keyCode === DOWN_ARROW)  dy =  1;
  if (keyCode === LEFT_ARROW)  dx = -1;
  if (keyCode === RIGHT_ARROW) dx =  1;
  if (dx === 0 && dy === 0) return;

  let newX = frog.x + dx;
  let newY = frog.worldY + dy;
  if (newX < 0 || newX >= COLS) return;

  startJump(newX, newY);
}

// ============================================================
// LANE CREATION
// ============================================================

/*
 * createLane(worldY)
 *
 * The three zones each have their own generation rules.
 *
 * For water lanes (swamp + river) the generation order is:
 *   1. Place logs (platforms)
 *   2. Place crocs in the REMAINING space, respecting a buffer
 *   3. Verify at least one log is croc-free (solvability guarantee)
 *
 * Crocs are completely separate objects from logs.
 * They share the same lane.speed but are stored in lane.crocs[].
 */

function createLane(worldY) {
  let zone = getZoneForRow(worldY);

  // ---- SWAMP ----
  if (zone === "swamp") {
    // 30% chance of a safe grassy bank (was 50%) — more water lanes to cross
    if (random() < 0.3) {
      return makeSafeLane(worldY);
    }

    let speed = random([-2.5, -2, 2, 2.5]); // faster → less waiting between logs
    // More logs (4–6), wider logs (3–5 tiles) → easier to land on
    let logs  = generateLogs(3, 5, 4, 6);   // (minW, maxW, minCount, maxCount)
    // Fewer crocs (0–1) → less punishment
    let crocs = generateCrocs(logs, 1, 3);   // 1-3 crocs in the wide gaps

    // Guarantee solvability: re-generate until at least one log is clear
    let safety = 0;
    while (!laneHasSafePath(logs, crocs) && safety < 10) {
      logs  = generateLogs(3, 5, 4, 6);
      crocs = generateCrocs(logs, 0, 1);
      safety++;
    }

    return {
      worldY,
      type: "water",
      speed,
      logs,
      crocs
    };
  }

  // ---- RIVER ----
  if (zone === "river") {
    let speed = random([-3.25, -2.25, 2.25, 3.25]);
    // More logs (3–5), wider (3–5 tiles) → river is still hard but crossable
    let logs  = generateLogs(3, 5, 3, 5);
    // Max 1 croc per river lane — river speed is already the main challenge
    let crocs = generateCrocs(logs, 1, 2);

    let safety = 0;
    while (!laneHasSafePath(logs, crocs) && safety < 10) {
      logs  = generateLogs(3, 5, 3, 5);
      crocs = generateCrocs(logs, 0, 1);
      safety++;
    }

    return {
      worldY,
      type: "water",
      speed,
      logs,
      crocs
    };
  }

  // ---- TOWN ----
  if (zone === "town") {
    // Visual car length in tiles = SVG ratio = 249.6/115.2 ≈ 2.17 tiles.
    // Place cars left-to-right so each one starts after the previous
    // car's visual length + a gap, preventing any overlap.
    const CAR_LEN = 249.6 / 115.2; // ≈ 2.17 tiles
    const CAR_GAP = random(1.5, 3); // tile gap between cars

    let carCount = floor(random(1, 3));
    let cars = [];
    let cursor = random(0, COLS); // random starting position

    for (let i = 0; i < carCount; i++) {
      cars.push({ x: cursor, width: 1 }); // width:1 for collision hitbox
      cursor += CAR_LEN + CAR_GAP;
    }

    return {
      worldY,
      type: "road",
      speed: random([-2, -1, 1, 2]),
      cars
    };
  }

  // ---- DEFAULT (safe grass) ----
  return makeSafeLane(worldY);
}

function makeSafeLane(worldY) {
  return {
    worldY,
    type: "safe",
    speed: 0,
    decor: generateDecor()
  };
}

// ============================================================
// LOG GENERATION
// ============================================================

/*
 * generateLogs(minW, maxW, minCount, maxCount)
 *
 * Places logs one-by-one, rejecting any that overlap existing logs
 * (with a small padding gap so they don't butt up against each other).
 * Returns the array of log objects.
 */
function generateLogs(minW, maxW, minCount, maxCount) {
  // Fill the entire wrap window [-26, 35] so logs are always on screen.
  // Gap modes give visual variety — but the minimum gap is now 0.6 tiles
  // across ALL modes. The old 0.2 minimum caused logs to spawn nearly
  // touching, and after independent wrapping they could visually merge.
  const FILL_FROM  = -26;
  const FILL_TO    =  35;
  const MIN_GAP    = 0.6; // hard minimum between any two logs

  let logs = [];
  let cursor = FILL_FROM + random(0, 1.5);

  while (cursor < FILL_TO) {
    let w = floor(random(minW, maxW + 1));
    logs.push({ x: cursor, width: w });

    // Three gap modes for visual rhythm — all floored at MIN_GAP
    let roll = random();
    let gap;
    if      (roll < 0.25) gap = random(0.6, 0.9);   // close cluster (was 0.2–0.5)
    else if (roll < 0.75) gap = random(0.9, 1.8);   // normal
    else                  gap = random(2.2, 3.8);   // wide gap — hazard

    cursor += w + max(gap, MIN_GAP);
  }

  return logs;
}

// ============================================================
// CROC GENERATION
// ============================================================

/*
 * generateCrocs(logs, minCount, maxCount)
 *
 * Strategy: scan the lane for FREE GAPS between (and around) logs,
 * then place crocs only inside those gaps.
 *
 * This is more reliable than random placement + rejection because
 * it works with the actual available space instead of guessing.
 *
 * Steps:
 *   1. Sort logs by x position
 *   2. Identify every gap segment between logs (and at lane edges)
 *   3. For each gap wide enough, optionally place a croc inside it
 *   4. Croc width is chosen from [2, 3] tiles so crocs are always
 *      visually chunky and distinct from the water background
 */
function generateCrocs(logs, minCount, maxCount) {
  // FILL bounds must match generateLogs exactly.
  // Old code used [0, COLS] = [0, 9] as the search window — but logs now
  // span [-26, 35], so almost every tile in [0,9] was already a log.
  // No gaps were found and crocs were never placed.
  // Fix: scan the full [-26, 35] window to find gaps between logs.
  const FILL_FROM  = -26;
  const FILL_TO    =  35;
  const BUFFER     = 0.35; // gap between croc edge and log edge
  const MIN_CROC_W = 2;
  const MAX_CROC_W = 3;

  // 1. Sort logs by left edge
  let sorted = [...logs].sort((a, b) => a.x - b.x);

  // 2. Walk the full window and collect every gap wide enough for a croc
  let gaps = [];

  // Gap between FILL_FROM and the first log
  let firstGapEnd = sorted.length > 0 ? sorted[0].x - BUFFER : FILL_TO;
  if (firstGapEnd - FILL_FROM >= MIN_CROC_W) {
    gaps.push([FILL_FROM, firstGapEnd]);
  }

  // Gaps between consecutive logs
  for (let i = 0; i < sorted.length - 1; i++) {
    let gStart = sorted[i].x + sorted[i].width + BUFFER;
    let gEnd   = sorted[i + 1].x - BUFFER;
    if (gEnd - gStart >= MIN_CROC_W) {
      gaps.push([gStart, gEnd]);
    }
  }

  // Gap between last log and FILL_TO
  if (sorted.length > 0) {
    let lastGapStart = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width + BUFFER;
    if (FILL_TO - lastGapStart >= MIN_CROC_W) {
      gaps.push([lastGapStart, FILL_TO]);
    }
  }

  // 3. Shuffle so croc positions vary each lane
  gaps.sort(() => random() - 0.5);

  // 4. Place crocs — one per gap, up to targetCount
  let crocs = [];
  let targetCount = floor(random(minCount, maxCount + 1));

  for (let gap of gaps) {
    if (crocs.length >= targetCount) break;

    let [gStart, gEnd] = gap;

    // Pick a width that fits inside this gap
    let possibleWidths = [MIN_CROC_W, MAX_CROC_W].filter(w => w <= gEnd - gStart);
    if (possibleWidths.length === 0) continue;

    let w = random(possibleWidths);
    let x = random(gStart, gEnd - w);
    crocs.push({ x, width: w });
  }

  return crocs;
}

// ============================================================
// SOLVABILITY CHECK
// ============================================================

/*
 * laneHasSafePath(logs, crocs)
 *
 * Returns true if at least one log exists that has NO croc on top of it.
 * A lane with zero croc-free logs cannot be crossed safely.
 *
 * Note: crocs and logs shouldn't spatially overlap (enforced at generation),
 * but this is a logical double-check for gameplay solvability.
 */
function laneHasSafePath(logs, crocs) {
  for (let log of logs) {
    let blocked = false;

    for (let croc of crocs) {
      if (overlapsWithBuffer(
        log.x, log.x + log.width,
        croc.x, croc.x + croc.width,
        0
      )) {
        blocked = true;
        break;
      }
    }

    if (!blocked) return true; // found at least one safe log
  }
  return false;
}

// ============================================================
// LANE UPDATE (movement)
// ============================================================

/*
 * updateLanes()
 *
 * Every frame: advance log.x and croc.x by lane.speed * 0.02.
 * Wrap both around the screen edges.
 * Logs and crocs are updated independently from each other.
 */
function updateLanes() {
  // FIX: The old code wrapped each object based on its own width:
  //   log wraps at x < -log.width   (e.g. -5 for a wide log)
  //   croc wraps at x < -croc.width (e.g. -2 for a narrow croc)
  // This means after one wrap cycle a croc is now 3 tiles displaced
  // relative to the logs it was placed between. Over time they fully
  // overlap. Fix: ALL objects in a lane wrap at the same fixed sentinel
  // values (-TILE_SENTINEL and COLS + TILE_SENTINEL), regardless of width.
  // This keeps relative spacing between logs and crocs stable forever.
  const SENTINEL = 26; // wrap window = [-26, COLS+26] = [-26,35], wider than FILL_TO=33

  for (let lane of Object.values(laneMap)) {

    if (lane.logs) {
      for (let log of lane.logs) {
        log.x += lane.speed * 0.02;
        if (log.x > COLS + SENTINEL)  log.x -= (COLS + SENTINEL * 2);
        if (log.x < -SENTINEL)        log.x += (COLS + SENTINEL * 2);
      }
    }

    // Crocs use IDENTICAL wrap math so they stay in sync with logs
    if (lane.crocs) {
      for (let croc of lane.crocs) {
        croc.x += lane.speed * 0.02;
        if (croc.x > COLS + SENTINEL)  croc.x -= (COLS + SENTINEL * 2);
        if (croc.x < -SENTINEL)        croc.x += (COLS + SENTINEL * 2);
      }
    }

    if (lane.cars) {
      for (let car of lane.cars) {
        car.x += lane.speed * 0.02;
        if (car.x > COLS + SENTINEL)  car.x -= (COLS + SENTINEL * 2);
        if (car.x < -SENTINEL)        car.x += (COLS + SENTINEL * 2);
      }
    }
  }
}

// ============================================================
// DRAWING
// ============================================================

/*
 * drawRoundedShadow(x, y, w, h, r)
 *
 * Draws a very subtle semi-transparent rounded rectangle to simulate
 * a drop shadow. Deliberately soft and understated — just enough depth.
 * x/y are the shadow's top-left (offset from the object by a few px).
 */
function drawRoundedShadow(x, y, w, h, r) {
  push();
  noStroke();
  fill(0, 0, 0, 35); // very low alpha — subtle, not muddy
  rect(x, y, w, h, r);
  pop();
}

function drawLanes() {
  for (let screenRow = 0; screenRow < ROWS; screenRow++) {
    let worldY = cameraY + screenRow;
    let lane   = getLane(worldY);

    drawLaneBg(lane, screenRow);
    drawLogs(lane, screenRow);
    drawCrocs(lane, screenRow);   // drawn AFTER logs, never on top because no spatial overlap
    drawCars(lane, screenRow);
  }
}

// --- Background tile ---
function drawLaneBg(lane, screenRow) {
  let y = screenRow * TILE;

  if (lane.type === "safe") fill(80, 150, 60);
  if (lane.type === "water") {
    let wave = sin(frameCount * 0.03 + screenRow * 0.5) * 5;
    fill(40 + wave * 0.3, 100 + wave, 160 + wave * 1.2);
  }
  if (lane.type === "road") fill(120);

  rect(0, y, width, TILE);

  // Grass decorations on safe lanes
  if (lane.decor) {
    for (let d of lane.decor) {
      let px = d.x * TILE;
      if (d.type === "flower") {
        fill(d.color[0], d.color[1], d.color[2]);
        ellipse(px + TILE/2, y + TILE/2, d.size);
      }
      if (d.type === "grass") {
        let sway = sin(frameCount * 0.05 + d.x) * 3;
        stroke(50, 120, 50);
        line(px + 20, y + TILE, px + 25 + sway, y + TILE - 15);
        line(px + 30, y + TILE, px + 28 + sway, y + TILE - 12);
        noStroke();
      }
    }
  }
}

// --- Logs ---
function drawLogs(lane, screenRow) {
  if (lane.type !== "water" || !lane.logs) return;

  let y = screenRow * TILE;

  for (let log of lane.logs) {
    let px  = log.x * TILE;
    let bob = sin(frameCount * 0.05 + log.x) * 4;

    // Subtle rounded-rect shadow drawn before the log image
    let logShadowX = px + 5;
    let logShadowY = y + 5 + bob + 5;
    let logShadowW = log.width * TILE - 10;
    let logShadowH = TILE - 10;
    drawRoundedShadow(logShadowX, logShadowY, logShadowW, logShadowH, 12);

    // ---- Log image with rounded-rect clip mask ----
    push();
    drawingContext.save();

    let rx = px,       ry = y + 5 + bob;
    let rw = log.width * TILE - 10,  rh = TILE - 10;
    let r  = 12;

    drawingContext.beginPath();
    drawingContext.moveTo(rx + r, ry);
    drawingContext.lineTo(rx + rw - r, ry);
    drawingContext.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
    drawingContext.lineTo(rx + rw, ry + rh - r);
    drawingContext.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
    drawingContext.lineTo(rx + r, ry + rh);
    drawingContext.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
    drawingContext.lineTo(rx, ry + r);
    drawingContext.quadraticCurveTo(rx, ry, rx + r, ry);
    drawingContext.closePath();
    drawingContext.clip();

    image(logImg, px, y + bob, log.width * TILE, TILE);

    drawingContext.restore();
    pop();
  }
}

// --- Crocs (completely independent draw pass) ---
function drawCrocs(lane, screenRow) {
  if (lane.type !== "water" || !lane.crocs) return;

  let y = screenRow * TILE;

  for (let croc of lane.crocs) {
    let px  = croc.x * TILE;
    let bob = sin(frameCount * 0.05 + croc.x) * 4;

    let crocW = croc.width * TILE - 10;
    let crocH = TILE - 20;
    let crocX = px;
    let crocY = y + 10 + bob;

    // Subtle rounded-rect shadow
    drawRoundedShadow(crocX + 5, crocY + 5, crocW, crocH, 8);

    // Body
    fill(20, 100, 20);
    rect(crocX, crocY, crocW, crocH, 8);

    // Eyes (two small yellow dots near one end)
    fill(220, 220, 0);
    let eyeY = crocY + 4;
    ellipse(px + 8,  eyeY, 6);
    ellipse(px + 16, eyeY, 6);

    // Pupil
    fill(0);
    ellipse(px + 8,  eyeY, 3);
    ellipse(px + 16, eyeY, 3);
  }
}

// --- Cars ---
function drawCars(lane, screenRow) {
  if (lane.type !== "road" || !lane.cars) return;

  let y = screenRow * TILE;

  // Natural SVG proportions: 115.2 wide × 249.6 tall (portrait).
  // Rotated 90°: 249.6 along lane × 115.2 across lane.
  // Fix height to TILE, derive length proportionally — never squished.
  const carH = TILE;                        // height across the lane
  const carW = TILE * (249.6 / 115.2);     // natural length along the lane (~108px)

  for (let car of lane.cars) {
    let px = car.x * TILE;                 // left anchor in pixels
    let cx = px + carW / 2;               // centre x
    let cy = y  + carH / 2;               // centre y

    // Shadow
    drawRoundedShadow(px + 5, y + 5, carW, carH, 8);

    // Draw at natural proportions, rotated 90° to face sideways
    push();
    translate(cx, cy);
    rotate(HALF_PI);
    imageMode(CENTER);
    image(carImg, 0, 0, carH, carW);      // axes swap after rotation
    imageMode(CORNER);
    pop();
  }
}

// ============================================================
// HAZARD CHECKS
// ============================================================

/*
 * checkWaterHazards(lane)
 *
 * Called every frame when the frog is grounded on a water tile.
 *
 * Order of priority:
 *   1. Is the frog on a croc?  → die.
 *   2. Is the frog on a log?   → ride it (frog drifts with log).
 *   3. Neither?                → die (fell in water).
 */
function checkWaterHazards(lane) {
  if (lane.type !== "water") return;

  if (frogOnCroc(lane)) {
    killFrog();
    return;
  }

  let log = frogOnLog(lane);
  if (log) {
    // Frog rides the log: add the same per-frame displacement
    frog.x += lane.speed * 0.02;
  } else {
    killFrog(); // in water with no platform
  }
}

function checkRoadHazards(lane) {
  if (lane.type !== "road") return;
  if (frogHitCar(lane)) killFrog();
}

// ---- Collision helpers ----

/*
 * frogOnLog(lane) → returns the log the frog's center is over, or null.
 * Uses the frog's horizontal center (frog.x + 0.5) for a fair hit window.
 */
function frogOnLog(lane) {
  if (!lane.logs) return null;
  let fc = frog.x + 0.5;
  for (let log of lane.logs) {
    if (fc >= log.x && fc <= log.x + log.width) return log;
  }
  return null;
}

/*
 * frogOnCroc(lane) → returns true if the frog's center is over any croc.
 * Checked BEFORE frogOnLog so crocs always take priority.
 */
function frogOnCroc(lane) {
  if (!lane.crocs) return false;
  let fc = frog.x + 0.5;
  for (let croc of lane.crocs) {
    if (fc >= croc.x && fc <= croc.x + croc.width) return true;
  }
  return false;
}

function frogHitCar(lane) {
  if (!lane.cars) return false;
  for (let car of lane.cars) {
    if (frog.x >= car.x && frog.x < car.x + car.width) return true;
  }
  return false;
}

// ============================================================
// FROG DRAWING
// ============================================================

function drawFrog() {
  let px = Math.round(frog.x * TILE);
  let py = Math.round((frog.worldY - cameraY) * TILE);

  // Arc height during jump
  if (frogJumping) {
    py -= sin((jumpProgress / jumpDuration) * PI) * 12;
  }

  // Shadow
  push();
  noStroke();
  fill(0, 0, 0, 80);
  let t      = frogJumping ? jumpProgress / jumpDuration : 0;
  let squash = 1 - sin(t * PI) * 0.75;
  let lift   = sin(t * PI) * 10;
  ellipse(px + TILE / 2, py + TILE - 3 + lift, TILE * 0.8 * squash, TILE * 0.3 * squash);
  pop();

  // Use jumping image while airborne, resting image when grounded
  let currentFrogImg = frogJumping ? frogJumpImg : frogImg;
  image(currentFrogImg, px, py, TILE, TILE);
}

// ============================================================
// JUMP SYSTEM
// ============================================================

function startJump(x, y) {
  frogJumping   = true;
  jumpProgress  = 0;
  jumpStartX    = frog.x;
  jumpStartY    = frog.worldY;
  jumpTargetX   = x;
  jumpTargetY   = y;
}

function updateJump() {
  if (!frogJumping) return;
  jumpProgress++;
  let t    = jumpProgress / jumpDuration;
  frog.x      = lerp(jumpStartX, jumpTargetX, t);
  frog.worldY = lerp(jumpStartY, jumpTargetY, t);

  if (jumpProgress >= jumpDuration) {
    frog.x      = jumpTargetX;
    frog.worldY = jumpTargetY;
    frogJumping = false;
  }
}

// ============================================================
// FROG LIFECYCLE
// ============================================================

function killFrog() {
  if (gameState !== "playing") return;
  gameState  = "dead";
  deathTimer = 120; // 2 seconds at 60fps — long enough to read the message
}

function triggerWin() {
  if (gameState !== "playing") return;
  gameState = "win";
  winTimer  = 120; // same duration as death screen
}

function resetFrog() {
  frog.x      = Math.floor(COLS / 2);
  frog.worldY = ROWS - 1;
  gameState   = "playing";
}

// ============================================================
// LANE CACHE
// ============================================================

function getLane(worldY) {
  if (!laneMap[worldY]) {
    laneMap[worldY] = createLane(worldY);
  }
  return laneMap[worldY];
}

// ============================================================
// ZONE HELPER
// ============================================================

function getZoneForRow(worldY) {
  for (let zone of ZONES) {
    if (worldY >= zone.start && worldY <= zone.end) return zone.name;
  }
  return null;
}

// ============================================================
// SPATIAL HELPERS
// ============================================================

/*
 * overlapsAny(x, xEnd, entities, buffer)
 *
 * Returns true if the range [x, xEnd] overlaps any entity in the array,
 * expanded by `buffer` on each side.
 * Works for both log[] and croc[] arrays (anything with .x and .width).
 */
function overlapsAny(x, xEnd, entities, buffer) {
  for (let e of entities) {
    if (overlapsWithBuffer(x, xEnd, e.x, e.x + e.width, buffer)) return true;
  }
  return false;
}

/*
 * overlapsWithBuffer(aStart, aEnd, bStart, bEnd, buffer)
 *
 * Core overlap test. The buffer widens B's range on both sides before
 * comparing, enforcing a minimum gap between A and B.
 */
function overlapsWithBuffer(aStart, aEnd, bStart, bEnd, buffer) {
  return aStart < bEnd + buffer && aEnd > bStart - buffer;
}

// ============================================================
// DECORATIONS & PARTICLES
// ============================================================

function generateDecor() {
  let items = [];
  let count = floor(random(0, 3));
  for (let i = 0; i < count; i++) {
    items.push({
      x: random(0, COLS),
      type: random(["flower", "grass"]),
      size: random(6, 8),
      color: random(flowerColors)
    });
  }
  return items;
}

let flowerColors = [
  [255, 180, 200], // pink
  [255, 220, 120], // yellow
  [200, 160, 255], // purple
  [255, 140, 140], // coral
];

function drawParticles() {
  noStroke();
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    fill(255, 255, 200, 80);
    ellipse(p.x, p.y, p.size * 2);
    fill(255, 255, 150);
    ellipse(p.x, p.y, p.size);

    if (p.life <= 0) particles.splice(i, 1);
  }
}