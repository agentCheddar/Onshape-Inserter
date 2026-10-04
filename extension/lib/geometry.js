// Pure geometry helpers. All lengths are meters (Onshape's API unit) unless a
// name says otherwise. Transforms are Onshape's row-major 4x4 arrays.
(function (root) {
  const M_PER_IN = 0.0254;

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => scale(a, 1 / len(a));
  const vec = (o) => [o.x, o.y, o.z];
  const toIn = (m) => m / M_PER_IN;
  const fromIn = (inches) => inches * M_PER_IN;

  function applyPoint(T, p) {
    return [
      T[0] * p[0] + T[1] * p[1] + T[2] * p[2] + T[3],
      T[4] * p[0] + T[5] * p[1] + T[6] * p[2] + T[7],
      T[8] * p[0] + T[9] * p[1] + T[10] * p[2] + T[11],
    ];
  }

  function applyDir(T, d) {
    return [
      T[0] * d[0] + T[1] * d[1] + T[2] * d[2],
      T[4] * d[0] + T[5] * d[1] + T[6] * d[2],
      T[8] * d[0] + T[9] * d[1] + T[10] * d[2],
    ];
  }

  function boxCenter(box) {
    if (!box || box.valid === false || !box.minCorner || !box.maxCorner) return null;
    return scale(add(vec(box.minCorner), vec(box.maxCorner)), 0.5);
  }

  // Finds a face or edge by deterministic ID in a bodydetails response and
  // returns the geometry this tool understands: planar faces and circular edges.
  function findEntity(bodyDetails, id) {
    for (const body of bodyDetails.bodies || []) {
      for (const face of body.faces || []) {
        if (face.id !== id) continue;
        const s = face.surface || {};
        if (s.type !== 'PLANE') {
          throw new Error(`The selected face is ${(s.type || 'not planar').toLowerCase()}; pick a flat face or a circular edge.`);
        }
        const point = vec(s.origin);
        const normal = norm(vec(s.normal));
        const center = boxCenter(face.box) || point;
        return { kind: 'plane', point, normal, center: sub(center, scale(normal, dot(sub(center, point), normal))) };
      }
      for (const edge of body.edges || []) {
        if (edge.id !== id) continue;
        const c = edge.curve || {};
        if (c.type !== 'CIRCLE') {
          throw new Error(`The selected edge is ${(c.type || 'not circular').toLowerCase()}; pick a circular edge or a flat face.`);
        }
        return { kind: 'circle', center: vec(c.origin), normal: norm(vec(c.normal)), radius: c.radius };
      }
    }
    return null;
  }

  function toWorld(entity, T) {
    const out = { ...entity, normal: norm(applyDir(T, entity.normal)) };
    if (entity.point) out.point = applyPoint(T, entity.point);
    if (entity.center) out.center = applyPoint(T, entity.center);
    return out;
  }

  // Measures the gap between two world-space entities. The part is anchored on
  // the first circle (so it lands on the hole axis) or, with two faces, on the
  // center of the first face. `dir` points from the anchor toward the other one.
  function measure(a, b, { parallelToleranceDeg = 0.5, coaxialTolerance = 0.0005 } = {}) {
    const n = a.normal;
    const cosAngle = Math.min(1, Math.abs(dot(n, b.normal)));
    const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;
    if (angleDeg > parallelToleranceDeg) {
      throw new Error(`Those aren't parallel (${angleDeg.toFixed(1)}° apart).`);
    }
    const anchorIndex = a.kind === 'circle' || b.kind !== 'circle' ? 0 : 1;
    const anchor = anchorIndex === 0 ? a : b;
    const other = anchorIndex === 0 ? b : a;
    const start = anchor.center;
    const delta = sub(other.kind === 'circle' ? other.center : other.point, start);
    const signed = dot(delta, n);
    const distance = Math.abs(signed);
    if (distance < 1e-6) throw new Error('Those are in the same plane, so there is no gap to fill.');
    let offset = 0;
    if (anchor.kind === 'circle' && other.kind === 'circle') {
      offset = len(sub(delta, scale(n, signed)));
      if (offset > coaxialTolerance) {
        throw new Error(`Those holes aren't lined up (${toIn(offset).toFixed(3)} in off-axis).`);
      }
    }
    return {
      distance,
      start,
      dir: scale(n, Math.sign(signed)),
      anchorIndex,
      anchorIsCircle: anchor.kind === 'circle',
      offset,
    };
  }

  // Rotation matrix (3x3, row-major) taking unit vector a onto unit vector b.
  function rotationFromTo(a, b) {
    const c = dot(a, b);
    if (c > 1 - 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (c < -1 + 1e-12) {
      const u = norm(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
      return [
        2 * u[0] * u[0] - 1, 2 * u[0] * u[1], 2 * u[0] * u[2],
        2 * u[1] * u[0], 2 * u[1] * u[1] - 1, 2 * u[1] * u[2],
        2 * u[2] * u[0], 2 * u[2] * u[1], 2 * u[2] * u[2] - 1,
      ];
    }
    const v = cross(a, b);
    const k = 1 / (1 + c);
    return [
      v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
      v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
      v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
    ];
  }

  // Transform that puts the part's start point at worldStart with its axis
  // (start -> end, in Part Studio coordinates) pointing along dir.
  function placementTransform({ partStart, partEnd, worldStart, dir }) {
    const R = rotationFromTo(norm(sub(partEnd, partStart)), norm(dir));
    const rs = [
      R[0] * partStart[0] + R[1] * partStart[1] + R[2] * partStart[2],
      R[3] * partStart[0] + R[4] * partStart[1] + R[5] * partStart[2],
      R[6] * partStart[0] + R[7] * partStart[1] + R[8] * partStart[2],
    ];
    const t = sub(worldStart, rs);
    return [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1];
  }

  // Works out a straight part's axis from its bodydetails: the bounding-box
  // dimension closest to the configured length is the axis, and the part is
  // assumed symmetric about it (true for spacers and hex shafts).
  function partAxis(bodyDetails, lengthM) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const grow = (p) => {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    };
    const faces = [];
    for (const body of bodyDetails.bodies || []) {
      for (const face of body.faces || []) {
        faces.push(face);
        if (face.box && face.box.valid !== false && face.box.minCorner) {
          grow(vec(face.box.minCorner));
          grow(vec(face.box.maxCorner));
        }
      }
      for (const v of body.vertices || []) if (v.point) grow(vec(v.point));
    }
    if (!Number.isFinite(min[0])) throw new Error('The library part has no geometry to measure.');

    // Prefer Z, then X, then Y when two dimensions are equally close.
    let k = 2;
    for (const i of [2, 0, 1]) {
      if (Math.abs(max[i] - min[i] - lengthM) < Math.abs(max[k] - min[k] - lengthM) - 1e-9) k = i;
    }
    const extent = max[k] - min[k];
    if (Math.abs(extent - lengthM) > 1e-4) {
      throw new Error(
        `The library part came out ${toIn(extent).toFixed(3)} in long instead of ${toIn(lengthM).toFixed(3)} in. ` +
          'Check that its Length configuration input drives the part length.'
      );
    }
    const center = scale(add(min, max), 0.5);
    const start = center.slice();
    const end = center.slice();
    start[k] = min[k];
    end[k] = max[k];

    // The flat end face at `at`: normal along the axis, closest to the axis.
    const endFaceId = (at) => {
      let best = null;
      for (const face of faces) {
        const s = face.surface || {};
        if (s.type !== 'PLANE') continue;
        const n = norm(vec(s.normal));
        if (Math.abs(Math.abs(n[k]) - 1) > 1e-6 || Math.abs(vec(s.origin)[k] - at[k]) > 1e-6) continue;
        const score = len(sub(boxCenter(face.box) || vec(s.origin), at));
        if (!best || score < best.score) best = { id: face.id, score };
      }
      return best ? best.id : null;
    };
    return { axisIndex: k, start, end, startFaceId: endFaceId(start), endFaceId: endFaceId(end) };
  }

  // Checks where a part ended up: its start point and axis direction, ignoring
  // spin about the axis (which mates are free to choose).
  function axisCheck(T, axis, expectedStart, dir, tolerance = 1e-5) {
    const start = applyPoint(T, axis.start);
    const a = norm(applyDir(T, sub(axis.end, axis.start)));
    const startError = len(sub(start, expectedStart));
    const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot(a, norm(dir))))) * 180) / Math.PI;
    return { ok: startError < tolerance && angleDeg < 0.05, startError, angleDeg };
  }

  // Gap plus extra length, rounded to the part's length step. Settings are in inches.
  function chooseLength(gapM, { extraLength = 0, lengthStep = 0 } = {}) {
    let inches = toIn(gapM) + extraLength;
    if (lengthStep > 0) inches = Math.round(inches / lengthStep) * lengthStep;
    if (inches <= 0) throw new Error('That gap is too small for this part.');
    return fromIn(inches);
  }

  function sameTransform(A, B, tolerance = 1e-7) {
    return A.length === B.length && A.every((x, i) => Math.abs(x - B[i]) < tolerance);
  }

  const api = {
    M_PER_IN, add, sub, scale, dot, cross, len, norm, vec, toIn, fromIn,
    applyPoint, applyDir, findEntity, toWorld, measure, rotationFromTo,
    placementTransform, partAxis, axisCheck, chooseLength, sameTransform,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.FRCI = root.FRCI || {}).geometry = api;
})(globalThis);
