/**
 * COASTAL geographic layout planner.
 *
 * This is a deterministic geometry/material estimate, not a habitat, survival,
 * growth or hydrodynamic model. Spacing, footprint, pattern and unit cost are
 * explicit planning inputs; none is presented as an ecologically optimal value.
 * footprintM is an assumed circular clearance diameter. The radius,
 * footprintM / 2, is the minimum distance from each center to the boundary.
 * This is a simplified planning clearance, not a measured apparatus envelope.
 *
 * Distances use a local equirectangular projection on a sphere (R = 6,371,008.8 m).
 * At the supported small restoration-site scale it provides a useful planning
 * approximation, not a survey-grade or geodesic construction specification.
 * Coordinates are [latitude, longitude] internally; GeoJSON uses [longitude,
 * latitude]. Dateline-crossing polygons are explicitly unsupported.
 */

export const EARTH_RADIUS_M = 6371008.8;
export const MAX_AREA_M2 = 100000;
export const MAX_STRUCTURES = 50000;
const MAX_CANDIDATES = 1000000;
const DEG = Math.PI / 180;
const EPS = 1e-7;
const PATTERNS = new Set(['grid', 'staggered', 'clusters']);

function number(value, name, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function coordinate(value, name = 'Coordinate') {
  const pair = Array.isArray(value) ? value : value && [value.lat, value.lng];
  if (!pair || pair.length !== 2) throw new TypeError(`${name} must be [latitude, longitude].`);
  return [number(pair[0], `${name} latitude`, -80, 80), number(pair[1], `${name} longitude`, -180, 180)];
}

function projection(origin) {
  const cos = Math.cos(origin[0] * DEG);
  return {
    project: ([lat, lng]) => [(lng - origin[1]) * DEG * EARTH_RADIUS_M * cos, (lat - origin[0]) * DEG * EARTH_RADIUS_M],
    unproject: ([x, y]) => coordinate([origin[0] + y / EARTH_RADIUS_M / DEG, origin[1] + x / (EARTH_RADIUS_M * cos) / DEG]),
  };
}

function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function areaSigned(vertices) {
  let result = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    result += a[0] * b[1] - b[0] * a[1];
  }
  return result / 2;
}
function onSegment(p, a, b) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs(cross(a, b, p)) <= EPS * Math.max(1, length)
    && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}
function inside(p, vertices) {
  let found = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[j], b = vertices[i];
    if (onSegment(p, a, b)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) found = !found;
  }
  return found;
}
function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function bufferedInside(p, vertices, margin) {
  if (!inside(p, vertices)) return false;
  if (margin <= EPS) return true;
  for (let i = 0; i < vertices.length; i++) {
    if (distanceToSegment(p, vertices[i], vertices[(i + 1) % vertices.length]) + EPS < margin) return false;
  }
  return true;
}

function validatePolygon(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) throw new TypeError('Boundary needs at least three vertices.');
  if (boundary.length > 501) throw new RangeError('Boundary supports at most 500 vertices.');
  const ring = boundary.map((p, i) => coordinate(p, `Vertex ${i + 1}`));
  if (same(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) throw new RangeError('Boundary needs at least three distinct vertices.');
  if (ring.length > 500) throw new RangeError('Boundary supports at most 500 vertices.');
  if (Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1])) > 180) {
    throw new RangeError('Polygons crossing the antimeridian are not supported.');
  }
  const origin = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const project = projection(origin);
  const vertices = ring.map(project.project);
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS) throw new RangeError('Boundary contains duplicate adjacent vertices.');
  }
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const previous = vertices[(i + vertices.length - 1) % vertices.length];
    if (Math.abs(cross(previous, a, b)) <= EPS && (previous[0] - a[0]) * (b[0] - a[0]) + (previous[1] - a[1]) * (b[1] - a[1]) > EPS) {
      throw new RangeError('Boundary doubles back along an edge.');
    }
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      if (segmentsIntersect(a, b, vertices[j], vertices[(j + 1) % vertices.length])) throw new RangeError('Boundary must be a simple polygon without self-intersections.');
    }
  }
  const signedArea = areaSigned(vertices);
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) <= 1e-6) throw new RangeError('Boundary must enclose a nonzero area.');
  let cx = 0, cy = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const factor = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * factor;
    cy += (a[1] + b[1]) * factor;
  }
  return {ring, vertices, origin, project, area: Math.abs(signedArea), centroid: [cx / (6 * signedArea), cy / (6 * signedArea)]};
}

/** Return polygon area in square metres in the documented local projection. */
export function polygonArea(boundary) { return validatePolygon(boundary).area; }

/** Return an open four-vertex square ring with requested projected area. */
export function createSquare(center, areaM2, rotationDeg = 0) {
  const origin = coordinate(center, 'Center');
  number(areaM2, 'Area', Number.MIN_VALUE, MAX_AREA_M2);
  number(rotationDeg, 'Rotation');
  const half = Math.sqrt(areaM2) / 2;
  const angle = (rotationDeg % 360) * DEG, c = Math.cos(angle), s = Math.sin(angle);
  const project = projection(origin);
  const ring = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => {
    try { return project.unproject([x * c - y * s, x * s + y * c]); }
    catch { throw new RangeError('The square crosses a coordinate limit or the antimeridian; choose another center.'); }
  });
  return ring;
}

/** Polygon edges count as inside. Accepts a coordinate pair or {lat, lng}. */
export function pointInPolygon(point, boundary) {
  const p = coordinate(point, 'Point');
  const polygon = validatePolygon(boundary);
  return inside(polygon.project.project(p), polygon.vertices);
}

function money(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

/** Enumerate real layout positions and then derive counts and material costs. */
export function generatePlan(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Planner options must be an object.');
  const {
    center, areaM2: requestedAreaM2 = 400, spacingM = 2, pattern = 'staggered',
    rotationDeg = 0, boundary = null, unitCost = 6, sparePercent = 10, footprintM = 0.3,
  } = options;
  number(requestedAreaM2, 'Area', Number.MIN_VALUE, MAX_AREA_M2);
  number(spacingM, 'Spacing', Number.MIN_VALUE, 100000);
  number(rotationDeg, 'Rotation');
  number(unitCost, 'Unit cost', 0, Number.MAX_SAFE_INTEGER / (MAX_STRUCTURES * 2));
  number(sparePercent, 'Spare percentage', 0, 100);
  number(footprintM, 'Circular clearance diameter', 0, 100000);
  if (!PATTERNS.has(pattern)) throw new RangeError('Pattern must be grid, staggered or clusters.');
  if (center !== undefined) coordinate(center, 'Center');
  if (boundary === null && center === undefined) throw new TypeError('Choose a center or provide a boundary.');
  const ring = boundary === null ? createSquare(center, requestedAreaM2, rotationDeg) : boundary;
  const poly = validatePolygon(ring);
  if (poly.area > MAX_AREA_M2 + 0.001) throw new RangeError(`The selected area exceeds ${MAX_AREA_M2.toLocaleString('en-US')} m².`);
  const angle = ((rotationDeg % 360) + 360) % 360 * DEG, c = Math.cos(angle), s = Math.sin(angle);
  const rotate = ([x, y]) => [x * c - y * s + poly.centroid[0], x * s + y * c + poly.centroid[1]];
  const inverse = ([x, y]) => { const dx = x - poly.centroid[0], dy = y - poly.centroid[1]; return [dx * c + dy * s, -dx * s + dy * c]; };
  const aligned = poly.vertices.map(inverse);
  const minX = Math.min(...aligned.map(p => p[0])), maxX = Math.max(...aligned.map(p => p[0]));
  const minY = Math.min(...aligned.map(p => p[1])), maxY = Math.max(...aligned.map(p => p[1]));
  const width = maxX - minX, height = maxY - minY, margin = footprintM / 2;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const points = [];
  let candidates = 0, clusterCount = 0;
  const feasible = p => bufferedInside(p, poly.vertices, margin);
  const add = (local, row, col, extra = {}) => {
    if (points.length >= MAX_STRUCTURES) throw new RangeError(`This layout exceeds ${MAX_STRUCTURES.toLocaleString('en-US')} structures. Increase spacing or reduce the area.`);
    const [lat, lng] = poly.project.unproject(local);
    points.push({id: `C${String(points.length + 1).padStart(4, '0')}`, lat, lng, row, col, ...extra});
  };
  const countFor = (length, pitch, inset) => Math.max(0, Math.floor((length - inset * 2 + EPS) / pitch) + 1);
  const ensureCandidates = estimate => {
    if (!Number.isFinite(estimate) || estimate > MAX_CANDIDATES) throw new RangeError('This selection creates too many candidate positions. Increase spacing or reduce the boundary extent.');
  };

  if (pattern === 'clusters') {
    const pitch = 3 * spacingM, inset = margin + spacingM / 2;
    const columns = countFor(width, pitch, inset), rows = countFor(height, pitch, inset);
    ensureCandidates(columns * rows * 4);
    const startX = midX - (columns - 1) * pitch / 2, startY = midY - (rows - 1) * pitch / 2;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const group = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([dx, dy]) => rotate([startX + col * pitch + dx * spacingM, startY + row * pitch + dy * spacingM]));
        candidates += 4;
        // Keep complete groups of four; never imply a clipped pair is a cluster.
        if (group.every(feasible)) {
          const clusterId = `G${++clusterCount}`;
          group.forEach((p, i) => add(p, row * 2 + Math.floor(i / 2), col * 2 + i % 2, {clusterId}));
        }
      }
    }
  } else {
    const rowPitch = pattern === 'staggered' ? spacingM * Math.sqrt(3) / 2 : spacingM;
    const columns = countFor(width, spacingM, margin), rows = countFor(height, rowPitch, margin);
    ensureCandidates((columns + 2) * rows);
    const startX = midX - (columns - 1) * spacingM / 2, startY = midY - (rows - 1) * rowPitch / 2;
    for (let row = 0; row < rows; row++) {
      const offset = pattern === 'staggered' ? (row % 2 ? 1 : -1) * spacingM / 4 : 0;
      // Extra boundary columns allow a shifted lattice to fill irregular shapes.
      for (let col = -1; col <= columns; col++) {
        const p = rotate([startX + col * spacingM + offset, startY + row * rowPitch]);
        candidates++;
        if (feasible(p)) add(p, row, col);
      }
    }
  }

  const count = points.length, spareCount = Math.ceil(count * sparePercent / 100), orderCount = count + spareCount;
  const warnings = [];
  if (count === 0) warnings.push('This layout produces no positions with the selected spacing and circular clearance. Try a different spacing, pattern or boundary; a zero count does not prove that no arrangement is possible.');
  if (footprintM > spacingM && count > 1) warnings.push('The assumed circular clearance diameter is larger than the spacing; neighboring clearance zones may overlap.');
  if (pattern === 'clusters') warnings.push('Clusters use complete groups of four with cluster centers three spacings apart; gaps between groups reduce the structure count.');
  const actualCenter = poly.project.unproject(poly.centroid);
  return {
    boundary: poly.ring.map(p => [...p]), points, areaM2: poly.area, requestedAreaM2,
    count, orderCount, spareCount, materialCost: money(orderCount * unitCost), deploymentCost: money(count * unitCost),
    spacingM, pattern, rotationDeg: ((rotationDeg % 360) + 360) % 360, footprintM, edgeBufferM: margin,
    dimensions: {widthM: width, heightM: height}, densityPer100M2: count / poly.area * 100,
    center: actualCenter, unitCost, sparePercent, clusterCount, candidateCount: candidates,
    rowPitchM: pattern === 'staggered' ? spacingM * Math.sqrt(3) / 2 : pattern === 'clusters' ? 3 * spacingM : spacingM,
    warnings, projection: 'Local equirectangular (spherical Earth, radius 6371008.8 m)',
    assumptions: 'Positions and cost only. Spacing and circular clearance diameter are user-defined planning assumptions; edge clearance is half that diameter. Site suitability, growth and survival are not predicted.',
  };
}

function validateExport(plan, metadata) {
  if (!plan || !Array.isArray(plan.points) || !Array.isArray(plan.boundary)) throw new TypeError('Export requires a generated plan.');
  validatePolygon(plan.boundary);
  plan.points.forEach(p => coordinate(p, 'Structure'));
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Export metadata must be an object.');
  // Reject unsupported values rather than quietly serializing Infinity or NaN as null.
  const inspect = (value, depth = 0) => {
    if (depth > 8) throw new TypeError('Export metadata is nested too deeply.');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Export metadata numbers must be finite.');
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new TypeError('Export metadata must contain JSON-compatible values.');
    if (value && typeof value === 'object') for (const v of Object.values(value)) inspect(v, depth + 1);
  };
  inspect(metadata);
}

export function toGeoJSON(plan, metadata = {}) {
  validateExport(plan, metadata);
  const boundary = plan.boundary.map(([lat, lng]) => [lng, lat]);
  if (!same(boundary[0], boundary[boundary.length - 1])) boundary.push([...boundary[0]]);
  const summary = {
    area_m2: plan.areaM2, installed_structures: plan.count, spare_structures: plan.spareCount,
    order_structures: plan.orderCount, spacing_m: plan.spacingM, pattern: plan.pattern,
    footprint_m: plan.footprintM, rotation_deg: plan.rotationDeg, unit_cost: plan.unitCost,
    material_cost: plan.materialCost, assumptions: plan.assumptions,
  };
  return {
    type: 'FeatureCollection', name: 'COASTAL planting plan', metadata: {...metadata, ...summary},
    features: [
      {type: 'Feature', properties: {role: 'planting_boundary', ...summary}, geometry: {type: 'Polygon', coordinates: [boundary]}},
      ...plan.points.map(p => ({
        type: 'Feature', id: p.id,
        properties: {role: 'structure', id: p.id, row: p.row, column: p.col, ...(p.clusterId ? {cluster_id: p.clusterId} : {}), species: metadata.species ?? '', site: metadata.site ?? '', spacing_m: plan.spacingM, pattern: plan.pattern},
        geometry: {type: 'Point', coordinates: [p.lng, p.lat]},
      })),
    ],
  };
}

function csvCell(value) {
  const scalar = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  // Labels can come from geocoding/user input. Neutralize spreadsheet formulas.
  const safe = /^[=+@\-\t\r]/.test(scalar) ? `'${scalar}` : scalar;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Export actual deployment positions, excluding spare units without positions. */
export function toCSV(plan, metadata = {}) {
  validateExport(plan, metadata);
  const keys = Object.keys(metadata).sort();
  const header = ['id', 'latitude', 'longitude', 'row', 'column', 'cluster_id', 'pattern', 'spacing_m', ...keys.map(k => `metadata_${k}`)];
  const rows = plan.points.map(p => [
    p.id, p.lat.toFixed(8), p.lng.toFixed(8), p.row, p.col, p.clusterId ?? '', plan.pattern, plan.spacingM,
    ...keys.map(k => metadata[k]),
  ]);
  // Numeric coordinate columns remain numeric, including negative values.
  return [header.map(csvCell).join(','), ...rows.map(row => row.map((v, i) => [1, 2, 3, 4, 7].includes(i) ? String(v) : csvCell(v)).join(','))].join('\r\n') + '\r\n';
}
