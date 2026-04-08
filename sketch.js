// ============================================================
// CONSTANTS
// ============================================================
let TILE = 50; // recalculated in setup() to fit window height
const COLS = 9;
const ROWS = 13;
const FROG_SCREEN_ROW = 8;

const ZONES = [
  { name: "swamp", start: -15, end: 5 },
  { name: "river", start: -25, end: -16 },
  { name: "town",  start: -35, end: -26 }
];

const FINISH_LINE = -40;
const GATE_ROW = FINISH_LINE + 1;

// ============================================================
// GAME STATE
// ============================================================

let cameraYVisual = 0;
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
let gateImg;

// ============================================================
// P5 LIFECYCLE
// ============================================================

function preload() {
  frogImg     = loadImage("images/frog.svg");
  frogJumpImg = loadImage("images/jumpingfrog.svg");
  logImg      = loadImage("images/log.svg");
  carImg      = loadImage("images/car.svg");
  cursiveFont = loadFont("fonts/PrincessAndTheFrog-XdMd.ttf");
  // gateImg loaded separately via loadGateSVG() for crisp vector rendering
}

// Native HTMLImageElement for the gate — drawn via drawingContext for true vector quality
let gateElement = null;
let gateReady   = false;

function loadGateSVG() {
  // Fetch the SVG as text, create a Blob URL, and assign it to an HTMLImageElement.
  // This makes the browser render the SVG at full vector resolution at draw time,
  // bypassing p5's lossy loadImage() bitmap conversion entirely.
  fetch("images/gate.svg")
    .then(r => r.text())
    .then(svgText => {
      let blob = new Blob([svgText], { type: "image/svg+xml" });
      let url  = URL.createObjectURL(blob);
      gateElement = new Image();
      gateElement.onload = () => { gateReady = true; };
      gateElement.src = url;
    });
}

function setup() {
  // Scale TILE so the canvas fills the full browser window height.
  // ROWS = 13 rows tall, so each tile = windowHeight / 13.
  // Width follows naturally: COLS * TILE wide.
  TILE = floor(windowHeight / ROWS);

  pixelDensity(2);
  let cnv = createCanvas(COLS * TILE, ROWS * TILE);
  loadGateSVG();

  // Centre the canvas in the browser window using CSS
  cnv.style('display', 'block');
  cnv.style('margin', '0 auto');
  // Remove default body margin so nothing shifts the canvas off-centre
  document.body.style.margin    = '0';
  document.body.style.padding   = '0';
  document.body.style.background = '#222'; // dark bg visible on sides if window is wide
  document.body.style.display   = 'flex';
  document.body.style.justifyContent = 'center';
  document.body.style.alignItems     = 'center';
  document.body.style.height    = '100vh';
  document.body.style.overflow  = 'hidden';

  frog = {
    x: Math.floor(COLS / 2),
    worldY: ROWS - 1
  };
}

function draw() {
  background(220);
  noStroke();

  // ---- Death screen ----
  if (gameState === "dead") {
    cameraY = Math.floor(frog.worldY - FROG_SCREEN_ROW);
    cameraY = min(0, cameraY);
    drawLanes();
    drawFrog();

    let elapsed = 120 - deathTimer;
    let alpha = min(200, elapsed * 10);
    push();
    noStroke();
    fill(0, 0, 0, alpha);
    rect(0, 0, width, height);
    pop();

    if (elapsed > 15) {
      push();
      textAlign(CENTER, CENTER);
      noStroke();

      textFont(cursiveFont);
      textSize(34);
      fill(255, 80, 80);
      text("Better luck next time!", width / 2, height / 2 - 20);
      
      
      textFont('sans-serif');
      textSize(15);
      fill(180, 180, 180);
      text("Thanks for playing!", width / 2, height / 2 + 18);
      pop();
    }

    deathTimer--;
    if (deathTimer <= 0) resetFrog();
    return;
  }

  // ---- Win screen ----
  if (gameState === "win") {
    cameraY = Math.floor(frog.worldY - FROG_SCREEN_ROW);
    cameraY = min(0, cameraY);
    drawLanes();
    drawFrog();

    let winElapsed = 120 - winTimer;
    let winAlpha = min(210, winElapsed * 10);
    push();
    noStroke();
    fill(34, 139, 60, winAlpha * 0.6); // bright gold overlay
    rect(0, 0, width, height);
    pop();

    if (winElapsed > 15) {
      push();
      textAlign(CENTER, CENTER);
      noStroke();
      textFont(cursiveFont);
      textSize(36);
      fill(255, 220, 50);
      text("You Win!", width / 2, height / 2 - 22);

      textFont('sans-serif');
      textSize(15);
      fill(200, 200, 150);
      text("Thanks for playing!", width / 2, height / 2 + 18);
      pop();
    }

    winTimer--;
    if (winTimer <= 0) resetFrog();
    return;
  }

  updateJump();

  cameraY = Math.floor(frog.worldY - FROG_SCREEN_ROW);
  cameraY = min(0, cameraY);
  cameraYVisual = lerp(cameraYVisual, cameraY, 0.1);

  updateLanes();
  drawLanes();

  // ---- Hazard + finish line checks ----
  if (!frogJumping) {
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
  if (gameState === "dead") return;
  if (gameState === "win")  return;
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

function createLane(worldY) {
  let zone = getZoneForRow(worldY);

  // ---- SWAMP ----
  if (zone === "swamp") {
    if (random() < 0.3) {
      return makeSafeLane(worldY);
    }

    let speed = random([-2, -1.5, 1.5, 2]);
    let logs  = generateLogs(3, 5, 4, 6);
    let crocs = generateCrocs(logs, 1, 3);

    let safety = 0;
    while (!laneHasSafePath(logs, crocs) && safety < 10) {
      logs  = generateLogs(3, 5, 4, 6);
      crocs = generateCrocs(logs, 0, 1);
      safety++;
    }

    return { worldY, type: "water", speed, logs, crocs };
  }

  // ---- RIVER ----
  if (zone === "river") {
    let speed = random([-2.5, -2.25, 2.25, 2.75]);
    let logs  = generateLogs(3, 5, 3, 5);
    let crocs = generateCrocs(logs, 1, 2);

    let safety = 0;
    while (!laneHasSafePath(logs, crocs) && safety < 10) {
      logs  = generateLogs(3, 5, 3, 5);
      crocs = generateCrocs(logs, 0, 1);
      safety++;
    }

    return { worldY, type: "water", speed, logs, crocs };
  }

  // ---- TOWN ----
  if (zone === "town") {
    const CAR_LEN = 249.6 / 115.2;
    const CAR_GAP = random(1.5, 3);

    let carCount = floor(random(1, 3));
    let cars = [];
    let cursor = random(0, COLS);

    for (let i = 0; i < carCount; i++) {
      cars.push({ x: cursor, width: 1 });
      cursor += CAR_LEN + CAR_GAP;
    }

    return { worldY, type: "road", speed: random([-2, -1.5, 1.5, 2]), cars };
  }

  return makeSafeLane(worldY);
}

function makeSafeLane(worldY) {
  return { worldY, type: "safe", speed: 0, decor: generateDecor() };
}

// ============================================================
// LOG GENERATION
// ============================================================

function generateLogs(minW, maxW, minCount, maxCount) {
  const FILL_FROM  = -26;
  const FILL_TO    =  35;
  const MIN_GAP    = 0.6;

  let logs = [];
  let cursor = FILL_FROM + random(0, 1.5);

  while (cursor < FILL_TO) {
    let w = floor(random(minW, maxW + 1));
    logs.push({ x: cursor, width: w });

    let roll = random();
    let gap;
    if      (roll < 0.25) gap = random(0.6, 0.9);
    else if (roll < 0.75) gap = random(0.9, 1.8);
    else                  gap = random(2.2, 3.8);

    cursor += w + max(gap, MIN_GAP);
  }

  return logs;
}

// ============================================================
// CROC GENERATION
// ============================================================

function generateCrocs(logs, minCount, maxCount) {
  const FILL_FROM  = -26;
  const FILL_TO    =  35;
  const BUFFER     = 0.35;
  const MIN_CROC_W = 2;
  const MAX_CROC_W = 3;

  let sorted = [...logs].sort((a, b) => a.x - b.x);
  let gaps = [];

  let firstGapEnd = sorted.length > 0 ? sorted[0].x - BUFFER : FILL_TO;
  if (firstGapEnd - FILL_FROM >= MIN_CROC_W) {
    gaps.push([FILL_FROM, firstGapEnd]);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    let gStart = sorted[i].x + sorted[i].width + BUFFER;
    let gEnd   = sorted[i + 1].x - BUFFER;
    if (gEnd - gStart >= MIN_CROC_W) gaps.push([gStart, gEnd]);
  }

  if (sorted.length > 0) {
    let lastGapStart = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width + BUFFER;
    if (FILL_TO - lastGapStart >= MIN_CROC_W) gaps.push([lastGapStart, FILL_TO]);
  }

  gaps.sort(() => random() - 0.5);

  let crocs = [];
  let targetCount = floor(random(minCount, maxCount + 1));

  for (let gap of gaps) {
    if (crocs.length >= targetCount) break;
    let [gStart, gEnd] = gap;
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

function laneHasSafePath(logs, crocs) {
  for (let log of logs) {
    let blocked = false;
    for (let croc of crocs) {
      if (overlapsWithBuffer(log.x, log.x + log.width, croc.x, croc.x + croc.width, 0)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return true;
  }
  return false;
}

// ============================================================
// LANE UPDATE (movement)
// ============================================================

function updateLanes() {
  const SENTINEL = 26;

  for (let lane of Object.values(laneMap)) {
    if (lane.logs) {
      for (let log of lane.logs) {
        log.x += lane.speed * 0.02;
        if (log.x > COLS + SENTINEL)  log.x -= (COLS + SENTINEL * 2);
        if (log.x < -SENTINEL)        log.x += (COLS + SENTINEL * 2);
      }
    }
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

function drawRoundedShadow(x, y, w, h, r) {
  push();
  noStroke();
  fill(0, 0, 0, 35);
  rect(x, y, w, h, r);
  pop();
}

function drawLanes() {
  let yOffset = (cameraY - cameraYVisual) * TILE;

  for (let screenRow = -1; screenRow <= ROWS; screenRow++) {
    let baseRow = Math.floor(cameraY);
    let worldY = baseRow + screenRow;
    let lane   = getLane(worldY);

    drawLaneBg(lane, screenRow, yOffset);
    drawLogs(lane, screenRow, yOffset);
    drawCrocs(lane, screenRow, yOffset);
    drawCars(lane, screenRow, yOffset);

    if (worldY === GATE_ROW) {
      let y = screenRow * TILE + yOffset;
      drawGate(y);
    }
  }
}

function drawLaneBg(lane, screenRow, yOffset) {
  let y = screenRow * TILE + yOffset;

  if (lane.type === "safe") fill(80, 150, 60);
  if (lane.type === "water") {
    let wave = sin(frameCount * 0.03 + screenRow * 0.5) * 5;
    fill(40 + wave * 0.3, 100 + wave, 160 + wave * 1.2);
  }
  if (lane.type === "road") fill(120);

  rect(0, y, width, TILE);

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

function drawLogs(lane, screenRow, yOffset) {
  if (lane.type !== "water" || !lane.logs) return;

  let y = Math.round(screenRow * TILE + yOffset);

  for (let log of lane.logs) {
    let px  = log.x * TILE;
    let bob = sin(frameCount * 0.05 + log.x) * 4;

    drawRoundedShadow(px + 5, y + 5 + bob + 5, log.width * TILE - 10, TILE - 10, 12);

    push();
    drawingContext.save();

    let rx = px,  ry = y + 5 + bob;
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

function drawCrocs(lane, screenRow, yOffset) {
  if (lane.type !== "water" || !lane.crocs) return;

  let y = Math.round(screenRow * TILE + yOffset);

  for (let croc of lane.crocs) {
    let px   = croc.x * TILE;
    let bob  = sin(frameCount * 0.05 + croc.x) * 4;
    let crocW = croc.width * TILE - 10;
    let crocH = TILE - 20;
    let crocX = px;
    let crocY = y + 10 + bob;

    drawRoundedShadow(crocX + 5, crocY + 5, crocW, crocH, 8);

    fill(20, 100, 20);
    rect(crocX, crocY, crocW, crocH, 8);

    fill(220, 220, 0);
    let eyeY = crocY + 4;
    ellipse(px + 8,  eyeY, 8);
    ellipse(px + 16, eyeY, 8);

    fill(0);
    ellipse(px + 8,  eyeY, 4);
    ellipse(px + 16, eyeY, 4);
  }
}

function drawCars(lane, screenRow, yOffset) {
  if (lane.type !== "road" || !lane.cars) return;

  let y = Math.round(screenRow * TILE + yOffset);

  const carH = TILE;
  const carW = TILE * (249.6 / 115.2);

  for (let car of lane.cars) {
    let px = car.x * TILE;
    let cx = px + carW / 2;
    let cy = y  + carH / 2;

    drawRoundedShadow(px + 5, y + 5, carW, carH, 8);

    push();
    translate(cx, cy);
    rotate(HALF_PI);
    imageMode(CENTER);
    image(carImg, 0, 0, carH, carW);
    imageMode(CORNER);
    pop();
  }
}

// ============================================================
// HAZARD CHECKS
// ============================================================

function checkWaterHazards(lane) {
  if (lane.type !== "water") return;

  if (frogOnCroc(lane)) {
    killFrog();
    return;
  }

  let log = frogOnLog(lane);
  if (log) {
    frog.x += lane.speed * 0.02;
  } else {
    killFrog();
  }
}

function checkRoadHazards(lane) {
  if (lane.type !== "road") return;
  if (frogHitCar(lane)) killFrog();
}

function frogOnLog(lane) {
  if (!lane.logs) return null;
  let fc = frog.x + 0.5;
  let buffer = 0.25; // 👈 tweak this value

  for (let log of lane.logs) {
    if (fc >= log.x - buffer && fc <= log.x + log.width + buffer) return log;
  }
  return null;
}

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
  let py = Math.round((frog.worldY - cameraYVisual) * TILE);

  if (frogJumping) {
    py -= sin((jumpProgress / jumpDuration) * PI) * 12;
  }

  push();
  noStroke();
  fill(0, 0, 0, 80);
  let t      = frogJumping ? jumpProgress / jumpDuration : 0;
  let squash = 1 - sin(t * PI) * 0.75;
  let lift   = sin(t * PI) * 10;
  ellipse(px + TILE / 2, py + TILE - 3 + lift, TILE * 0.8 * squash, TILE * 0.3 * squash);
  pop();

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
  deathTimer = 120;
}

function triggerWin() {
  if (gameState !== "playing") return;
  gameState = "win";
  winTimer  = 120;
}

function resetFrog() {
  frog.x      = Math.floor(COLS / 2);
  frog.worldY = ROWS - 1;
  laneMap     = {};
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

function overlapsAny(x, xEnd, entities, buffer) {
  for (let e of entities) {
    if (overlapsWithBuffer(x, xEnd, e.x, e.x + e.width, buffer)) return true;
  }
  return false;
}

function overlapsWithBuffer(aStart, aEnd, bStart, bEnd, buffer) {
  return aStart < bEnd + buffer && aEnd > bStart - buffer;
}

// ============================================================
// DECORATIONS & PARTICLES
// ============================================================

let flowerColors = [
  [255, 180, 200], // pink
  [255, 220, 120], // yellow
  [200, 160, 255], // purple
  [255, 140, 140], // coral
];

function generateDecor() {
  let items = [];
  let count = floor(random(0, 5));
  for (let i = 0; i < count; i++) {
    items.push({
      x: random(0, COLS),
      type: random(["flower", "grass"]),
      size: random(8, 12),
      color: random(flowerColors)
    });
  }
  return items;
}

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

// ============================================================
// GATE DRAWING
// ============================================================

function drawGate(y) {
  if (!gateReady) return; // wait until the SVG blob has loaded

  // SVG natural ratio: 672.56 wide × 535.34 tall
  // Draw at full canvas width so the gate spans the whole screen
  let gateWidth  = width;                      // 450px
  let gateHeight = gateWidth * (535.34 / 976.78); // ~358px, preserves ratio

  let drawX = 0;
  let drawY = y - gateHeight + TILE;           // anchor base to the lane row

  // drawingContext.drawImage renders the SVG natively at the target pixel size —
  // the browser never bitmaps it at a small size first, so it stays sharp at any scale.
  drawingContext.drawImage(gateElement, drawX, drawY, gateWidth, gateHeight);
}