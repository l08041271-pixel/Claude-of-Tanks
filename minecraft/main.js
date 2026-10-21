// Minecraft 3D — a dependency-light voxel sandbox built on Three.js.
// Three.js is loaded from a CDN (MIT, https://threejs.org) with a mirror fallback.

const CDNS = [
  'https://unpkg.com/three@0.169.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js',
];

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const playBtn = $('play');

let THREE = null;
for (const url of CDNS) {
  try {
    THREE = await import(url);
    break;
  } catch (err) {
    console.warn('[minecraft3d] import failed:', url, err);
  }
}
if (!THREE) {
  statusEl.textContent = 'Could not load Three.js. Check your connection and reload.';
  throw new Error('three.js unavailable');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHUNK = 16;
const WORLD_X = 128;
const WORLD_Y = 64;
const WORLD_Z = 128;
const SEA_LEVEL = 22;
const EYE_HEIGHT = 1.62;
const PLAYER_HALF = 0.3;
const PLAYER_HEIGHT = 1.8;
const REACH = 6;
const SAVE_PREFIX = 'minecraft3d.save.v1.';

const AIR = 0;
const GRASS = 1;
const DIRT = 2;
const STONE = 3;
const SAND = 4;
const LOG = 5;
const LEAVES = 6;
const PLANKS = 7;
const GLASS = 8;
const BRICK = 9;
const WATER = 10;
const SNOW = 11;

const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, GLASS, BRICK];

const NAMES = {
  [GRASS]: 'Grass Block',
  [DIRT]: 'Dirt',
  [STONE]: 'Stone',
  [SAND]: 'Sand',
  [LOG]: 'Oak Log',
  [LEAVES]: 'Oak Leaves',
  [PLANKS]: 'Oak Planks',
  [GLASS]: 'Glass',
  [BRICK]: 'Bricks',
  [WATER]: 'Water',
  [SNOW]: 'Snow',
};

// Atlas tile ids (4x4 grid of 16px tiles).
const T = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3,
  sand: 4, logSide: 5, logTop: 6, leaves: 7,
  planks: 8, glass: 9, brick: 10, water: 11,
  snow: 12,
};

// Face order: +X, -X, +Y, -Y, +Z, -Z
const BLOCK_TILES = {
  [GRASS]: [T.grassSide, T.grassSide, T.grassTop, T.dirt, T.grassSide, T.grassSide],
  [DIRT]: [T.dirt, T.dirt, T.dirt, T.dirt, T.dirt, T.dirt],
  [STONE]: [T.stone, T.stone, T.stone, T.stone, T.stone, T.stone],
  [SAND]: [T.sand, T.sand, T.sand, T.sand, T.sand, T.sand],
  [LOG]: [T.logSide, T.logSide, T.logTop, T.logTop, T.logSide, T.logSide],
  [LEAVES]: [T.leaves, T.leaves, T.leaves, T.leaves, T.leaves, T.leaves],
  [PLANKS]: [T.planks, T.planks, T.planks, T.planks, T.planks, T.planks],
  [GLASS]: [T.glass, T.glass, T.glass, T.glass, T.glass, T.glass],
  [BRICK]: [T.brick, T.brick, T.brick, T.brick, T.brick, T.brick],
  [WATER]: [T.water, T.water, T.water, T.water, T.water, T.water],
  [SNOW]: [T.snow, T.snow, T.snow, T.snow, T.snow, T.snow],
};

const FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.72, 0.72];
const AO_TABLE = [0.55, 0.7, 0.85, 1.0];
const PARTICLE_COLORS = {
  [GRASS]: 0x6fae45, [DIRT]: 0x866043, [STONE]: 0x8a8a8a, [SAND]: 0xdbcf9f,
  [LOG]: 0x6b4e2e, [LEAVES]: 0x4f8f36, [PLANKS]: 0xb08a50, [GLASS]: 0xd7edf5,
  [BRICK]: 0x9a4c3a, [SNOW]: 0xf2f8fc,
};

const FACES = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], tangents: [[0, 1, 0], [0, 0, 1]] },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], tangents: [[0, 1, 0], [0, 0, 1]] },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], tangents: [[1, 0, 0], [0, 0, 1]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tangents: [[1, 0, 0], [0, 0, 1]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], tangents: [[1, 0, 0], [0, 1, 0]] },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], tangents: [[1, 0, 0], [0, 1, 0]] },
];

// ---------------------------------------------------------------------------
// Seeded randomness + value noise
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const hash2 = (ix, iz) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 362437);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const value = (x, z) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = smooth(x - x0);
    const fz = smooth(z - z0);
    const a = hash2(x0, z0);
    const b = hash2(x0 + 1, z0);
    const c = hash2(x0, z0 + 1);
    const d = hash2(x0 + 1, z0 + 1);
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
  const fbm = (x, z, octaves = 4) => {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += value(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  return { hash2, fbm, value };
}

// ---------------------------------------------------------------------------
// Procedural texture atlas
// ---------------------------------------------------------------------------
function createAtlas() {
  const SIZE = 64;
  const TILE = 16;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);

  const rnd = (x, y, t) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + t * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

  const paint = (tile, base, variance, decorate) => {
    const ox = (tile % 4) * TILE;
    const oy = Math.floor(tile / 4) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const n = (rnd(x, y, tile) - 0.5) * 2 * variance;
        let color = [base[0] + n, base[1] + n, base[2] + n, 255];
        if (decorate) {
          const out = decorate(x, y, color, rnd(x, y, tile + 31));
          if (out) color = out;
        }
        if (color[3] === 0) continue;
        ctx.fillStyle = `rgb(${clamp(color[0])},${clamp(color[1])},${clamp(color[2])})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  };

  paint(T.grassTop, [112, 172, 68], 15);
  paint(T.grassSide, [134, 96, 67], 11, (x, y, c, r) => {
    const edge = 3 + ((x * 5 + Math.floor(r * 3)) % 3);
    if (y < edge) return [96 + r * 22, 158 + r * 24, 58 + r * 18, 255];
    if (y === edge && r > 0.62) return [104 + r * 22, 160 + r * 20, 62 + r * 16, 255];
    return null;
  });
  paint(T.dirt, [134, 96, 67], 13);
  paint(T.stone, [126, 126, 126], 12, (x, y, c, r) => (r > 0.9 ? [104, 104, 104, 255] : null));
  paint(T.sand, [220, 207, 160], 9);
  paint(T.logSide, [104, 74, 44], 9, (x, y, c) => {
    if ((x + (y >> 2) * 2) % 6 === 0) return [78, 54, 32, 255];
    if (x === 0 || x === 15) return [70, 48, 28, 255];
    return null;
  });
  paint(T.logTop, [162, 130, 84], 8, (x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1.4) return [92, 66, 40, 255];
    if (Math.floor(d) % 3 === 0) return [126, 96, 60, 255];
    return null;
  });
  paint(T.leaves, [66, 128, 44], 17, (x, y, c, r) => {
    if (r > 0.885) return [0, 0, 0, 0];
    if (r < 0.1) return [44, 96, 32, 255];
    return null;
  });
  paint(T.planks, [176, 137, 86], 8, (x, y) => {
    if (y % 5 === 0) return [132, 100, 58, 255];
    if ((y < 5 && x === 11) || (y >= 5 && y < 10 && x === 3) || (y >= 10 && x === 13)) return [138, 104, 62, 255];
    return null;
  });
  paint(T.glass, [186, 222, 234], 4, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [226, 246, 252, 255];
    if ((x + y) % 13 === 0) return [240, 252, 255, 255];
    if ((x + y) % 13 === 1) return [158, 200, 218, 255];
    return null;
  });
  paint(T.brick, [152, 72, 54], 7, (x, y) => {
    const row = Math.floor(y / 5);
    const offset = (row % 2) * 4;
    if (y % 5 === 0) return [176, 166, 152, 255];
    if ((x + offset) % 8 === 0) return [176, 166, 152, 255];
    return null;
  });
  paint(T.water, [46, 94, 176], 7, (x, y) => {
    if ((y + Math.round(1.6 * Math.sin(x * 0.9))) % 7 === 0) return [78, 132, 208, 255];
    return null;
  });
  paint(T.snow, [238, 246, 251], 4, (x, y, c, r) => (r > 0.93 ? [214, 230, 242, 255] : null));

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas, texture };
}

// ---------------------------------------------------------------------------
// World storage
// ---------------------------------------------------------------------------
function readStoredSeed() {
  try {
    const stored = Number(localStorage.getItem('minecraft3d.seed'));
    return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
  } catch {
    return 0;
  }
}

const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isFinite(urlSeed) && urlSeed > 0 ? Math.floor(urlSeed) : readStoredSeed() || (Math.random() * 1e9) | 0;
const saveKey = SAVE_PREFIX + seed;
try {
  localStorage.setItem('minecraft3d.seed', String(seed));
} catch {
  // Storage may be unavailable (private mode); the world still plays.
}

const blocks = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
const heightMap = new Int16Array(WORLD_X * WORLD_Z);
const edits = new Map();

const index = (x, y, z) => x + WORLD_X * (z + WORLD_Z * y);

function getBlock(x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= WORLD_X || y >= WORLD_Y || z >= WORLD_Z) return AIR;
  return blocks[index(x, y, z)];
}
function setRaw(x, y, z, block) {
  if (x < 0 || y < 0 || z < 0 || x >= WORLD_X || y >= WORLD_Y || z >= WORLD_Z) return;
  blocks[index(x, y, z)] = block;
}
function isSolidPick(block) {
  return block !== AIR && block !== WATER;
}
function isCollidable(block) {
  return block !== AIR && block !== WATER;
}
function isOpaqueForAO(block) {
  return block !== AIR && block !== WATER && block !== GLASS;
}

function generateWorld() {
  const noise = makeNoise(seed);
  for (let z = 0; z < WORLD_Z; z++) {
    for (let x = 0; x < WORLD_X; x++) {
      const broad = noise.fbm(x * 0.018, z * 0.018, 4);
      const detail = noise.fbm(x * 0.075 + 51.3, z * 0.075 + 17.7, 2);
      let h = Math.floor(23 + (broad - 0.5) * 30 + (detail - 0.5) * 6);
      h = Math.max(3, Math.min(WORLD_Y - 12, h));
      heightMap[x + z * WORLD_X] = h;

      const beach = h <= SEA_LEVEL + 1;
      const alpine = h >= 36;
      for (let y = 0; y <= h; y++) {
        let block;
        if (y === h) block = beach ? SAND : alpine ? SNOW : GRASS;
        else if (y >= h - 3) block = beach ? SAND : DIRT;
        else block = STONE;
        setRaw(x, y, z, block);
      }
      for (let y = h + 1; y <= SEA_LEVEL; y++) setRaw(x, y, z, WATER);
    }
  }

  // Oak trees, deterministically scattered on grass.
  const rng = mulberry32(seed ^ 0x9e3779b9);
  for (let z = 2; z < WORLD_Z - 2; z++) {
    for (let x = 2; x < WORLD_X - 2; x++) {
      if (rng() > 0.0075) continue;
      const h = heightMap[x + z * WORLD_X];
      if (getBlock(x, h, z) !== GRASS) continue;
      if (h <= SEA_LEVEL + 1 || h >= 34) continue;
      if (getBlock(x, h + 1, z) !== AIR || getBlock(x, h + 2, z) !== AIR) continue;

      const trunk = 4 + Math.floor(rng() * 3);
      for (let i = 1; i <= trunk; i++) setRaw(x, h + i, z, LOG);
      const crownY = h + trunk;
      for (let dy = -2; dy <= 1; dy++) {
        const radius = dy <= -1 ? 2 : 1;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dz === 0 && dy < 1) continue;
            if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && rng() < 0.65) continue;
            const tx = x + dx;
            const ty = crownY + dy;
            const tz = z + dz;
            if (getBlock(tx, ty, tz) === AIR) setRaw(tx, ty, tz, LEAVES);
          }
        }
      }
    }
  }
}

function loadEdits() {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 4) continue;
      const [x, y, z, block] = entry;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const b = Number(block) | 0;
      setRaw(x | 0, y | 0, z | 0, b);
      edits.set(`${x | 0},${y | 0},${z | 0}`, b);
    }
  } catch (err) {
    console.warn('[minecraft3d] could not load save', err);
  }
}

let saveTimer = 0;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 450);
}
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    const serialized = [];
    let count = 0;
    for (const [key, block] of edits) {
      if (count++ > 20000) break;
      const [x, y, z] = key.split(',').map(Number);
      serialized.push([x, y, z, block]);
    }
    localStorage.setItem(saveKey, JSON.stringify(serialized));
  } catch (err) {
    console.warn('[minecraft3d] could not save', err);
  }
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd2e6f2, 54, 132);

const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const { canvas: atlasCanvas, texture: atlasTexture } = createAtlas();

const opaqueMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  alphaTest: 0.5,
  fog: true,
});
const waterMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  transparent: true,
  opacity: 0.66,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: true,
});
const glassMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: true,
});

// ---------------------------------------------------------------------------
// Terrain meshing
// ---------------------------------------------------------------------------
const chunks = new Map();
const dirtyChunks = new Set();

function tileUV(tile) {
  const col = tile % 4;
  const row = Math.floor(tile / 4);
  // Half-texel inset keeps nearest-neighbour sampling inside the tile.
  const inset = 0.5 / 64;
  const u0 = col / 4 + inset;
  const u1 = (col + 1) / 4 - inset;
  const v0 = 1 - (row + 1) / 4 + inset;
  const v1 = 1 - row / 4 - inset;
  return { u0, u1, v0, v1 };
}

function vertexAO(gx, gy, gz, face, corner) {
  const t1 = face.tangents[0];
  const t2 = face.tangents[1];
  const d1 = corner[0] * t1[0] + corner[1] * t1[1] + corner[2] * t1[2] ? 1 : -1;
  const d2 = corner[0] * t2[0] + corner[1] * t2[1] + corner[2] * t2[2] ? 1 : -1;
  const bx = gx + face.n[0];
  const by = gy + face.n[1];
  const bz = gz + face.n[2];
  const s1 = isOpaqueForAO(getBlock(bx + t1[0] * d1, by + t1[1] * d1, bz + t1[2] * d1));
  const s2 = isOpaqueForAO(getBlock(bx + t2[0] * d2, by + t2[1] * d2, bz + t2[2] * d2));
  const c = isOpaqueForAO(getBlock(
    bx + t1[0] * d1 + t2[0] * d2,
    by + t1[1] * d1 + t2[1] * d2,
    bz + t1[2] * d1 + t2[2] * d2,
  ));
  const level = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
  return AO_TABLE[level];
}

function buildChunkGeometry(cx, cz) {
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const opaque = { pos: [], uv: [], col: [], idx: [] };
  const water = { pos: [], uv: [], col: [], idx: [] };
  const glass = { pos: [], uv: [], col: [], idx: [] };

  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const gx = ox + lx;
      const gz = oz + lz;
      for (let y = 0; y < WORLD_Y; y++) {
        const block = getBlock(gx, y, gz);
        if (block === AIR) continue;

        const isWater = block === WATER;
        const isGlass = block === GLASS;
        const target = isWater ? water : isGlass ? glass : opaque;
        const tiles = BLOCK_TILES[block] || BLOCK_TILES[STONE];

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nb = getBlock(gx + face.n[0], y + face.n[1], gz + face.n[2]);

          let visible;
          if (isWater) visible = nb === AIR;
          else if (isGlass) visible = nb === AIR || nb === WATER;
          else visible = nb !== AIR && nb !== WATER && nb !== GLASS ? false : true;

          if (!visible) continue;

          const { u0, u1, v0, v1 } = tileUV(tiles[f]);
          const base = target.pos.length / 3;
          const shade = FACE_SHADE[f];

          for (let j = 0; j < 4; j++) {
            const corner = face.corners[j];
            target.pos.push(lx + corner[0], y + corner[1], lz + corner[2]);
            if (j === 0) target.uv.push(u0, v0);
            else if (j === 1) target.uv.push(u1, v0);
            else if (j === 2) target.uv.push(u1, v1);
            else target.uv.push(u0, v1);
            const brightness = shade * vertexAO(gx, y, gz, face, corner);
            target.col.push(brightness, brightness, brightness);
          }
          target.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  return { opaque, water, glass };
}

function geometryFrom(data) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(data.col, 3));
  geo.setIndex(data.idx);
  geo.computeBoundingSphere();
  return geo;
}

function rebuildChunk(cx, cz) {
  if (cx < 0 || cz < 0 || cx * CHUNK >= WORLD_X || cz * CHUNK >= WORLD_Z) return;
  let chunk = chunks.get(`${cx},${cz}`);
  if (!chunk) {
    const opaqueMesh = new THREE.Mesh(new THREE.BufferGeometry(), opaqueMaterial);
    opaqueMesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    const waterMesh = new THREE.Mesh(new THREE.BufferGeometry(), waterMaterial);
    waterMesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    waterMesh.renderOrder = 2;
    const glassMesh = new THREE.Mesh(new THREE.BufferGeometry(), glassMaterial);
    glassMesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    glassMesh.renderOrder = 3;
    worldGroup.add(opaqueMesh, waterMesh, glassMesh);
    chunk = { cx, cz, opaqueMesh, waterMesh, glassMesh };
    chunks.set(`${cx},${cz}`, chunk);
  }

  const { opaque, water, glass } = buildChunkGeometry(cx, cz);

  chunk.opaqueMesh.geometry.dispose();
  chunk.opaqueMesh.geometry = geometryFrom(opaque);
  chunk.opaqueMesh.visible = opaque.idx.length > 0;

  chunk.waterMesh.geometry.dispose();
  chunk.waterMesh.geometry = geometryFrom(water);
  chunk.waterMesh.visible = water.idx.length > 0;

  chunk.glassMesh.geometry.dispose();
  chunk.glassMesh.geometry = geometryFrom(glass);
  chunk.glassMesh.visible = glass.idx.length > 0;
}

function markDirty(x, z) {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  dirtyChunks.add(`${cx},${cz}`);
  if (x % CHUNK === 0) dirtyChunks.add(`${cx - 1},${cz}`);
  if (x % CHUNK === CHUNK - 1) dirtyChunks.add(`${cx + 1},${cz}`);
  if (z % CHUNK === 0) dirtyChunks.add(`${cx},${cz - 1}`);
  if (z % CHUNK === CHUNK - 1) dirtyChunks.add(`${cx},${cz + 1}`);
}

function flushDirtyChunks() {
  if (!dirtyChunks.size) return;
  for (const key of dirtyChunks) {
    const [cx, cz] = key.split(',').map(Number);
    if (cx < 0 || cz < 0 || cx * CHUNK >= WORLD_X || cz * CHUNK >= WORLD_Z) continue;
    rebuildChunk(cx, cz);
  }
  dirtyChunks.clear();
}

function setBlockUser(x, y, z, block) {
  if (x < 0 || y < 0 || z < 0 || x >= WORLD_X || y >= WORLD_Y || z >= WORLD_Z) return false;
  if (getBlock(x, y, z) === block) return false;
  setRaw(x, y, z, block);
  edits.set(`${x},${y},${z}`, block);
  markDirty(x, z);
  queueSave();
  return true;
}

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);
{
  const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
    fog: true,
  });
  const cloudRng = mulberry32(seed ^ 0x1234abcd);
  const count = 46;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const sx = 8 + cloudRng() * 18;
    const sz = 6 + cloudRng() * 14;
    dummy.position.set(cloudRng() * 320 - 160, 58 + cloudRng() * 16, cloudRng() * 320 - 160);
    dummy.scale.set(sx, 1.6 + cloudRng() * 1.6, sz);
    dummy.rotation.y = cloudRng() * Math.PI;
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.frustumCulled = false;
  cloudGroup.add(clouds);
}

// ---------------------------------------------------------------------------
// Block particles
// ---------------------------------------------------------------------------
const PARTICLES = 180;
const particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const particleMat = new THREE.MeshBasicMaterial({ fog: false });
const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLES);
particleMesh.frustumCulled = false;
scene.add(particleMesh);

const particles = Array.from({ length: PARTICLES }, () => ({
  life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1,
}));
let particleCursor = 0;
const particleDummy = new THREE.Object3D();

for (let i = 0; i < PARTICLES; i++) {
  particleDummy.position.set(0, -1000, 0);
  particleDummy.scale.setScalar(0);
  particleDummy.updateMatrix();
  particleMesh.setMatrixAt(i, particleDummy.matrix);
  particleMesh.setColorAt(i, new THREE.Color(0xffffff));
}
particleMesh.instanceMatrix.needsUpdate = true;

function spawnBreakParticles(block, x, y, z) {
  const color = new THREE.Color(PARTICLE_COLORS[block] || 0x999999);
  for (let i = 0; i < 12; i++) {
    const slot = particleCursor;
    particleCursor = (particleCursor + 1) % PARTICLES;
    const p = particles[slot];
    p.life = p.maxLife = 0.45 + Math.random() * 0.45;
    p.x = x + 0.2 + Math.random() * 0.6;
    p.y = y + 0.2 + Math.random() * 0.6;
    p.z = z + 0.2 + Math.random() * 0.6;
    p.vx = (Math.random() - 0.5) * 3.4;
    p.vy = 1.4 + Math.random() * 3.2;
    p.vz = (Math.random() - 0.5) * 3.4;
    p.size = 0.7 + Math.random() * 0.7;
    particleMesh.setColorAt(slot, color);
  }
  if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
}

function updateParticles(dt) {
  let changed = false;
  for (let i = 0; i < PARTICLES; i++) {
    const p = particles[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    changed = true;
    if (p.life <= 0) {
      particleDummy.position.set(0, -1000, 0);
      particleDummy.scale.setScalar(0);
    } else {
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (isCollidable(getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))) {
        p.vy = Math.abs(p.vy) * 0.28;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.y += dt * Math.abs(p.vy) * 0.2;
      }
      const t = p.life / p.maxLife;
      particleDummy.position.set(p.x, p.y, p.z);
      particleDummy.rotation.set(p.x * 3.1, p.y * 2.3, p.z * 1.7);
      particleDummy.scale.setScalar(p.size * (0.35 + t * 0.65));
    }
    particleDummy.updateMatrix();
    particleMesh.setMatrixAt(i, particleDummy.matrix);
  }
  if (changed) particleMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Block highlight + held block
// ---------------------------------------------------------------------------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x101820, transparent: true, opacity: 0.6 }),
);
highlight.visible = false;
scene.add(highlight);

const handMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  transparent: true,
  opacity: 1,
  depthTest: false,
  depthWrite: false,
  fog: false,
  toneMapped: false,
});
const handMesh = new THREE.Mesh(new THREE.BufferGeometry(), handMaterial);
handMesh.position.set(0.6, -0.44, -0.95);
handMesh.rotation.set(0.24, -0.64, 0.12);
handMesh.scale.setScalar(0.2);
handMesh.renderOrder = 999;
camera.add(handMesh);
const handBase = handMesh.position.clone();

function buildUnitBlock(block) {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const tiles = BLOCK_TILES[block] || BLOCK_TILES[STONE];
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const { u0, u1, v0, v1 } = tileUV(tiles[f]);
    const base = pos.length / 3;
    for (let j = 0; j < 4; j++) {
      const c = face.corners[j];
      pos.push(c[0] - 0.5, c[1] - 0.5, c[2] - 0.5);
      if (j === 0) uv.push(u0, v0);
      else if (j === 1) uv.push(u1, v0);
      else if (j === 2) uv.push(u1, v1);
      else uv.push(u0, v1);
      const b = FACE_SHADE[f];
      col.push(b, b, b);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const player = {
  x: 64.5, y: 30, z: 64.5,
  vx: 0, vy: 0, vz: 0,
  onGround: false,
  bob: 0,
  fov: 70,
};

let yaw = 0.7;
let pitch = -0.18;
let started = false;
let locked = false;
let target = null;
let selected = 0;
let breakTimer = 0;
let placeTimer = 0;
let mouseLeft = false;
let mouseRight = false;
let statTimer = 0;
let fpsCounter = 0;
let fpsTimer = 0;

const keys = new Set();

function collides(px, py, pz) {
  const eps = 1e-5;
  const minX = Math.floor(px - PLAYER_HALF + eps);
  const maxX = Math.floor(px + PLAYER_HALF - eps);
  const minY = Math.floor(py + eps);
  const maxY = Math.floor(py + PLAYER_HEIGHT - eps);
  const minZ = Math.floor(pz - PLAYER_HALF + eps);
  const maxZ = Math.floor(pz + PLAYER_HALF - eps);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (isCollidable(getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function blockedByPlayer(bx, by, bz) {
  const eps = 1e-5;
  return (
    player.x + PLAYER_HALF > bx + eps &&
    player.x - PLAYER_HALF < bx + 1 - eps &&
    player.y + PLAYER_HEIGHT > by + eps &&
    player.y < by + 1 - eps &&
    player.z + PLAYER_HALF > bz + eps &&
    player.z - PLAYER_HALF < bz + 1 - eps
  );
}

function updatePlayer(dt) {
  const feetWater = getBlock(Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)) === WATER;
  const inWater = feetWater;

  let forward = 0;
  let strafe = 0;
  if (keys.has('KeyW')) forward += 1;
  if (keys.has('KeyS')) forward -= 1;
  if (keys.has('KeyD')) strafe += 1;
  if (keys.has('KeyA')) strafe -= 1;
  const moving = forward !== 0 || strafe !== 0;
  if (moving) {
    const len = Math.hypot(forward, strafe);
    forward /= len;
    strafe /= len;
  }

  const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let speed = sprinting ? 7.0 : 4.4;
  if (inWater) speed *= 0.62;

  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const targetVx = (-sin * forward + cos * strafe) * speed;
  const targetVz = (-cos * forward - sin * strafe) * speed;

  const groundAccel = player.onGround ? 16 : 5;
  const k = 1 - Math.exp(-groundAccel * dt);
  player.vx += (targetVx - player.vx) * k;
  player.vz += (targetVz - player.vz) * k;

  if (keys.has('Space') && player.onGround && !inWater) {
    player.vy = 8.4;
    player.onGround = false;
  }

  player.onGround = false;

  if (inWater) {
    player.vy -= 7 * dt;
    if (keys.has('Space')) player.vy += 20 * dt;
    player.vy = Math.max(-4, Math.min(4.6, player.vy));
  } else {
    player.vy -= 28 * dt;
    player.vy = Math.max(-55, player.vy);
  }

  let remaining = Math.min(dt, 0.1);
  while (remaining > 0) {
    const step = Math.min(remaining, 1 / 120);
    remaining -= step;

    const nx = player.x + player.vx * step;
    if (!collides(nx, player.y, player.z)) player.x = nx;
    else player.vx = 0;

    const nz = player.z + player.vz * step;
    if (!collides(player.x, player.y, nz)) player.z = nz;
    else player.vz = 0;

    const ny = player.y + player.vy * step;
    if (!collides(player.x, ny, player.z)) {
      player.y = ny;
    } else {
      if (player.vy < 0) player.onGround = true;
      player.vy = 0;
    }
  }

  player.x = Math.max(1.4, Math.min(WORLD_X - 1.4, player.x));
  player.z = Math.max(1.4, Math.min(WORLD_Z - 1.4, player.z));
  if (player.y < -8) {
    player.y = 50;
    player.vy = 0;
  }

  if (moving && player.onGround) player.bob += dt * (sprinting ? 13 : 9);

  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  const bobY = moving && player.onGround ? Math.sin(player.bob) * 0.036 : 0;
  const bobX = moving && player.onGround ? Math.cos(player.bob * 0.5) * 0.022 : 0;
  camera.position.set(player.x + bobX, player.y + EYE_HEIGHT + bobY, player.z);

  const targetFov = sprinting && moving && !inWater ? 76 : 70;
  player.fov += (targetFov - player.fov) * (1 - Math.exp(-8 * dt));
  if (Math.abs(camera.fov - player.fov) > 0.01) {
    camera.fov = player.fov;
    camera.updateProjectionMatrix();
  }

  handMesh.position.set(
    handBase.x + Math.sin(player.bob * 0.5) * 0.014,
    handBase.y - Math.abs(Math.cos(player.bob)) * 0.016,
    handBase.z,
  );
  handMesh.rotation.z = 0.12 + Math.sin(player.bob * 0.5) * 0.02;

  const eyeBlock = getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
  $('water-tint').classList.toggle('on', eyeBlock === WATER);
}

// ---------------------------------------------------------------------------
// Voxel raycast (Amanatides & Woo)
// ---------------------------------------------------------------------------
const camDir = new THREE.Vector3();

function raycastVoxel() {
  camera.getWorldDirection(camDir);
  const ox = camera.position.x;
  const oy = camera.position.y;
  const oz = camera.position.z;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = camDir.x > 0 ? 1 : -1;
  const stepY = camDir.y > 0 ? 1 : -1;
  const stepZ = camDir.z > 0 ? 1 : -1;

  const deltaX = camDir.x === 0 ? Infinity : Math.abs(1 / camDir.x);
  const deltaY = camDir.y === 0 ? Infinity : Math.abs(1 / camDir.y);
  const deltaZ = camDir.z === 0 ? Infinity : Math.abs(1 / camDir.z);

  let maxX = camDir.x === 0 ? Infinity : (stepX > 0 ? x + 1 - ox : ox - x) * deltaX;
  let maxY = camDir.y === 0 ? Infinity : (stepY > 0 ? y + 1 - oy : oy - y) * deltaY;
  let maxZ = camDir.z === 0 ? Infinity : (stepZ > 0 ? z + 1 - oz : oz - z) * deltaZ;

  let nx = 0;
  let ny = 0;
  let nz = 0;

  for (let i = 0; i < 96; i++) {
    const block = getBlock(x, y, z);
    if (isSolidPick(block)) {
      return { x, y, z, nx, ny, nz, block };
    }
    if (maxX < maxY && maxX < maxZ) {
      if (maxX > REACH) break;
      x += stepX;
      maxX += deltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (maxY < maxZ) {
      if (maxY > REACH) break;
      y += stepY;
      maxY += deltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      if (maxZ > REACH) break;
      z += stepZ;
      maxZ += deltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
    if (Math.min(maxX, maxY, maxZ) > REACH) break;
  }
  return null;
}

function updateTarget() {
  target = locked ? raycastVoxel() : null;
  if (target) {
    highlight.visible = true;
    highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  } else {
    highlight.visible = false;
  }
  $('crosshair').classList.toggle('target', !!target);
}

function doBreak() {
  if (!target) return;
  const { x, y, z, block } = target;
  if (setBlockUser(x, y, z, AIR)) {
    spawnBreakParticles(block, x, y, z);
    playSound('break');
    target = null;
    highlight.visible = false;
  }
}

function doPlace() {
  if (!target) return;
  const bx = target.x + target.nx;
  const by = target.y + target.ny;
  const bz = target.z + target.nz;
  if (bx < 0 || by < 0 || bz < 0 || bx >= WORLD_X || by >= WORLD_Y || bz >= WORLD_Z) return;
  const existing = getBlock(bx, by, bz);
  if (existing !== AIR && existing !== WATER) return;
  if (blockedByPlayer(bx, by, bz)) return;
  if (setBlockUser(bx, by, bz, HOTBAR[selected])) {
    playSound('place');
    target = null;
    highlight.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Audio (tiny synthesized thocks)
// ---------------------------------------------------------------------------
let audioCtx = null;
function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (err) {
    audioCtx = null;
  }
}
function playSound(kind) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = kind === 'break' ? 'square' : 'triangle';
  osc.frequency.setValueAtTime(kind === 'break' ? 150 : 320, now);
  osc.frequency.exponentialRampToValueAtTime(kind === 'break' ? 70 : 190, now + 0.09);
  gain.gain.setValueAtTime(0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const hotbarEl = $('hotbar');
const blockLabelEl = $('block-label');
const slotEls = [];

function sideTileForIcon(block) {
  const tiles = BLOCK_TILES[block] || BLOCK_TILES[STONE];
  return tiles[4];
}

function makeIcon(block) {
  const icon = document.createElement('canvas');
  icon.width = 32;
  icon.height = 32;
  const ctx = icon.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tile = sideTileForIcon(block);
  const sx = (tile % 4) * 16;
  const sy = Math.floor(tile / 4) * 16;
  ctx.drawImage(atlasCanvas, sx, sy, 16, 16, 0, 0, 32, 32);
  return icon;
}

HOTBAR.forEach((block, i) => {
  const slot = document.createElement('button');
  slot.className = 'slot' + (i === 0 ? ' selected' : '');
  slot.setAttribute('aria-label', NAMES[block]);
  slot.appendChild(makeIcon(block));
  const key = document.createElement('span');
  key.className = 'key';
  key.textContent = String(i + 1);
  slot.appendChild(key);
  slot.addEventListener('click', () => {
    selectSlot(i);
    if (started && !locked) requestLock();
  });
  hotbarEl.appendChild(slot);
  slotEls.push(slot);
});

function selectSlot(i) {
  selected = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  slotEls.forEach((el, idx) => el.classList.toggle('selected', idx === selected));
  blockLabelEl.textContent = NAMES[HOTBAR[selected]];
  handMesh.geometry.dispose();
  handMesh.geometry = buildUnitBlock(HOTBAR[selected]);
}

function requestLock() {
  initAudio();
  const result = canvas.requestPointerLock?.();
  if (result && typeof result.catch === 'function') {
    result.catch(() => {
      if (started) showPause();
    });
  }
}

function showPause() {
  $('pause').classList.remove('hidden');
  $('crosshair').classList.remove('on');
  $('hotbar-wrap').classList.remove('on');
  keys.clear();
  mouseLeft = false;
  mouseRight = false;
}
function hidePause() {
  $('pause').classList.add('hidden');
  $('crosshair').classList.add('on');
  $('hotbar-wrap').classList.add('on');
}

$('play').addEventListener('click', () => {
  initAudio();
  $('overlay').classList.add('hidden');
  started = true;
  hidePause();
  requestLock();
});

$('resume').addEventListener('click', () => {
  hidePause();
  requestLock();
});

$('new-world').addEventListener('click', () => {
  flushSave();
  localStorage.removeItem(saveKey);
  const params = new URLSearchParams(location.search);
  params.set('seed', String((Math.random() * 1e9) | 0));
  location.search = params.toString();
});

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) {
    hidePause();
  } else if (started) {
    showPause();
  }
  $('crosshair').classList.toggle('on', locked);
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sens = 0.0022;
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
});

document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) {
    mouseLeft = true;
    breakTimer = 0;
    doBreak();
  } else if (e.button === 2) {
    mouseRight = true;
    placeTimer = 0;
    doPlace();
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseLeft = false;
  if (e.button === 2) mouseRight = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && locked) e.preventDefault();
  if (!locked) return;
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= HOTBAR.length) selectSlot(n - 1);
    return;
  }
  keys.add(e.code);
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

document.addEventListener('wheel', (e) => {
  if (!locked) return;
  e.preventDefault();
  selectSlot(selected + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

window.addEventListener('blur', () => {
  keys.clear();
  mouseLeft = false;
  mouseRight = false;
});
window.addEventListener('beforeunload', flushSave);

// ---------------------------------------------------------------------------
// HUD + loop
// ---------------------------------------------------------------------------
function updateHUD(dt) {
  fpsCounter++;
  fpsTimer += dt;
  statTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsCounter = Math.round(fpsCounter / fpsTimer);
    fpsTimer = 0;
    $('stat-fps').textContent = `${fpsCounter} fps`;
  }
  if (statTimer >= 0.2) {
    statTimer = 0;
    $('stat-pos').textContent =
      `x ${player.x.toFixed(1)}  y ${player.y.toFixed(1)}  z ${player.z.toFixed(1)}`;
  }
}

const clock = new THREE.Clock();
let elapsed = 0;

function frame() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  elapsed += dt;

  cloudGroup.position.x = (cloudGroup.position.x + dt * 1.1) % 340;

  if (locked) {
    updatePlayer(dt);
    updateTarget();

    breakTimer -= dt;
    placeTimer -= dt;
    if (mouseLeft && breakTimer <= 0) {
      doBreak();
      breakTimer = 0.2;
    }
    if (mouseRight && placeTimer <= 0) {
      doPlace();
      placeTimer = 0.22;
    }
  } else if (started) {
    camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  updateParticles(dt);
  flushDirtyChunks();
  updateHUD(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function findSpawn() {
  const cx = Math.floor(WORLD_X / 2);
  const cz = Math.floor(WORLD_Z / 2);
  for (const wanted of [GRASS, SAND]) {
    for (let radius = 0; radius < 58; radius++) {
      const steps = radius === 0 ? 1 : Math.max(10, radius * 7);
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2 + radius * 0.7;
        const x = Math.round(cx + Math.cos(angle) * radius);
        const z = Math.round(cz + Math.sin(angle) * radius);
        if (x < 3 || z < 3 || x >= WORLD_X - 3 || z >= WORLD_Z - 3) continue;
        const h = heightMap[x + z * WORLD_X];
        if (getBlock(x, h, z) !== wanted) continue;
        if (h <= SEA_LEVEL + 1) continue;
        if (getBlock(x, h + 1, z) !== AIR || getBlock(x, h + 2, z) !== AIR) continue;
        return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    }
  }
  return { x: cx + 0.5, y: 42, z: cz + 0.5 };
}

async function boot() {
  const next = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 16)));

  statusEl.textContent = 'Shaping terrain…';
  await next();

  generateWorld();
  loadEdits();

  statusEl.textContent = 'Building chunks…';
  await next();

  for (let cz = 0; cz < WORLD_Z / CHUNK; cz++) {
    for (let cx = 0; cx < WORLD_X / CHUNK; cx++) {
      rebuildChunk(cx, cz);
    }
  }
  flushDirtyChunks();

  const spawn = findSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.z = spawn.z;
  camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  selectSlot(0);
  onResize();
  $('seed-line').textContent = `seed ${seed}`;
  statusEl.textContent = 'World ready — click Play';
  statusEl.classList.add('ready');
  playBtn.disabled = false;
  playBtn.textContent = '▶ Play';

  clock.start();
  requestAnimationFrame(frame);
}

// Small console API for tinkering and automated checks.
window.MC3D = {
  seed,
  getBlock,
  setBlock: setBlockUser,
  selectSlot,
  get state() {
    return {
      player: { x: player.x, y: player.y, z: player.z, onGround: player.onGround },
      target: target ? { ...target } : null,
      yaw, pitch, locked, selected,
    };
  },
  get stats() {
    let glassFaces = 0;
    let waterFaces = 0;
    for (const chunk of chunks.values()) {
      glassFaces += (chunk.glassMesh.geometry.index?.count || 0) / 6;
      waterFaces += (chunk.waterMesh.geometry.index?.count || 0) / 6;
    }
    return { chunks: chunks.size, glassFaces, waterFaces };
  },
};

boot().catch((err) => {
  console.error(err);
  statusEl.textContent = 'Something went wrong while generating the world.';
  statusEl.classList.remove('ready');
});
