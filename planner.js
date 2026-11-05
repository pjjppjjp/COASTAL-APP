/**
 * COASTAL spatial planning engine.
 *
 * All public coordinates are WGS84 [longitude, latitude]. Geometry is calculated
 * in a local equirectangular metric plane. This is a planning approximation for
 * small coastal sites, not a hydrographic survey or an ecological growth model.
 *
 * A structure's nominal footprint is treated as a square. Its circumscribed
 * circle supplies conservative boundary clearance and minimum spacing.
 * Orientation is the row bearing in degrees clockwise from geographic north.
 */

const R = 6371008.8;
const DEG = Math.PI / 180;
const EPS = 1e-6;
const MAX_AREA_M2 = 1_000_000;
const MAX_SPAN_M = 10_000;
const MAX_VERTICES = 256;
const MAX_TOTAL_VERTICES = 512;
const MAX_EXCLUSIONS = 16;
const MAX_POINTS = 15_000;
const MAX_CANDIDATES = 200_000;
const MAX_GEOMETRY_WORK = 35_000_000;

export const PLANNER_LIMITS = Object.freeze({
  maxAreaM2: MAX_AREA_M2,
  maxSpanM: MAX_SPAN_M,
  maxStructures: MAX_POINTS,
  maxVertices: MAX_VERTICES,
  maxExclusions: MAX_EXCLUSIONS,
  maxLatitude: 75,
});

function requireNumber(value, name, { min = -Infinity, max = Infinity, exclusiveMin = false, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  if ((exclusiveMin ? value <= min : value < min) || value > max || (integer && !Number.isInteger(value))) {
    const lower = Number.isFinite(min) ? `${exclusiveMin ? 'greater than' : 'at least'} ${min}` : '';
    const upper = Number.isFinite(max) ? `no more than ${max}` : '';
    throw new Error(`${name} must be ${integer ? 'a whole number ' : ''}${[lower, upper].filter(Boolean).join(' and ')}.`);
  }
  return value;
}

function longitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function unwrap(value, reference) {
  return reference + longitude(value - reference);
}

function validateCoordinate(point, name = 'Coordinate') {
  if (!Array.isArray(point) || point.length < 2) throw new Error(`${name} must be [longitude, latitude].`);
  requireNumber(point[0], `${name} longitude`, { min: -180, max: 180 });
  requireNumber(point[1], `${name} latitude`, { min: -75, max: 75 });
  return [point[0], point[1]];
}

function sameCoordinate(a, b) {
  return Math.abs(longitude(a[0] - b[0])) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
}

function normalizeRing(coords, name = 'Boundary') {
  if (!Array.isArray(coords)) throw new Error(`${name} must be an array of [longitude, latitude] coordinates.`);
  if (coords.length > MAX_VERTICES + 1) throw new Error(`${name} has too many vertices. Use at most ${MAX_VERTICES}.`);
  const ring = [];
  for (const point of coords) {
    const coordinate = validateCoordinate(point, name);
    if (!ring.length || !sameCoordinate(coordinate, ring[ring.length - 1])) ring.push(coordinate);
  }
  if (ring.length > 1 && sameCoordinate(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) throw new Error(`${name} needs at least three distinct vertices.`);
  return ring;
}

function makeProjection(ring) {
  const reference = ring[0][0];
  const lon = ring.reduce((sum, p) => sum + unwrap(p[0], reference), 0) / ring.length;
  const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const metresPerLongitudeDegree = R * DEG * Math.cos(lat * DEG);
  const metresPerLatitudeDegree = R * DEG;
  return {
    toXY: ([lng, latitude]) => [
      (unwrap(lng, lon) - lon) * metresPerLongitudeDegree,
      (latitude - lat) * metresPerLatitudeDegree,
    ],
    toLngLat: ([x, y]) => [longitude(lon + x / metresPerLongitudeDegree), lat + y / metresPerLatitudeDegree],
  };
}

function signedArea(ring) {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return twice / 2;
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  let crossSum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
    crossSum += cross;
  }
  return [x / (3 * crossSum), y / (3 * crossSum)];
}

function bounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function cross(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function distanceToSegmentSquared(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  const x = p[0] - a[0] - t * dx;
  const y = p[1] - a[1] - t * dy;
  return x * x + y * y;
}

function onSegment(p, a, b) {
  return distanceToSegmentSquared(p, a, b) <= EPS * EPS;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}

function validateSimpleRing(ring, name) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS) {
      throw new Error(`${name} contains a zero-length edge.`);
    }
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (segmentsIntersect(a, b, ring[j], ring[(j + 1) % ring.length])) {
        throw new Error(`${name} crosses or touches itself. Draw a simple boundary without crossing edges.`);
      }
    }
  }
  if (Math.abs(signedArea(ring)) < 0.0001) {
    throw new Error(`${name} has no measurable area. Draw a wider boundary.`);
  }
}

function contains(point, ring, includeBoundary = true) {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (onSegment(point, a, b)) return includeBoundary;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function isClearOfEdges(point, ring, radius) {
  const minimum2 = Math.max(0, radius - EPS) ** 2;
  for (let i = 0; i < ring.length; i++) {
    if (distanceToSegmentSquared(point, ring[i], ring[(i + 1) % ring.length]) < minimum2) return false;
  }
  return true;
}

function intersectsBounds(a, b, margin = 0) {
  return !(a.maxX < b.minX - margin || a.minX > b.maxX + margin || a.maxY < b.minY - margin || a.minY > b.maxY + margin);
}

function verticalIntervals(ring, x) {
  const hits = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
      hits.push(a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]));
    }
  }
  hits.sort((a, b) => a - b);
  const intervals = [];
  for (let i = 0; i + 1 < hits.length; i += 2) intervals.push([hits[i], hits[i + 1]]);
  return intervals;
}

function unionIntervals(intervals) {
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const union = [];
  for (const interval of intervals) {
    const previous = union[union.length - 1];
    if (!previous || interval[0] > previous[1]) union.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return union;
}

/** Area of a simple polygon minus the union of exclusions, clipped to it.
 * Between vertex/intersection x positions, every cross-section endpoint is
 * linear, so midpoint integration on each strip is exact in the local plane.
 */
function availableArea(outer, exclusions) {
  if (!exclusions.length) return Math.abs(signedArea(outer));
  const bbox = bounds(outer);
  const rings = [outer, ...exclusions];
  const xs = [bbox.minX, bbox.maxX];
  const segments = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a[0] > bbox.minX && a[0] < bbox.maxX) xs.push(a[0]);
      segments.push([a, b]);
    }
  }
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d] = segments[j];
      const sx = d[0] - c[0];
      const sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-12) continue;
      const qx = c[0] - a[0];
      const qy = c[1] - a[1];
      const t = (qx * sy - qy * sx) / denominator;
      const u = (qx * ry - qy * rx) / denominator;
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        const x = a[0] + t * rx;
        if (x > bbox.minX && x < bbox.maxX) xs.push(x);
      }
    }
  }
  xs.sort((a, b) => a - b);
  const breaks = xs.filter((x, i) => i === 0 || x - xs[i - 1] > EPS);
  if (breaks.length > 5000) throw new Error('The overlapping exclusion boundaries are too complex. Simplify them before calculating.');
  let area = 0;
  for (let i = 0; i + 1 < breaks.length; i++) {
    const dx = breaks[i + 1] - breaks[i];
    const x = (breaks[i + 1] + breaks[i]) / 2;
    const base = verticalIntervals(outer, x);
    const excluded = unionIntervals(exclusions.flatMap(ring => verticalIntervals(ring, x)));
    let availableLength = 0;
    for (const [low, high] of base) {
      let coveredLength = 0;
      for (const [cutLow, cutHigh] of excluded) {
        if (cutHigh <= low) continue;
        if (cutLow >= high) break;
        coveredLength += Math.max(0, Math.min(high, cutHigh) - Math.max(low, cutLow));
      }
      availableLength += Math.max(0, high - low - coveredLength);
    }
    area += dx * availableLength;
  }
  return Math.max(0, Math.min(Math.abs(signedArea(outer)), area));
}

/** Area in square metres. Accepts an open or closed simple outer ring. */
export function polygonArea(coords) {
  const ring = normalizeRing(coords);
  const projection = makeProjection(ring);
  const projected = ring.map(projection.toXY);
  validateSimpleRing(projected, 'Boundary');
  return Math.abs(signedArea(projected));
}

/** Create a centred metric rectangle. The returned WGS84 ring is not closed. */
export function makeRectangle(center, areaM2, aspect = 1.4) {
  const coordinate = validateCoordinate(center, 'Centre');
  requireNumber(areaM2, 'Area', { min: 0, exclusiveMin: true, max: MAX_AREA_M2 });
  requireNumber(aspect, 'Aspect ratio', { min: 0, exclusiveMin: true });
  const width = Math.sqrt(areaM2 * aspect);
  const height = Math.sqrt(areaM2 / aspect);
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.max(width, height) > MAX_SPAN_M) {
    throw new Error('Keep each site dimension within 10 km. Divide long sites into smaller plans.');
  }
  const projection = makeProjection([coordinate]);
  const result = [
    [-width / 2, -height / 2], [width / 2, -height / 2],
    [width / 2, height / 2], [-width / 2, height / 2],
  ].map(projection.toLngLat);
  result.forEach(point => validateCoordinate(point));
  return result;
}

/** Test a WGS84 point against an open or closed boundary, including its edge. */
export function pointInPolygon(point, coords, includeBoundary = true) {
  const coordinate = validateCoordinate(point);
  const ring = normalizeRing(coords);
  const projection = makeProjection(ring);
  return contains(projection.toXY(coordinate), ring.map(projection.toXY), includeBoundary);
}

/**
 * Generate exact structure centres clipped to a selected boundary.
 *
 * coveragePercent allocates a central fraction of the complete pattern's
 * valid positions, rounded up to whole structures (or whole seven-unit
 * clusters). It is NOT a forecast of live seagrass coverage or survival.
 * footprintM2 in the input is one unit's nominal footprint; the returned
 * footprintM2 is the sum for all installed structures. Cost includes spares.
 */
export function generatePlan({
  polygon,
  spacing,
  pattern = 'staggered',
  orientation = 0,
  unitCost = 6,
  sparePercent = 10,
  seedlingsPerStructure = 1,
  footprintM2 = 0.09,
  coveragePercent = 100,
  exclusions = [],
} = {}) {
  requireNumber(spacing, 'Spacing', { min: 0, exclusiveMin: true });
  requireNumber(orientation, 'Row bearing');
  requireNumber(unitCost, 'Unit cost', { min: 0 });
  requireNumber(sparePercent, 'Spare percentage', { min: 0, max: 100 });
  requireNumber(seedlingsPerStructure, 'Seedlings per structure', { min: 1, max: 1000, integer: true });
  requireNumber(footprintM2, 'Unit footprint', { min: 0, exclusiveMin: true, max: MAX_AREA_M2 });
  requireNumber(coveragePercent, 'Coverage percentage', { min: 0, exclusiveMin: true, max: 100 });
  if (!['staggered', 'square', 'clusters'].includes(pattern)) throw new Error('Choose staggered, square, or clusters as the planting pattern.');
  if (!Array.isArray(exclusions) || exclusions.length > MAX_EXCLUSIONS) {
    throw new Error(`Use an array of at most ${MAX_EXCLUSIONS} exclusion boundaries.`);
  }

  const boundary = normalizeRing(polygon);
  const exclusionCoordinates = exclusions.map((ring, i) => normalizeRing(ring, `Exclusion ${i + 1}`));
  const vertexCount = boundary.length + exclusionCoordinates.reduce((sum, ring) => sum + ring.length, 0);
  if (vertexCount > MAX_TOTAL_VERTICES) throw new Error('The combined boundaries have too many vertices. Simplify them to 512 vertices or fewer.');
  const projection = makeProjection(boundary);
  const outer = boundary.map(projection.toXY);
  const projectedExclusions = exclusionCoordinates.map(ring => ring.map(projection.toXY));
  validateSimpleRing(outer, 'Boundary');
  projectedExclusions.forEach((ring, i) => validateSimpleRing(ring, `Exclusion ${i + 1}`));
  const areaM2 = Math.abs(signedArea(outer));
  if (areaM2 > MAX_AREA_M2 + 0.001) throw new Error('A plan can cover at most 1,000,000 m² (100 ha). Divide larger sites into smaller plans.');
  const outerBounds = bounds(outer);
  if (Math.max(outerBounds.maxX - outerBounds.minX, outerBounds.maxY - outerBounds.minY) > MAX_SPAN_M + EPS) {
    throw new Error('Keep each site dimension within 10 km. Divide long sites into smaller plans.');
  }

  const boundaryClearanceM = Math.sqrt(footprintM2 / 2);
  if (spacing + EPS < boundaryClearanceM * 2) {
    throw new Error(`Spacing must be at least ${(boundaryClearanceM * 2).toFixed(3)} m for the selected square footprint.`);
  }
  const exclusionObjects = projectedExclusions
    .map(ring => ({ ring, bounds: bounds(ring) }))
    .filter(item => intersectsBounds(outerBounds, item.bounds, boundaryClearanceM));
  const usableAreaM2 = availableArea(outer, exclusionObjects.map(item => item.ring));
  const targetAreaM2 = usableAreaM2 * coveragePercent / 100;
  const centre = centroid(outer);
  const bearing = ((orientation % 360) + 360) % 360;
  const angle = (90 - bearing) * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotateIntoGrid = ([x, y]) => [(x - centre[0]) * cos + (y - centre[1]) * sin, -(x - centre[0]) * sin + (y - centre[1]) * cos];
  const rotateOutOfGrid = ([x, y]) => [centre[0] + x * cos - y * sin, centre[1] + x * sin + y * cos];
  const gridBounds = bounds(outer.map(rotateIntoGrid));
  const isCluster = pattern === 'clusters';
  const groupSize = isCluster ? 7 : 1;
  const columnPitch = spacing * (isCluster ? 4 : 1);
  const rowPitch = columnPitch * (pattern === 'square' ? 1 : Math.sqrt(3) / 2);
  const minRow = Math.floor(gridBounds.minY / rowPitch) - 1;
  const maxRow = Math.ceil(gridBounds.maxY / rowPitch) + 1;
  const minCol = Math.floor(gridBounds.minX / columnPitch) - 1;
  const maxCol = Math.ceil(gridBounds.maxX / columnPitch) + 1;
  const candidateCount = (maxRow - minRow + 1) * (maxCol - minCol + 1) * groupSize;
  if (usableAreaM2 > EPS && (!Number.isSafeInteger(candidateCount) || candidateCount > MAX_CANDIDATES || candidateCount * vertexCount > MAX_GEOMETRY_WORK)) {
    throw new Error('This boundary and spacing would require too many candidate positions. Increase spacing, simplify the boundary, or divide the site into smaller plans.');
  }

  function fits(point) {
    if (!contains(point, outer, true) || !isClearOfEdges(point, outer, boundaryClearanceM)) return false;
    for (const exclusion of exclusionObjects) {
      const b = exclusion.bounds;
      if (point[0] < b.minX - boundaryClearanceM || point[0] > b.maxX + boundaryClearanceM ||
          point[1] < b.minY - boundaryClearanceM || point[1] > b.maxY + boundaryClearanceM) continue;
      if (contains(point, exclusion.ring, true) || !isClearOfEdges(point, exclusion.ring, boundaryClearanceM)) return false;
    }
    return true;
  }

  const groups = [];
  if (usableAreaM2 > EPS) {
    for (let row = minRow; row <= maxRow; row++) {
      const offset = pattern === 'square' ? 0 : ((row % 2 + 2) % 2) * 0.5;
      for (let col = minCol; col <= maxCol; col++) {
        const u = (col + offset) * columnPitch;
        const v = row * rowPitch;
        const xy = rotateOutOfGrid([u, v]);
        const members = [xy];
        if (isCluster) {
          for (let k = 0; k < 6; k++) {
            members.push(rotateOutOfGrid([u + spacing * Math.cos(k * Math.PI / 3), v + spacing * Math.sin(k * Math.PI / 3)]));
          }
        }
        if (!members.every(fits)) continue;
        groups.push({ row, col, members, distance2: u * u + v * v });
        const selectedGroupCount = Math.ceil(groups.length * coveragePercent / 100);
        if (selectedGroupCount * groupSize > MAX_POINTS) {
          throw new Error('This plan exceeds 15,000 structures. Increase spacing, reduce coverage, or divide the site into smaller plans.');
        }
      }
    }
  }

  const fullLayoutStructureCount = groups.length * groupSize;
  const selectedGroupCount = Math.ceil(groups.length * coveragePercent / 100);
  const selectedGroups = groups
    .sort((a, b) => a.distance2 - b.distance2 || a.row - b.row || a.col - b.col)
    .slice(0, selectedGroupCount)
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const points = [];
  for (let groupIndex = 0; groupIndex < selectedGroups.length; groupIndex++) {
    const group = selectedGroups[groupIndex];
    for (let member = 0; member < group.members.length; member++) {
      const [lng, lat] = projection.toLngLat(group.members[member]);
      points.push({
        id: `CST-${String(points.length + 1).padStart(5, '0')}`,
        lng,
        lat,
        row: group.row,
        col: group.col,
        ...(isCluster ? { cluster: groupIndex + 1, member } : {}),
      });
    }
  }
  const structureCount = points.length;
  const spares = Math.ceil(structureCount * sparePercent / 100);
  const procurementCount = structureCount + spares;
  const seedlings = structureCount * seedlingsPerStructure;
  const totalCost = Math.round(procurementCount * unitCost * 100) / 100;
  if (!Number.isSafeInteger(Math.round(procurementCount * unitCost * 100))) {
    throw new Error('The cost is too large to calculate accurately. Reduce the unit cost or plan size.');
  }
  const installedFootprintM2 = structureCount * footprintM2;
  const warnings = [
    'Coordinates and area use a local metric projection; verify final positions and dimensions with a field survey.',
    'Coverage allocates planting positions. It does not predict seagrass survival, spread, or future meadow cover.',
  ];
  if (isCluster) warnings.push('Clusters contain seven structures; incomplete edge clusters are omitted. Cluster centres are four spacings apart.');
  if (usableAreaM2 <= EPS) warnings.push('Exclusions leave no usable planting area.');
  else if (!structureCount) warnings.push('No complete structures fit. Increase the area, reduce spacing, or review the footprint and exclusion boundaries.');
  if (coveragePercent < 100) warnings.push('Partial coverage selects positions closest to the site centroid; irregular boundaries and exclusions may split the selected area.');

  return {
    areaM2,
    usableAreaM2,
    targetAreaM2,
    structureCount,
    procurementCount,
    spares,
    seedlings,
    totalCost,
    footprintM2: installedFootprintM2,
    footprintPercent: usableAreaM2 ? installedFootprintM2 / usableAreaM2 * 100 : 0,
    points,
    warnings,
    unitFootprintM2: footprintM2,
    boundaryClearanceM,
    fullLayoutStructureCount,
    layoutCoveragePercent: fullLayoutStructureCount ? structureCount / fullLayoutStructureCount * 100 : 0,
    coveragePercent,
    spacing,
    pattern,
    orientation: bearing,
    unitCost,
    sparePercent,
    seedlingsPerStructure,
    polygon: boundary.map(point => [...point]),
    exclusions: exclusionCoordinates.map(ring => ring.map(point => [...point])),
  };
}

/** Export all coordinates plus the boundary and exclusion rings as GeoJSON. */
export function exportGeoJSON(plan, properties = {}) {
  if (!plan || !Array.isArray(plan.points) || !Array.isArray(plan.polygon)) throw new Error('Generate a plan before exporting.');
  const close = ring => [...ring.map(point => [...point]), [...ring[0]]];
  const features = [{
    type: 'Feature',
    properties: { ...properties, kind: 'planning_boundary', areaM2: plan.areaM2, usableAreaM2: plan.usableAreaM2, targetAreaM2: plan.targetAreaM2 },
    geometry: { type: 'Polygon', coordinates: [close(plan.polygon)] },
  }];
  (plan.exclusions || []).forEach((ring, index) => features.push({
    type: 'Feature',
    properties: { kind: 'exclusion', exclusion: index + 1 },
    geometry: { type: 'Polygon', coordinates: [close(ring)] },
  }));
  plan.points.forEach(point => features.push({
    type: 'Feature',
    id: point.id,
    properties: {
      ...properties,
      kind: 'structure',
      id: point.id,
      row: point.row,
      col: point.col,
      spacingM: plan.spacing,
      pattern: plan.pattern,
      rowBearingDegrees: plan.orientation,
      ...(point.cluster ? { cluster: point.cluster, member: point.member } : {}),
    },
    geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
  }));
  return {
    type: 'FeatureCollection',
    metadata: {
      application: 'COASTAL',
      coordinateReferenceSystem: 'WGS84 longitude, latitude',
      structureCount: plan.structureCount,
      procurementCount: plan.procurementCount,
      nominalFootprintM2: plan.footprintM2,
      coverageMeaning: 'Fraction of valid planting positions allocated; not predicted live seagrass cover.',
    },
    features,
  };
}
