import * as THREE from 'three';

/* ==========================================
   PRECISION ARENA — AIM TRAINER 3D
   Modos: Flick, Tracking, Precision Arena,
   Peeker's Alley (Tac-FPS) e Gravity Flick
   Sensibilidade ajustável, som e pontuação
========================================== */

/* ---------- CONFIGURAÇÕES ---------- */

const canvas = document.querySelector('#world');

if (!canvas) {
  throw new Error('O HTML precisa ter um canvas com id="world".');
}

const $ = (selector) => document.querySelector(selector);

const game = {
  score: 0,
  hits: 0,
  misses: 0,
  escaped: 0,
  headshots: 0,
  combo: 0,
  bestCombo: 0,
  time: 60,
  duration: 60,
  running: true,
  locked: false,
  keys: new Set(),
  targets: [],
  lastShot: 0,
  trackingTime: 0,
  trackingChecks: 0
};

let trainingMode = 'flick';
let mouseSensitivity = 0.002;
let yaw = 0;
let pitch = 0;
let audioContext = null;
let previousTime = performance.now();

/* Dimensões da arena (menor que a versão anterior) */
const ARENA = {
  halfWidth: 14,
  backZ: -16,
  frontZ: 12,
  startZ: 5,
  minZ: -4,
  maxZ: 9
};

/* Limites do Tracking */
const TRACK = {
  minX: -7,
  maxX: 7,
  minY: 1.8,
  maxY: 6,
  z: -11
};

/* Proporção do movimento do Tracking: 0.6 = 60% horizontal / 40% vertical */
const TRACK_H_SHARE = 0.6;

/* Tolerância da mira (1 = hitbox exata; maior = mais perdoador) */
const AIM = {
  sphereRadius: 0.48,
  sphereTolerance: 1.6,  // Flick / Precision / Tracking
  headTolerance: 1.8,    // cabeça do Peeker
  bodyTolerance: 1.5     // corpo do Peeker
};

/* Gravity Flick: blocos caem de cima e precisam ser acertados antes do chão */
const GRAVITY = {
  concurrent: 2,      // alvos caindo ao mesmo tempo
  spawnY: 8.5,        // altura inicial dos alvos
  size: 0.9,          // diâmetro da esfera (visual)
  hitRadius: 0.85,    // raio de acerto da mira (maior que o visual = mais perdoador)
  minSpeed: 2.5,      // unidades/s
  maxSpeed: 7,
  rampUp: 0.4,        // até +40% de velocidade ao longo da partida
  minGapX: 2.5,       // distância horizontal mínima entre alvos
  baseScore: 100,
  speedBonus: 10,     // bônus = velocidade × 10 (blocos rápidos valem mais)
  missPenalty: 50     // pontos perdidos quando o bloco toca o chão
};

/* Layout do Peeker's Alley */
const PEEK = {
  wallZ: -6,
  wallXs: [-9, -3, 3, 9],
  wallHalfWidth: 1.6,
  wallHeight: 4.2,
  wallDepth: 0.6,
  enemyZ: -8.6,
  outTime: 100,          // tempo para "abrir o pixel"
  inTime: 100,           // tempo para voltar ao esconderijo
  holdMin: 1000,         // duração do alvo (lifespan): 1.0s a 1.2s
  holdMax: 1200,
  respawnMin: 200,       // intervalo de respawn: 0.2s a 0.3s
  respawnMax: 300,
  crouchChance: 0.4,     // chance de o bot estar agachado
  cornerOffsetMin: 0.32, // distância do centro do bot até a quina (rente à parede)
  cornerOffsetMax: 0.7,  // variação do ângulo lateral
  headshotBase: 300,     // headshot = 3x o corpo
  bodyBase: 100,
  escapePenalty: 100,    // pontos perdidos quando o alvo some sem levar tiro
  concurrent: 2
};

function comboMultiplier() {
  return 1 + Math.min(game.combo, 10) * 0.1;
}

/* ---------- INTERFACE (elementos definidos no index.html) ---------- */

const settings = $('#training-settings');
const settingsToggle = $('#settings-toggle');
const crosshair = $('#simple-crosshair');
const message = $('#simple-message');
const endScreen = $('#simple-end');

settingsToggle.addEventListener('click', () => {
  const hidden = settings.style.display === 'none';
  settings.style.display = hidden ? 'grid' : 'none';
  settingsToggle.setAttribute('aria-expanded', String(hidden));
  settingsToggle.textContent = hidden
    ? 'OCULTAR CONFIGURAÇÕES'
    : 'MOSTRAR CONFIGURAÇÕES';
});

/* ---------- CENA THREE.JS ---------- */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc6c6c6);
scene.fog = new THREE.Fog(0xc6c6c6, 30, 70);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  150
);
camera.position.set(0, 1.7, ARENA.startZ);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, 2)
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.outputColorSpace = THREE.SRGBColorSpace;

/* ---------- ILUMINAÇÃO ---------- */

scene.add(
  new THREE.HemisphereLight(0xffffff, 0x858585, 2.2)
);

const directionalLight = new THREE.DirectionalLight(
  0xffffff,
  1.8
);

directionalLight.position.set(-8, 18, 10);
scene.add(directionalLight);

/* ---------- ARENA (REDUZIDA) ---------- */

const arenaWidth = ARENA.halfWidth * 2;
const arenaDepth = ARENA.frontZ - ARENA.backZ;
const arenaCenterZ = (ARENA.frontZ + ARENA.backZ) / 2;

const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0xbcbcbc,
  roughness: 1
});

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x999999,
  roughness: 1
});

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(arenaWidth, arenaDepth),
  floorMaterial
);

floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, arenaCenterZ);
scene.add(floor);

const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(arenaWidth, 14),
  wallMaterial
);

backWall.position.set(0, 7, ARENA.backZ);
scene.add(backWall);

const frontWall = new THREE.Mesh(
  new THREE.PlaneGeometry(arenaWidth, 14),
  wallMaterial
);

frontWall.rotation.y = Math.PI;
frontWall.position.set(0, 7, ARENA.frontZ);
scene.add(frontWall);

const sideWallGeometry = new THREE.PlaneGeometry(arenaDepth, 14);

const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
leftWall.rotation.y = Math.PI / 2;
leftWall.position.set(-ARENA.halfWidth, 7, arenaCenterZ);
scene.add(leftWall);

const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
rightWall.rotation.y = -Math.PI / 2;
rightWall.position.set(ARENA.halfWidth, 7, arenaCenterZ);
scene.add(rightWall);

/* ---------- MARCAÇÕES DA ARENA ---------- */

const blueMaterial = new THREE.MeshBasicMaterial({
  color: 0x00bfff
});

function makeLine(width, height, depth, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    blueMaterial
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

makeLine(arenaWidth, 0.055, 0.055, 0, 0.04, ARENA.backZ + 0.05);
makeLine(arenaWidth, 0.035, 0.07, 0, 0.025, -2);
makeLine(arenaWidth, 0.035, 0.07, 0, 0.025, 6);

/* ---------- PAREDES DO PEEKER'S ALLEY ---------- */

const peekWalls = new THREE.Group();
peekWalls.visible = false;
scene.add(peekWalls);

const peekWallMaterial = new THREE.MeshStandardMaterial({
  color: 0x7d858b,
  roughness: 0.95
});

const peekWallGeometry = new THREE.BoxGeometry(
  PEEK.wallHalfWidth * 2,
  PEEK.wallHeight,
  PEEK.wallDepth
);

const peekStripGeometry = new THREE.BoxGeometry(
  PEEK.wallHalfWidth * 2 + 0.02,
  0.08,
  PEEK.wallDepth + 0.02
);

const peekWallBoxes = [];

PEEK.wallXs.forEach((cx) => {
  const wall = new THREE.Mesh(peekWallGeometry, peekWallMaterial);
  wall.position.set(cx, PEEK.wallHeight / 2, PEEK.wallZ);

  const strip = new THREE.Mesh(peekStripGeometry, blueMaterial);
  strip.position.set(0, PEEK.wallHeight / 2, 0);
  wall.add(strip);

  peekWalls.add(wall);

  peekWallBoxes.push({
    minX: cx - PEEK.wallHalfWidth,
    maxX: cx + PEEK.wallHalfWidth,
    minZ: PEEK.wallZ - PEEK.wallDepth / 2,
    maxZ: PEEK.wallZ + PEEK.wallDepth / 2
  });
});

/* Cantos disponíveis: 4 paredes × 2 lados */
const peekCorners = [];

PEEK.wallXs.forEach((cx) => {
  [-1, 1].forEach((side) => {
    peekCorners.push({ cx, side });
  });
});

/* ---------- ALVOS ---------- */

const targetGroup = new THREE.Group();
scene.add(targetGroup);

const targetGeometry = new THREE.SphereGeometry(0.48, 28, 20);

const targetRingGeometry = new THREE.TorusGeometry(
  0.59,
  0.035,
  8,
  28
);

/* Alvo redondo do Gravity Flick */
const gravityBlockGeometry = new THREE.SphereGeometry(
  GRAVITY.size / 2,
  28,
  20
);

/* Inimigo do Peeker's Alley */
const enemyBodyGeometry = new THREE.CapsuleGeometry(0.28, 0.9, 6, 14);
const enemyHeadGeometry = new THREE.SphereGeometry(0.2, 20, 14);

const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);

function spawnTarget() {
  if (!game.running) return;

  const target = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    color: 0xff102d,
    emissive: 0x650010,
    emissiveIntensity: 0.45,
    roughness: 0.3
  });

  const sphere = new THREE.Mesh(targetGeometry, material);
  target.add(sphere);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xff7585
  });

  const ring = new THREE.Mesh(targetRingGeometry, ringMaterial);
  target.add(ring);

  const x = THREE.MathUtils.randFloat(-7, 7);
  const y = THREE.MathUtils.randFloat(1.8, 5.5);
  const z = trainingMode === 'tracking'
    ? TRACK.z
    : THREE.MathUtils.randFloat(-13, -9);

  target.position.set(x, y, z);

  target.userData.baseX = x;
  target.userData.baseY = y;
  target.userData.phase = Math.random() * Math.PI * 2;
  target.userData.speed = THREE.MathUtils.randFloat(0.8, 1.5);
  target.userData.born = performance.now();

  // Estado inicial do movimento do Tracking.
  target.userData.moveFrom = target.position.clone();
  target.userData.moveTo = target.position.clone();
  target.userData.moveStart = performance.now();
  target.userData.moveDuration = THREE.MathUtils.randFloat(0.65, 1.15);
  target.userData.lastDirection = null;
  target.userData.directionChanges = 0;
  target.userData.nextDirectionChange = 0;
  target.userData.moveSpeed = THREE.MathUtils.randFloat(0.85, 1.25);

  targetGroup.add(target);
  game.targets.push(target);
}

/* Cria um inimigo escondido atrás de um canto, que vai "peekar" */
function spawnPeeker(delay = 500) {
  if (!game.running) return;

  const occupied = new Set(
    game.targets.map((t) => t.userData.cornerId)
  );

  const free = peekCorners
    .map((corner, id) => ({ corner, id }))
    .filter(({ id }) => !occupied.has(id));

  const pool = free.length > 0
    ? free
    : peekCorners.map((corner, id) => ({ corner, id }));

  const { corner, id } = pool[Math.floor(Math.random() * pool.length)];

  const enemy = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xff102d,
    emissive: 0x650010,
    emissiveIntensity: 0.45,
    roughness: 0.4
  });

  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xff5a6e,
    emissive: 0x7a1020,
    emissiveIntensity: 0.5,
    roughness: 0.35
  });

  // Bots estáticos: alguns em pé, outros agachados.
  const crouched = Math.random() < PEEK.crouchChance;

  const body = new THREE.Mesh(enemyBodyGeometry, bodyMaterial);
  body.position.y = crouched ? 0.57 : 0.85;
  body.scale.y = crouched ? 0.62 : 1;
  enemy.add(body);

  const head = new THREE.Mesh(enemyHeadGeometry, headMaterial);
  head.position.y = crouched ? 1.2 : 1.8;
  head.userData.isHead = true;
  enemy.add(head);

  const hiddenX =
    corner.cx + corner.side * (PEEK.wallHalfWidth - 0.85);

  const visibleX =
    corner.cx +
    corner.side *
      (PEEK.wallHalfWidth +
        THREE.MathUtils.randFloat(
          PEEK.cornerOffsetMin,
          PEEK.cornerOffsetMax
        ));

  enemy.position.set(hiddenX, 0, PEEK.enemyZ);

  const now = performance.now();

  enemy.userData.cornerId = id;
  enemy.userData.hiddenX = hiddenX;
  enemy.userData.visibleX = visibleX;
  enemy.userData.phase = 'wait';
  enemy.userData.phaseStart = now;
  enemy.userData.phaseEnd = now + delay;
  enemy.userData.holdTime = THREE.MathUtils.randFloat(
    PEEK.holdMin,
    PEEK.holdMax
  );

  targetGroup.add(enemy);
  game.targets.push(enemy);
}

function updatePeeker(enemy, now) {
  const data = enemy.userData;

  switch (data.phase) {
    case 'wait': {
      enemy.position.x = data.hiddenX;

      if (now >= data.phaseEnd) {
        data.phase = 'out';
        data.phaseStart = now;
        data.phaseEnd = now + PEEK.outTime;
      }
      break;
    }

    case 'out': {
      const p = THREE.MathUtils.clamp(
        (now - data.phaseStart) / PEEK.outTime,
        0,
        1
      );

      const ease = 1 - Math.pow(1 - p, 3);

      enemy.position.x = THREE.MathUtils.lerp(
        data.hiddenX,
        data.visibleX,
        ease
      );

      if (p >= 1) {
        data.phase = 'hold';
        data.phaseStart = now;
        data.phaseEnd = now + data.holdTime;
      }
      break;
    }

    case 'hold': {
      // Bot estático: fica parado no canto durante todo o lifespan.
      enemy.position.x = data.visibleX;

      if (now >= data.phaseEnd) {
        data.phase = 'in';
        data.phaseStart = now;
        data.phaseEnd = now + PEEK.inTime;
        data.fromX = enemy.position.x;
      }
      break;
    }

    case 'in': {
      const p = THREE.MathUtils.clamp(
        (now - data.phaseStart) / PEEK.inTime,
        0,
        1
      );

      const ease = p * p;

      enemy.position.x = THREE.MathUtils.lerp(
        data.fromX,
        data.hiddenX,
        ease
      );

      if (p >= 1) {
        // Sumiu sem levar tiro: quebra o combo e perde pontos.
        game.escaped++;
        game.combo = 0;
        game.score = Math.max(0, game.score - PEEK.escapePenalty);
        removeTarget(enemy);
        spawnPeeker(
          THREE.MathUtils.randFloat(PEEK.respawnMin, PEEK.respawnMax)
        );
      }
      break;
    }
  }

  // Inimigo olha para o jogador apenas no eixo horizontal.
  enemy.rotation.y = Math.atan2(
    camera.position.x - enemy.position.x,
    camera.position.z - enemy.position.z
  );
}

/* Cria um bloco que cai de cima até o chão */
function spawnGravityBlock(extraHeight = 0) {
  if (!game.running) return;

  const material = new THREE.MeshStandardMaterial({
    color: 0xff102d,
    emissive: 0x650010,
    emissiveIntensity: 0.45,
    roughness: 0.35
  });

  const block = new THREE.Mesh(gravityBlockGeometry, material);

  // Escolhe um X que não fique colado em outro bloco.
  let x = THREE.MathUtils.randFloat(-7, 7);

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = THREE.MathUtils.randFloat(-7, 7);

    const tooClose = game.targets.some(
      (t) => Math.abs(t.position.x - candidate) < GRAVITY.minGapX
    );

    x = candidate;
    if (!tooClose) break;
  }

  const z = THREE.MathUtils.randFloat(-13, -9);
  const y = GRAVITY.spawnY + extraHeight;

  block.position.set(x, y, z);

  // Velocidade variada, com leve aumento ao longo da partida.
  const progress = 1 - game.time / game.duration;
  const ramp = 1 + THREE.MathUtils.clamp(progress, 0, 1) * GRAVITY.rampUp;

  block.userData.speed =
    THREE.MathUtils.randFloat(GRAVITY.minSpeed, GRAVITY.maxSpeed) * ramp;

  targetGroup.add(block);
  game.targets.push(block);
}

function removeTarget(target) {
  targetGroup.remove(target);

  target.traverse((object) => {
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  });

  game.targets = game.targets.filter(
    (item) => item !== target
  );
}

function resetTargets() {
  [...game.targets].forEach(removeTarget);

  peekWalls.visible = trainingMode === 'peek';

  if (trainingMode === 'peek') {
    for (let i = 0; i < PEEK.concurrent; i++) {
      spawnPeeker(450 + i * 550);
    }
    return;
  }

  if (trainingMode === 'gravity') {
    for (let i = 0; i < GRAVITY.concurrent; i++) {
      spawnGravityBlock(i * 4 + Math.random());
    }
    return;
  }

  const count = trainingMode === 'tracking' ? 1 : 5;

  for (let i = 0; i < count; i++) {
    spawnTarget();
  }
}

/* ---------- COLISÃO COM AS PAREDES (PEEK) ---------- */

function collideWithPeekWalls() {
  if (trainingMode !== 'peek') return;

  const margin = 0.4;

  for (const box of peekWallBoxes) {
    const px = camera.position.x;
    const pz = camera.position.z;

    const inside =
      px > box.minX - margin &&
      px < box.maxX + margin &&
      pz > box.minZ - margin &&
      pz < box.maxZ + margin;

    if (!inside) continue;

    const pushLeft = px - (box.minX - margin);
    const pushRight = (box.maxX + margin) - px;
    const pushFront = (box.maxZ + margin) - pz;
    const pushBack = pz - (box.minZ - margin);

    const smallest = Math.min(
      pushLeft,
      pushRight,
      pushFront,
      pushBack
    );

    if (smallest === pushLeft) {
      camera.position.x = box.minX - margin;
    } else if (smallest === pushRight) {
      camera.position.x = box.maxX + margin;
    } else if (smallest === pushFront) {
      camera.position.z = box.maxZ + margin;
    } else {
      camera.position.z = box.minZ - margin;
    }
  }
}

/* ---------- SOM DE ACERTO ---------- */

function playHitSound() {
  try {
    audioContext ??= new (
      window.AudioContext || window.webkitAudioContext
    )();

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();

    oscillator.type = 'sine';

    oscillator.frequency.setValueAtTime(740, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      1180,
      now + 0.075
    );

    volume.gain.setValueAtTime(0.18, now);
    volume.gain.exponentialRampToValueAtTime(
      0.001,
      now + 0.14
    );

    oscillator.connect(volume);
    volume.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.14);
  } catch (error) {
    console.warn('Não foi possível reproduzir o som:', error);
  }
}

/* ---------- HUD E ESTATÍSTICAS ---------- */

const MODE_LABELS = {
  flick: 'FLICK',
  tracking: 'TRACKING',
  debris: 'PRECISION',
  peek: 'PEEKER',
  gravity: 'GRAVITY'
};

function updateHUD() {
  const total = game.hits + game.misses;

  const accuracy = trainingMode === 'tracking'
    ? (
        game.trackingChecks > 0
          ? Math.round(
              Math.min(
                1,
                game.trackingTime / game.trackingChecks
              ) * 100
            )
          : 0
      )
    : (
        total > 0
          ? Math.round((game.hits / total) * 100)
          : 100
      );

  $('#hud-mode').textContent = MODE_LABELS[trainingMode];

  // Pontuação sempre inteira, sem casas decimais.
  game.score = Math.max(0, Math.round(game.score));
  $('#hud-score').textContent = game.score.toLocaleString('pt-BR');

  $('#hud-hits').textContent = Math.floor(game.hits);
  $('#hud-accuracy').textContent = `${accuracy}%`;
  $('#hud-time').textContent = Math.ceil(Math.max(0, game.time));

  $('#hud-combo-box').style.display =
    trainingMode === 'peek' ? 'block' : 'none';
  $('#hud-combo').textContent = `x${comboMultiplier().toFixed(1)}`;
}

/* ---------- TOLERÂNCIA DA MIRA E DESTINOS DO TRACKING ---------- */

/* Distância do raio da mira (centro da tela) até um ponto do mundo */
function aimDistanceTo(point) {
  const toPoint = point.clone().sub(raycaster.ray.origin);
  if (toPoint.dot(raycaster.ray.direction) <= 0) return Infinity;
  return raycaster.ray.distanceToPoint(point);
}

/* Alvo esférico mais próximo da mira dentro da tolerância */
function findSphereWithTolerance(
  limit = AIM.sphereRadius * AIM.sphereTolerance
) {
  raycaster.setFromCamera(screenCenter, camera);

  let best = null;
  let bestDist = Infinity;

  for (const target of game.targets) {
    const d = aimDistanceTo(target.position);
    if (d <= limit && d < bestDist) {
      best = target;
      bestDist = d;
    }
  }

  return best;
}

/* Peeker: cabeça/corpo com tolerância, respeitando a oclusão das paredes */
function findPeekWithTolerance(wallDistance) {
  const headLimit = 0.2 * AIM.headTolerance;
  const bodyLimit = 0.28 * AIM.bodyTolerance;

  const p = new THREE.Vector3();
  let best = null;
  let bestScore = Infinity;

  for (const enemy of game.targets) {
    if (enemy.userData.phase === 'wait') continue;

    for (const part of enemy.children) {
      const isHead = Boolean(part.userData.isHead);
      part.getWorldPosition(p);

      // Parte escondida atrás da parede não conta
      if (camera.position.distanceTo(p) > wallDistance) continue;

      const d = aimDistanceTo(p);
      const limit = isHead ? headLimit : bodyLimit;

      if (d <= limit) {
        // Normaliza pelo limite e dá leve preferência à cabeça
        const score = d / limit - (isHead ? 0.25 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = { root: enemy, headshot: isHead };
        }
      }
    }
  }

  return best;
}

/* Escolhe o próximo destino do Tracking com proporção H/V controlada */
function pickTrackingDestination(position, previousDirection, minDist, maxDist) {
  const { minX, maxX, minY, maxY } = TRACK;

  let best = null;
  let bestDiff = -1;

  for (let attempt = 0; attempt < 10; attempt++) {
    const distance = THREE.MathUtils.randFloat(minDist, maxDist);

    const hShare = THREE.MathUtils.clamp(
      TRACK_H_SHARE + THREE.MathUtils.randFloat(-0.15, 0.15),
      0.3,
      0.85
    );

    let dx = distance * hShare * (Math.random() < 0.5 ? -1 : 1);
    let dy = distance * (1 - hShare) * (Math.random() < 0.5 ? -1 : 1);

    // Se passaria do limite, inverte o sentido em vez de "grudar" na borda
    if (position.x + dx < minX || position.x + dx > maxX) dx = -dx;
    if (position.y + dy < minY || position.y + dy > maxY) dy = -dy;

    const x = THREE.MathUtils.clamp(position.x + dx, minX, maxX);
    const y = THREE.MathUtils.clamp(position.y + dy, minY, maxY);

    const realDx = x - position.x;
    const realDy = y - position.y;

    if (Math.hypot(realDx, realDy) < 1) continue;

    const direction = Math.atan2(realDy, realDx);

    let diff = Math.PI;
    if (previousDirection !== null) {
      diff = Math.abs(
        Math.atan2(
          Math.sin(direction - previousDirection),
          Math.cos(direction - previousDirection)
        )
      );
    }

    if (diff > bestDiff) {
      bestDiff = diff;
      best = { x, y, direction };
    }

    if (previousDirection === null || diff > 1.0) break;
  }

  return best ?? {
    x: 0,
    y: (minY + maxY) / 2,
    direction: previousDirection ?? 0
  };
}

/* ---------- DISPARO ---------- */

function findTargetRoot(object) {
  while (object && object.parent !== targetGroup) {
    object = object.parent;
  }

  return object && object.parent === targetGroup ? object : null;
}

function flashCrosshair() {
  crosshair.style.transform =
    'translate(-50%, -50%) scale(1.35)';

  setTimeout(() => {
    crosshair.style.transform =
      'translate(-50%, -50%) scale(1)';
  }, 90);
}

function shoot() {
  if (!game.running || !game.locked) return;

  // No Tracking, o objetivo é seguir a bolinha; não é necessário clicar.
  if (trainingMode === 'tracking') return;

  const now = performance.now();
  if (now - game.lastShot < 120) return;

  game.lastShot = now;

  raycaster.setFromCamera(screenCenter, camera);

  let hitTarget = null;
  let headshot = false;

  if (trainingMode === 'peek') {
    // As paredes bloqueiam o tiro; inimigos escondidos não são alvos.
    const peekTargets = game.targets.filter(
      (t) => t.userData.phase !== 'wait'
    );

    const intersections = raycaster.intersectObjects(
      [...peekWalls.children, ...peekTargets],
      true
    );

    if (intersections.length > 0) {
      const first = intersections[0];
      const root = findTargetRoot(first.object);

      if (root) {
        hitTarget = root;
        headshot = Boolean(first.object.userData.isHead);
      }
    }

    // Tolerância: se a mira passou perto, conta como acerto
    if (!hitTarget) {
      const wallHit = raycaster.intersectObjects(peekWalls.children, true)[0];
      const assisted = findPeekWithTolerance(
        wallHit ? wallHit.distance : Infinity
      );

      if (assisted) {
        hitTarget = assisted.root;
        headshot = assisted.headshot;
      }
    }
  } else {
    const intersections = raycaster.intersectObjects(
      targetGroup.children,
      true
    );

    if (intersections.length > 0) {
      hitTarget = findTargetRoot(intersections[0].object);
    }

    // Tolerância: se a mira passou perto, conta como acerto
    if (!hitTarget) {
      hitTarget = trainingMode === 'gravity'
        ? findSphereWithTolerance(GRAVITY.hitRadius)
        : findSphereWithTolerance();
    }
  }

  if (hitTarget) {
    game.hits++;

    if (trainingMode === 'peek') {
      const base = headshot ? PEEK.headshotBase : PEEK.bodyBase;

      game.combo++;
      game.bestCombo = Math.max(game.bestCombo, game.combo);
      game.score += base * comboMultiplier();

      if (headshot) game.headshots++;
    } else {
      if (trainingMode === 'gravity') {
        game.score += Math.round(
          GRAVITY.baseScore + hitTarget.userData.speed * GRAVITY.speedBonus
        );
      } else {
        game.score += trainingMode === 'debris' ? 150 : 100;
      }
    }

    playHitSound();
    removeTarget(hitTarget);

    if (trainingMode === 'peek') {
      spawnPeeker(
        THREE.MathUtils.randFloat(PEEK.respawnMin, PEEK.respawnMax)
      );
    } else if (trainingMode === 'gravity') {
      spawnGravityBlock(Math.random() * 3);
    } else {
      spawnTarget();
    }

    flashCrosshair();
  } else {
    game.misses++;
  }

  updateHUD();
}

/* ---------- CÂMERA E MOUSE ---------- */

function updateCamera() {
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

canvas.addEventListener('click', () => {
  if (!game.running) return;

  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
    return;
  }

  shoot();
});

function lockedMessage() {
  if (trainingMode === 'tracking') {
    return 'TRACKING · Mantenha a mira sobre a bolinha; não precisa clicar';
  }

  if (trainingMode === 'peek') {
    return 'PEEKER\'S ALLEY · Mire nas quinas · Headshot vale 3x · Deixar o alvo sumir quebra o combo';
  }

  if (trainingMode === 'gravity') {
    return 'GRAVITY FLICK · Acerte os alvos antes que toquem o chão · Rápidos valem mais';
  }

  return 'WASD para mover · Mouse para mirar · Clique para acertar';
}

document.addEventListener('pointerlockchange', () => {
  game.locked = document.pointerLockElement === canvas;

  if (game.locked) {
    message.textContent = lockedMessage();
  } else if (game.running) {
    message.textContent =
      'Clique na arena para capturar o mouse novamente';
  }
});

document.addEventListener('mousemove', (event) => {
  if (!game.locked || !game.running) return;

  yaw -= event.movementX * mouseSensitivity;
  pitch -= event.movementY * mouseSensitivity;

  pitch = THREE.MathUtils.clamp(
    pitch,
    -Math.PI / 2 + 0.05,
    Math.PI / 2 - 0.05
  );

  updateCamera();
});

/* ---------- TECLADO ---------- */

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  // Dentro de campos do painel (número, slider, select) as teclas funcionam normalmente.
  if (event.target.closest?.('input, select, textarea')) return;

  game.keys.add(key);

  if (
    [
      'w',
      'a',
      's',
      'd',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright'
    ].includes(key)
  ) {
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  game.keys.delete(event.key.toLowerCase());
});

window.addEventListener('blur', () => {
  game.keys.clear();
});

/* ---------- AJUSTES DE SENSIBILIDADE ---------- */

const sensitivitySlider = $('#sensitivity-slider');
const sensitivityValue = $('#sensitivity-value');
const sensitivityUnit = $('#sensitivity-unit');

/* Escalas de sensibilidade.
   factor = radianos de giro por "pixel" do mouse para cada 1.0 de sens.
   CS2: yaw 0.022°/count · Valorant: yaw 0.07°/count */
const DEG = Math.PI / 180;

const SENS_UNITS = {
  game: {
    factor: 1,
    scale: 100,
    min: 0.0005,
    max: 0.01,
    step: 0.0001,
    digits: 2,
    display: (v) => (v * 100).toFixed(2)
  },
  cs: {
    factor: 0.022 * DEG,
    scale: 1,
    min: 0.2,
    max: 10,
    step: 0.01,
    digits: 2,
    display: (v) => v.toFixed(2)
  },
  valorant: {
    factor: 0.07 * DEG,
    scale: 1,
    min: 0.05,
    max: 3.2,
    step: 0.01,
    digits: 3,
    display: (v) => v.toFixed(3)
  }
};

const DEFAULT_SENSITIVITY = 0.002;

function currentUnit() {
  return SENS_UNITS[sensitivityUnit.value];
}

function updateSensitivity() {
  const unit = currentUnit();
  const value = Number(sensitivitySlider.value);

  mouseSensitivity = value * unit.factor;
  sensitivityValue.value = unit.display(value);
}

/* Coloca o slider no valor equivalente a uma sensibilidade em radianos */
function setSliderFromRadians(radians) {
  const unit = currentUnit();

  sensitivitySlider.value = String(
    THREE.MathUtils.clamp(radians / unit.factor, unit.min, unit.max)
  );

  updateSensitivity();
}

/* Ao trocar a escala, mantém a mesma sensação e só converte o número */
sensitivityUnit.addEventListener('change', () => {
  const unit = currentUnit();
  const radians = mouseSensitivity;

  sensitivitySlider.min = String(unit.min);
  sensitivitySlider.max = String(unit.max);
  sensitivitySlider.step = String(unit.step);

  // Campo numérico na mesma escala exibida (ex.: CS:GO 0.89)
  const fix = (n) => String(Number((n * unit.scale).toFixed(4)));
  sensitivityValue.min = fix(unit.min);
  sensitivityValue.max = fix(unit.max);
  sensitivityValue.step = fix(unit.step);

  setSliderFromRadians(radians);
});

/* Enquanto digita, aplica o valor na hora sem mexer no texto do campo */
sensitivityValue.addEventListener('input', () => {
  const unit = currentUnit();
  const typed = Number(sensitivityValue.value.replace(',', '.'));

  if (!Number.isFinite(typed) || typed <= 0) return;

  const value = THREE.MathUtils.clamp(typed / unit.scale, unit.min, unit.max);

  sensitivitySlider.value = String(value);
  mouseSensitivity = value * unit.factor;
});

/* Digitar o valor exato (ex.: 0.89) e confirmar com Enter ou ao sair do campo */
sensitivityValue.addEventListener('change', () => {
  const unit = currentUnit();
  const typed = Number(sensitivityValue.value.replace(',', '.'));

  if (Number.isFinite(typed) && typed > 0) {
    sensitivitySlider.value = String(
      THREE.MathUtils.clamp(typed / unit.scale, unit.min, unit.max)
    );
  }

  updateSensitivity();
});

sensitivitySlider.addEventListener(
  'input',
  updateSensitivity
);

$('#sensitivity-reset').addEventListener('click', () => {
  setSliderFromRadians(DEFAULT_SENSITIVITY);
});

/* ---------- TROCA DE MODO E DURAÇÃO ---------- */

$('#apply-settings').addEventListener('click', () => {
  trainingMode = $('#training-mode').value;

  const newDuration = Number(
    $('#training-duration').value
  );

  game.duration = newDuration;
  game.time = newDuration;

  game.score = 0;
  game.hits = 0;
  game.misses = 0;
  game.escaped = 0;
  game.headshots = 0;
  game.combo = 0;
  game.bestCombo = 0;
  game.lastShot = 0;
  game.trackingTime = 0;
  game.trackingChecks = 0;

  // Reposiciona o jogador para não ficar preso dentro de paredes.
  camera.position.set(0, 1.7, ARENA.startZ);

  resetTargets();
  updateHUD();

  message.textContent = {
    flick: 'FLICK / SPEED · Alvos parados para treinar movimentos rápidos',
    tracking: 'TRACKING · Siga a única bolinha com a mira; não precisa clicar',
    debris: 'PRECISION ARENA · Treino livre de precisão',
    peek: 'PEEKER\'S ALLEY · Alvos aparecem nas quinas por ~1s; em pé ou agachados',
    gravity: 'GRAVITY FLICK · Alvos caem de cima; acerte antes de tocarem o chão'
  }[trainingMode];
});

/* ---------- RESULTADO E REINÍCIO ---------- */

function finishGame() {
  game.running = false;

  document.exitPointerLock?.();

  const total = game.hits + game.misses;

  const accuracy = trainingMode === 'tracking'
    ? (
        game.trackingChecks > 0
          ? Math.round(
              game.trackingTime /
              game.trackingChecks *
              100
            )
          : 0
      )
    : (
        total
          ? Math.round(game.hits / total * 100)
          : 100
      );

  if (trainingMode === 'tracking') {
    $('#final-result').innerHTML =
      `Modo: <strong>TRACKING</strong><br>
       Pontuação: <strong>${Math.floor(game.score)}</strong><br>
       Tempo com a mira no alvo: <strong>${game.trackingTime.toFixed(1).replace('.', ',')} s</strong><br>
       Acompanhamento: <strong>${accuracy}%</strong>`;
  } else if (trainingMode === 'gravity') {
    $('#final-result').innerHTML =
      `Modo: <strong>GRAVITY FLICK</strong><br>
       Pontuação: <strong>${Math.floor(game.score)}</strong><br>
       Alvos destruídos: <strong>${game.hits}</strong><br>
       Caíram no chão: <strong>${game.escaped}</strong><br>
       Tiros errados: <strong>${game.misses}</strong><br>
       Precisão: <strong>${accuracy}%</strong>`;
  } else if (trainingMode === 'peek') {
    $('#final-result').innerHTML =
      `Modo: <strong>PEEKER'S ALLEY</strong><br>
       Pontuação: <strong>${Math.floor(game.score)}</strong><br>
       Abates: <strong>${game.hits}</strong> (headshots: <strong>${game.headshots}</strong>)<br>
       Sumiram sem levar tiro: <strong>${game.escaped}</strong><br>
       Melhor combo: <strong>${game.bestCombo}</strong><br>
       Tiros errados: <strong>${game.misses}</strong><br>
       Precisão: <strong>${accuracy}%</strong>`;
  } else {
    $('#final-result').innerHTML =
      `Modo: <strong>${
        trainingMode === 'debris' ? 'PRECISION ARENA' : 'FLICK'
      }</strong><br>
       Pontuação: <strong>${Math.floor(game.score)}</strong><br>
       Acertos: <strong>${game.hits}</strong><br>
       Erros: <strong>${game.misses}</strong><br>
       Precisão: <strong>${accuracy}%</strong>`;
  }

  endScreen.style.display = 'flex';
}

function restartGame() {
  game.score = 0;
  game.hits = 0;
  game.misses = 0;
  game.escaped = 0;
  game.headshots = 0;
  game.combo = 0;
  game.bestCombo = 0;
  game.time = game.duration;
  game.running = true;
  game.lastShot = 0;
  game.trackingTime = 0;
  game.trackingChecks = 0;

  yaw = 0;
  pitch = 0;

  camera.position.set(0, 1.7, ARENA.startZ);
  updateCamera();

  endScreen.style.display = 'none';

  resetTargets();
  updateHUD();

  previousTime = performance.now();

  canvas.requestPointerLock?.();
}

$('#restart-game').addEventListener(
  'click',
  restartGame
);

/* ---------- LOOP DO JOGO ---------- */

function animate(now) {
  requestAnimationFrame(animate);

  const delta = Math.min(
    (now - previousTime) / 1000,
    0.05
  );

  previousTime = now;

  if (game.running) {
    game.time = Math.max(0, game.time - delta);

    if (game.time <= 0) {
      updateHUD();
      finishGame();
    } else {
      /* Movimento WASD relativo à câmera */

      const forward = new THREE.Vector3(
        -Math.sin(yaw),
        0,
        -Math.cos(yaw)
      );

      const right = new THREE.Vector3(
        Math.cos(yaw),
        0,
        -Math.sin(yaw)
      );

      const movement = new THREE.Vector3();

      if (
        game.keys.has('w') ||
        game.keys.has('arrowup')
      ) {
        movement.add(forward);
      }

      if (
        game.keys.has('s') ||
        game.keys.has('arrowdown')
      ) {
        movement.sub(forward);
      }

      if (
        game.keys.has('d') ||
        game.keys.has('arrowright')
      ) {
        movement.add(right);
      }

      if (
        game.keys.has('a') ||
        game.keys.has('arrowleft')
      ) {
        movement.sub(right);
      }

      if (movement.lengthSq() > 0) {
        movement.normalize().multiplyScalar(7 * delta);
        camera.position.add(movement);

        camera.position.x = THREE.MathUtils.clamp(
          camera.position.x,
          -(ARENA.halfWidth - 2),
          ARENA.halfWidth - 2
        );

        camera.position.z = THREE.MathUtils.clamp(
          camera.position.z,
          ARENA.minZ,
          ARENA.maxZ
        );

        camera.position.y = 1.7;

        collideWithPeekWalls();
      }

      /* Comportamento dos modos */

      for (const target of game.targets) {
        const data = target.userData;
        const t = now / 1000;

        if (trainingMode === 'peek') {
          updatePeeker(target, now);
          continue;
        }

        if (trainingMode === 'gravity') {
          target.position.y -= data.speed * delta;

          // Tocou o chão sem ser acertado: perde pontos.
          if (target.position.y - GRAVITY.size / 2 <= 0) {
            game.escaped++;
            game.score = Math.max(0, game.score - GRAVITY.missPenalty);
            removeTarget(target);
            spawnGravityBlock(Math.random() * 3);
          }

          continue;
        }

        if (trainingMode === 'flick') {
          // Alvos estáticos para Flick.
          target.position.x = data.baseX;
          target.position.y = data.baseY;

        } else if (trainingMode === 'tracking') {
          // Tracking: movimento imprevisível, suave e com
          // mudanças ocasionais de direção no meio do trajeto.
          // Proporção horizontal/vertical controlada por TRACK_H_SHARE.

          // Garante que o estado inicial corresponda à posição real.
          if (
            !data.moveFrom ||
            !data.moveTo ||
            data.moveStart === undefined ||
            data.moveDuration === undefined
          ) {
            data.moveFrom = target.position.clone();
            data.moveTo = target.position.clone();
            data.moveStart = now;
            data.moveDuration = THREE.MathUtils.randFloat(0.65, 1.15);
            data.lastDirection = null;
            data.directionChanges = 0;
            data.nextDirectionChange = now + 500;
            data.moveSpeed = THREE.MathUtils.randFloat(0.85, 1.25);
          }

          // Chance de mudar de direção antes de chegar ao destino.
          if (
            now >= data.nextDirectionChange &&
            Math.random() < 0.045
          ) {
            const currentPosition = target.position.clone();

            data.moveFrom.copy(currentPosition);

            const dest = pickTrackingDestination(
              currentPosition,
              data.lastDirection,
              2.5,
              6.0
            );

            data.moveTo.set(dest.x, dest.y, TRACK.z);
            data.lastDirection = dest.direction;
            data.moveStart = now;

            // Algumas mudanças são rápidas; outras, mais lentas.
            data.moveDuration = Math.random() < 0.25
              ? THREE.MathUtils.randFloat(0.5, 0.75)
              : THREE.MathUtils.randFloat(0.65, 1.2);

            data.moveSpeed = THREE.MathUtils.randFloat(0.8, 1.35);
            data.nextDirectionChange = now + THREE.MathUtils.randFloat(350, 900);
          }

          // Escolhe um novo destino quando termina o movimento.
          if (
            now - data.moveStart >= data.moveDuration * 1000
          ) {
            data.moveFrom.copy(target.position);

            const dest = pickTrackingDestination(
              target.position,
              data.lastDirection,
              3.0,
              7.0
            );

            data.moveTo.set(dest.x, dest.y, TRACK.z);
            data.lastDirection = dest.direction;
            data.moveStart = now;

            // Velocidade controlada, com acelerações ocasionais.
            data.moveDuration = Math.random() < 0.22
              ? THREE.MathUtils.randFloat(0.5, 0.75)
              : THREE.MathUtils.randFloat(0.65, 1.2);

            data.moveSpeed = THREE.MathUtils.randFloat(0.85, 1.3);
            data.nextDirectionChange = now + THREE.MathUtils.randFloat(350, 900);
          }

          // Interpolação suave, com velocidade variável.
          const elapsed = (now - data.moveStart) / 1000;
          const progress = THREE.MathUtils.clamp(
            elapsed / data.moveDuration,
            0,
            1
          );

          const smooth = progress * progress * (3 - 2 * progress);

          target.position.lerpVectors(
            data.moveFrom,
            data.moveTo,
            smooth
          );

          // Pequena oscilação natural, sem dominar a trajetória.
          target.position.y +=
            Math.sin(now * 0.004 + data.phase) * 0.012;

        } else {
          // Precision Arena: movimento leve.
          target.position.x =
            data.baseX +
            Math.sin(t * 0.7 * data.speed + data.phase) * 0.8;

          target.position.y =
            data.baseY +
            Math.sin(t * 0.8 + data.phase) * 0.25;
        }

        target.lookAt(camera.position);
      }

      /* Pontuação do Tracking (com tolerância) */

      if (
        trainingMode === 'tracking' &&
        game.targets.length > 0
      ) {
        game.trackingChecks += delta;

        raycaster.setFromCamera(screenCenter, camera);

        const tracked = game.targets[0];
        const limit = AIM.sphereRadius * AIM.sphereTolerance;

        if (aimDistanceTo(tracked.position) <= limit) {
          game.trackingTime += delta;
          game.score += delta * 100;
        }
      }

      updateHUD();
    }
  }

  renderer.render(scene, camera);
}

/* ---------- REDIMENSIONAR ---------- */

window.addEventListener('resize', () => {
  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
  );
});

/* ---------- INICIALIZAÇÃO ---------- */

updateSensitivity();
resetTargets();
updateHUD();

requestAnimationFrame(animate);
