const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../extension/lib/geometry.js');

const IN = 0.0254;
const v3 = ([x, y, z]) => ({ x, y, z });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const closeVec = (a, b, tol = 1e-9) => a.forEach((x, i) => close(x, b[i], tol));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A tube along `axis` (0=x, 1=y, 2=z) from 0 to length, centered on the origin.
function spacerDetails(length, axis = 2, od = 0.375 * IN) {
  const at = (k, value) => {
    const p = [0, 0, 0];
    p[axis] = value;
    return p;
  };
  const box = (k) => {
    const min = [-od / 2, -od / 2, -od / 2];
    const max = [od / 2, od / 2, od / 2];
    min[axis] = k === 'side' ? 0 : k;
    max[axis] = k === 'side' ? length : k;
    return { minCorner: v3(min), maxCorner: v3(max), valid: true };
  };
  const plane = (id, value, sign) => ({
    id,
    surface: { type: 'PLANE', origin: v3(at(axis, value)), normal: v3(at(axis, sign)) },
    box: box(value),
  });
  return {
    bodies: [
      {
        faces: [
          plane('START', 0, -1),
          plane('END', length, 1),
          { id: 'OD', surface: { type: 'CYLINDER', origin: v3([0, 0, 0]), axis: v3(at(axis, 1)) }, box: box('side') },
        ],
        edges: [
          { id: 'RIM', curve: { type: 'CIRCLE', origin: v3([0, 0, 0]), normal: v3(at(axis, 1)), radius: od / 2 } },
          { id: 'LINE', curve: { type: 'LINE', origin: v3([0, 0, 0]), direction: v3([1, 0, 0]) } },
        ],
      },
    ],
  };
}

const translate = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

test('rotationFromTo maps a onto b and stays orthonormal', () => {
  const cases = [
    [[0, 0, 1], [0, 0, 1]],
    [[0, 0, 1], [0, 0, -1]],
    [[1, 0, 0], [-1, 0, 0]],
    [[0, 0, 1], g.norm([1, 2, 3])],
    [g.norm([-3, 1, 0.5]), g.norm([0.2, -1, 4])],
  ];
  for (const [a, b] of cases) {
    const R = g.rotationFromTo(a, b);
    const T = [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1];
    closeVec(g.applyDir(T, a), b);
    const rows = [R.slice(0, 3), R.slice(3, 6), R.slice(6, 9)];
    rows.forEach((r, i) => rows.forEach((s, j) => close(g.dot(r, s), i === j ? 1 : 0)));
    close(g.dot(g.cross(rows[0], rows[1]), rows[2]), 1); // proper rotation, not a mirror
  }
});

test('findEntity reads planar faces and circular edges, and rejects others', () => {
  const d = spacerDetails(IN);
  const start = g.findEntity(d, 'START');
  assert.equal(start.kind, 'plane');
  closeVec(start.normal, [0, 0, -1]);
  closeVec(start.center, [0, 0, 0]);
  const rim = g.findEntity(d, 'RIM');
  assert.equal(rim.kind, 'circle');
  close(rim.radius, 0.1875 * IN);
  assert.equal(g.findEntity(d, 'NOPE'), null);
  assert.throws(() => g.findEntity(d, 'OD'), /cylinder/);
  assert.throws(() => g.findEntity(d, 'LINE'), /line/);
});

test('toWorld applies the occurrence transform', () => {
  const rim = g.findEntity(spacerDetails(IN), 'RIM');
  const T = [0, 0, 1, 1, 0, 1, 0, 2, -1, 0, 0, 3, 0, 0, 0, 1]; // +Z -> +X, then move
  const w = g.toWorld(rim, T);
  closeVec(w.center, [1, 2, 3]);
  closeVec(w.normal, [1, 0, 0]);
});

test('measure: two coaxial holes 1.5 in apart, normals facing each other', () => {
  const a = { kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 0.1 };
  const b = { kind: 'circle', center: [0, 0, 1.5 * IN], normal: [0, 0, -1], radius: 0.1 };
  const m = g.measure(a, b);
  close(m.distance, 1.5 * IN);
  closeVec(m.dir, [0, 0, 1]);
  closeVec(m.start, [0, 0, 0]);
  assert.equal(m.anchorIndex, 0);
  assert.equal(m.anchorIsCircle, true);
});

test('measure: direction points from the anchor toward the other selection', () => {
  const a = { kind: 'circle', center: [0, 0, 2 * IN], normal: [0, 0, 1], radius: 0.1 };
  const b = { kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 0.1 };
  const m = g.measure(a, b);
  closeVec(m.dir, [0, 0, -1]);
  closeVec(m.start, [0, 0, 2 * IN]);
});

test('measure: a face and a hole anchors on the hole whichever is first', () => {
  const face = { kind: 'plane', point: [5, 5, 0], center: [5, 5, 0], normal: [0, 0, 1] };
  const hole = { kind: 'circle', center: [1, 1, 0.75 * IN], normal: [0, 0, 1], radius: 0.1 };
  const m = g.measure(face, hole);
  assert.equal(m.anchorIndex, 1);
  close(m.distance, 0.75 * IN);
  closeVec(m.start, [1, 1, 0.75 * IN]);
  closeVec(m.dir, [0, 0, -1]);
});

test('measure: two faces anchor on the first face center', () => {
  const a = { kind: 'plane', point: [0, 0, 0], center: [2, 3, 0], normal: [0, 0, 1] };
  const b = { kind: 'plane', point: [9, 9, IN], center: [9, 9, IN], normal: [0, 0, -1] };
  const m = g.measure(a, b);
  assert.equal(m.anchorIsCircle, false);
  close(m.distance, IN);
  closeVec(m.start, [2, 3, 0]);
});

test('measure rejects non-parallel, misaligned and coplanar selections', () => {
  const hole = (center, normal) => ({ kind: 'circle', center, normal: g.norm(normal), radius: 0.1 });
  assert.throws(() => g.measure(hole([0, 0, 0], [0, 0, 1]), hole([0, 0, 1], [0, 0.1, 1])), /aren't parallel/);
  assert.throws(() => g.measure(hole([0, 0, 0], [0, 0, 1]), hole([0.05 * IN, 0, 1], [0, 0, 1])), /aren't lined up/);
  assert.doesNotThrow(() => g.measure(hole([0, 0, 0], [0, 0, 1]), hole([0.01 * IN, 0, 1], [0, 0, 1])));
  assert.throws(() => g.measure(hole([0, 0, 0], [0, 0, 1]), hole([1, 0, 0], [0, 0, 1])), /same plane/);
});

test('partAxis finds the length direction and end faces', () => {
  for (const axis of [0, 1, 2]) {
    const a = g.partAxis(spacerDetails(2 * IN, axis), 2 * IN);
    assert.equal(a.axisIndex, axis);
    assert.equal(a.startFaceId, 'START');
    assert.equal(a.endFaceId, 'END');
    close(g.len(g.sub(a.end, a.start)), 2 * IN);
  }
  // A spacer as long as it is wide still picks Z.
  assert.equal(g.partAxis(spacerDetails(0.375 * IN), 0.375 * IN).axisIndex, 2);
  assert.throws(() => g.partAxis(spacerDetails(IN), 2 * IN), /instead of 2.000 in/);
});

test('placementTransform puts the part between the two selections', () => {
  const axis = g.partAxis(spacerDetails(1.5 * IN), 1.5 * IN);
  const worldStart = [0.1, -0.2, 0.3];
  const dir = g.norm([1, 1, 0]);
  const T = g.placementTransform({ partStart: axis.start, partEnd: axis.end, worldStart, dir });
  closeVec(g.applyPoint(T, axis.start), worldStart);
  closeVec(g.applyPoint(T, axis.end), g.add(worldStart, g.scale(dir, 1.5 * IN)));
  assert.equal(g.axisCheck(T, axis, worldStart, dir).ok, true);
  assert.equal(g.axisCheck(T, axis, worldStart, g.scale(dir, -1)).ok, false);
  assert.equal(g.axisCheck(IDENTITY, axis, worldStart, dir).ok, false);
});

test('end to end: spacer between two plates in assembly coordinates', () => {
  // Plate A's hole rim sits at z=0 facing +Z; plate B is 1.25 in higher, moved off the origin.
  const plateA = translate(0.2, 0.1, 0);
  const plateB = translate(0.2, 0.1, 1.25 * IN);
  const rim = g.findEntity(spacerDetails(IN), 'RIM');
  const m = g.measure(g.toWorld(rim, plateA), g.toWorld(rim, plateB));
  close(m.distance, 1.25 * IN);
  const length = g.chooseLength(m.distance, { lengthStep: 0 });
  const axis = g.partAxis(spacerDetails(length), length);
  const T = g.placementTransform({ partStart: axis.start, partEnd: axis.end, worldStart: m.start, dir: m.dir });
  closeVec(g.applyPoint(T, axis.start), [0.2, 0.1, 0]);
  closeVec(g.applyPoint(T, axis.end), [0.2, 0.1, 1.25 * IN]);
});

test('chooseLength adds extra length and rounds to the step', () => {
  close(g.toIn(g.chooseLength(1.24 * IN)), 1.24);
  close(g.toIn(g.chooseLength(1.24 * IN, { lengthStep: 0.125 })), 1.25);
  close(g.toIn(g.chooseLength(2 * IN, { extraLength: 0.5 })), 2.5);
  assert.throws(() => g.chooseLength(0.01 * IN, { lengthStep: 0.125 }), /too small/);
});
