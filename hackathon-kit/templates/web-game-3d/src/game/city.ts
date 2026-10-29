/**
 * Procedural city layout: a square grid of blocks separated by roads, with a
 * hand-built plaza in the middle. Pure and seeded: the same seed always gives
 * the same city, so hand-placed NPCs, props and zones never end up inside a
 * building. The output is plain transforms, rendered with instancing in World.tsx.
 */
import type { InstanceTransform, Vec3 } from './math';

export const CITY = {
  blocksPerSide: 7,
  blockSize: 30,
  roadWidth: 10,
  seed: 20_251_030,
} as const;

const PITCH = CITY.blockSize + CITY.roadWidth;
/** Half-size of the paved area, including the outer ring road. */
export const CITY_HALF_EXTENT = (CITY.blocksPerSide * PITCH) / 2 + CITY.roadWidth / 2;

const SIDEWALK_HEIGHT = 0.04;
const LOT_MARGIN = 2.5;
const LOT_GAP = 2;
const LOT_SIZE = (CITY.blockSize - 2 * LOT_MARGIN - LOT_GAP) / 2;
const PARK_CHANCE = 0.14;
const TOWER_CHANCE = 0.2;

const BUILDING_COLORS = [
  '#c9b79c', '#a7b4c2', '#d8d2c4', '#8f9ba8', '#b98b73',
  '#e0c9a6', '#7f8c8d', '#c2a48a', '#9fb3a0', '#d6b38a',
] as const;
const SIDEWALK_COLOR = '#9c9a93';
const PARK_COLOR = '#6f9a4f';

export interface CityLayout {
  /** Unit cubes scaled to footprint x height; position is the center. */
  buildings: InstanceTransform[];
  /** Rooftop structures (AC units, stair towers): cheap silhouette detail. */
  roofs: InstanceTransform[];
  sidewalks: InstanceTransform[];
  laneMarks: InstanceTransform[];
  /** Tree base positions; scale is a uniform size factor in x. */
  trees: InstanceTransform[];
  lamps: Vec3[];
}

type Random = () => number;

export function generateCity(seed: number = CITY.seed): CityLayout {
  const random = mulberry32(seed);
  const layout: CityLayout = { buildings: [], roofs: [], sidewalks: [], laneMarks: [], trees: [], lamps: [] };
  const center = (CITY.blocksPerSide - 1) / 2;
  const maxDistance = Math.hypot(center, center) * PITCH;

  for (let ix = 0; ix < CITY.blocksPerSide; ix++) {
    for (let iz = 0; iz < CITY.blocksPerSide; iz++) {
      const cx = (ix - center) * PITCH;
      const cz = (iz - center) * PITCH;
      addLamps(layout.lamps, cx, cz);
      if (ix === center && iz === center) continue; // the plaza is built by hand in Props.tsx

      const isPark = random() < PARK_CHANCE;
      layout.sidewalks.push({
        position: [cx, SIDEWALK_HEIGHT / 2, cz],
        scale: [CITY.blockSize, SIDEWALK_HEIGHT, CITY.blockSize],
        color: isPark ? PARK_COLOR : SIDEWALK_COLOR,
      });
      if (isPark) addPark(layout.trees, cx, cz, random);
      // Downtown is taller: 1 at the center, 0 at the corners.
      else addBuildings(layout, cx, cz, 1 - Math.hypot(cx, cz) / maxDistance, random);
    }
  }
  addLaneMarks(layout.laneMarks);
  return layout;
}

function addBuildings(layout: CityLayout, cx: number, cz: number, downtown: number, random: Random): void {
  const heightScale = 0.9 + 2.4 * downtown * downtown;
  const place = (x: number, z: number, width: number, depth: number, height: number) => {
    layout.buildings.push({ position: [x, height / 2, z], scale: [width, height, depth], color: pickColor(random) });
    layout.roofs.push({
      position: [x + (random() - 0.5) * width * 0.3, height + 0.6, z + (random() - 0.5) * depth * 0.3],
      scale: [width * 0.3, 1.2, depth * 0.3],
    });
  };

  if (random() < TOWER_CHANCE) {
    const size = CITY.blockSize - 2 * LOT_MARGIN;
    place(cx, cz, size * 0.85, size * 0.85, (14 + random() * 16) * heightScale);
    return;
  }
  const offset = (LOT_SIZE + LOT_GAP) / 2;
  for (const dx of [-offset, offset]) {
    for (const dz of [-offset, offset]) {
      if (random() < 0.08) continue; // an empty lot now and then
      place(
        cx + dx,
        cz + dz,
        LOT_SIZE * (0.72 + 0.28 * random()),
        LOT_SIZE * (0.72 + 0.28 * random()),
        (6 + random() * 12) * heightScale,
      );
    }
  }
}

function addPark(trees: InstanceTransform[], cx: number, cz: number, random: Random): void {
  const spacing = (CITY.blockSize - 2 * LOT_MARGIN) / 3;
  for (const gx of [-1, 0, 1]) {
    for (const gz of [-1, 0, 1]) {
      const size = 0.8 + random() * 0.6;
      trees.push({
        position: [cx + gx * spacing + (random() - 0.5) * 3, 0, cz + gz * spacing + (random() - 0.5) * 3],
        scale: [size, size, size],
      });
    }
  }
}

function addLamps(lamps: Vec3[], cx: number, cz: number): void {
  const inset = CITY.blockSize / 2 - 0.8;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lamps.push([cx + sx * inset, 0, cz + sz * inset]);
}

/** Dashed center lines along every road segment (intersections stay clear). */
function addLaneMarks(marks: InstanceTransform[]): void {
  const dashLength = 2.4;
  const step = 5;
  const half = CITY.blocksPerSide / 2;
  const center = (CITY.blocksPerSide - 1) / 2;
  for (let line = 0; line <= CITY.blocksPerSide; line++) {
    const roadOffset = (line - half) * PITCH;
    for (let block = 0; block < CITY.blocksPerSide; block++) {
      const blockCenter = (block - center) * PITCH;
      for (let along = -CITY.blockSize / 2 + 2; along <= CITY.blockSize / 2 - 2; along += step) {
        const a = blockCenter + along;
        marks.push({ position: [roadOffset, 0.01, a], scale: [0.25, 0.02, dashLength] });
        marks.push({ position: [a, 0.01, roadOffset], scale: [dashLength, 0.02, 0.25] });
      }
    }
  }
}

function pickColor(random: Random): string {
  return BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)] ?? BUILDING_COLORS[0];
}

/** Small, fast seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
