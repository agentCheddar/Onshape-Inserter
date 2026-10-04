// Fake Onshape REST API: two plates with #10 holes, a spacer library part,
// and a "solver" that flips the part when a mate is added unless the anchor
// connector's primary axis is flipped. Replaces FRCI.api before content.js loads.
(function () {
  const IN = 0.0254;
  const g = FRCI.geometry;
  const v3 = ([x, y, z]) => ({ x, y, z });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const translate = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
  const IDENTITY = translate(0, 0, 0);
  const LIB_DOC = '1'.repeat(24);
  const calls = (window.MOCK_CALLS = []);
  let counter = 0;

  const plate = (id, name) => ({
    id,
    name,
    type: 'Part',
    partId: 'PLATE',
    documentId: 'a'.repeat(24),
    elementId: 'f'.repeat(24),
    documentMicroversion: 'e'.repeat(24),
    configuration: 'default',
  });
  const state = {
    instances: [plate('PLATE_A', 'Plate <1>'), plate('PLATE_B', 'Plate <2>')],
    // Plate B sits 1.25 in above plate A; plates are 0.125 in thick.
    occurrences: [
      { path: ['PLATE_A'], transform: translate(0.2, 0.1, 0) },
      { path: ['PLATE_B'], transform: translate(0.2, 0.1, 1.25 * IN) },
    ],
    features: [],
  };
  window.MOCK_STATE = state;

  // Plate in its own coordinates: top face at z=0, bottom at z=-0.125 in, hole at the origin.
  function plateDetails() {
    const t = -0.125 * IN;
    const box = (z) => ({ minCorner: v3([-0.05, -0.05, z]), maxCorner: v3([0.05, 0.05, z]), valid: true });
    return {
      bodies: [
        {
          faces: [
            { id: 'TOP', surface: { type: 'PLANE', origin: v3([0, 0, 0]), normal: v3([0, 0, 1]) }, box: box(0) },
            { id: 'BOTTOM', surface: { type: 'PLANE', origin: v3([0, 0, t]), normal: v3([0, 0, -1]) }, box: box(t) },
          ],
          edges: [
            { id: 'RIM', curve: { type: 'CIRCLE', origin: v3([0, 0, 0]), normal: v3([0, 0, 1]), radius: 0.1 * IN } },
            { id: 'RIM_BOTTOM', curve: { type: 'CIRCLE', origin: v3([0, 0, t]), normal: v3([0, 0, 1]), radius: 0.1 * IN } },
          ],
        },
      ],
    };
  }

  // Spacer: tube along +Z from 0 to its configured length.
  function spacerDetails(configuration) {
    const m = /Length_id=([\d.]+)\+in/.exec(configuration || '');
    const length = (m ? Number(m[1]) : 1) * IN;
    const r = 0.1875 * IN;
    const box = (z0, z1) => ({ minCorner: v3([-r, -r, z0]), maxCorner: v3([r, r, z1]), valid: true });
    return {
      bodies: [
        {
          faces: [
            { id: 'S_START', surface: { type: 'PLANE', origin: v3([0, 0, 0]), normal: v3([0, 0, -1]) }, box: box(0, 0) },
            { id: 'S_END', surface: { type: 'PLANE', origin: v3([0, 0, length]), normal: v3([0, 0, 1]) }, box: box(length, length) },
            { id: 'S_OD', surface: { type: 'CYLINDER', origin: v3([0, 0, 0]), axis: v3([0, 0, 1]) }, box: box(0, length) },
          ],
          edges: [],
        },
      ],
    };
  }

  const occurrence = (path) => state.occurrences.find((o) => o.path.join('/') === path.join('/'));

  // Spin the part 180° about world X through its start point, like a mate
  // that lined up the connectors the wrong way round.
  function flipPart(instanceId) {
    const occ = occurrence([instanceId]);
    const T = occ.transform;
    const s = [T[3], T[7], T[11]];
    const R = [1, 0, 0, 0, -1, 0, 0, 0, -1];
    const rot = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]];
    const m = (i, j) => R[i * 3] * rot[j] + R[i * 3 + 1] * rot[3 + j] + R[i * 3 + 2] * rot[6 + j];
    occ.transform = [m(0, 0), m(0, 1), m(0, 2), s[0], m(1, 0), m(1, 1), m(1, 2), s[1], m(2, 0), m(2, 1), m(2, 2), s[2], 0, 0, 0, 1];
  }

  const connectorPath = (fid) => {
    const f = state.features.find((x) => x.featureId === fid);
    return f.parameters.find((p) => p.parameterId === 'originQuery').queries[0].path;
  };
  const isFlipped = (f) => f.parameters.some((p) => p.parameterId === 'flipPrimary' && p.value === true);

  function render() {
    const el = document.getElementById('calls');
    if (el) el.textContent = calls.map((c, i) => `${i + 1}. ${c.name} ${c.summary || ''}`).join('\n');
  }

  function record(name, impl, summarize = () => '') {
    return async (...args) => {
      const entry = { name, args: clone(args), summary: summarize(...args) };
      calls.push(entry);
      render();
      await new Promise((r) => setTimeout(r, 80));
      if (window.MOCK_FAIL === name) throw new FRCI.ApiError(500, 'MOCK', name, '{"message":"forced failure"}');
      const result = await impl(...args);
      entry.result = clone(result === undefined ? null : result);
      return result;
    };
  }

  FRCI.api = {
    assemblyDefinition: record('assemblyDefinition', async () => ({
      rootAssembly: { instances: clone(state.instances), occurrences: clone(state.occurrences) },
      subAssemblies: [],
    })),
    partBodyDetails: record(
      'partBodyDetails',
      async (ref, partId, configuration) => (partId === 'PLATE' ? plateDetails() : spacerDetails(configuration)),
      (ref, partId, configuration) => `${partId} ${configuration || ''}`
    ),
    parts: record('parts', async () => [{ partId: 'SPACER', name: 'Spacer', bodyType: 'solid' }]),
    versions: record('versions', async () => [
      { id: '2'.repeat(24), name: 'Start', createdAt: '2026-01-01T00:00:00Z' },
      { id: '3'.repeat(24), name: 'V1', createdAt: '2026-09-01T00:00:00Z' },
    ]),
    configuration: record('configuration', async () => ({
      configurationParameters: [
        {
          btType: 'BTMConfigurationParameterQuantity-1826',
          parameterId: 'Length_id',
          parameterName: 'Length',
          quantityType: 'LENGTH',
          rangeAndDefault: { units: 'inch', minValue: 0.125, maxValue: 24, defaultValue: 1 },
        },
      ],
    })),
    encodeConfiguration: record(
      'encodeConfiguration',
      async (did, eid, parameters) => ({
        encodedId: parameters.map((p) => `${p.parameterId}=${p.parameterValue.replace(/ /g, '+')}`).join(';'),
      }),
      (did, eid, parameters) => parameters.map((p) => `${p.parameterId}=${p.parameterValue}`).join(';')
    ),
    createInstance: record(
      'createInstance',
      async (asm, body) => {
        const id = `NEW_${++counter}`;
        state.instances.push({
          id,
          type: 'Part',
          name: `Spacer <${counter}>`,
          partId: body.partId,
          documentId: body.documentId,
          elementId: body.elementId,
          documentVersion: body.versionId,
          configuration: body.configuration,
        });
        state.occurrences.push({ path: [id], transform: IDENTITY.slice() });
        return {};
      },
      (asm, body) => `${body.partId} v=${body.versionId} ${body.configuration}`
    ),
    transformOccurrences: record(
      'transformOccurrences',
      async (asm, paths, transform) => {
        for (const p of paths) occurrence(p).transform = transform.slice();
        return {};
      },
      (asm, paths, T) => `${paths.map((p) => p.join('/')).join(',')} → (${[T[3], T[7], T[11]].map((x) => x.toFixed(4)).join(', ')})`
    ),
    addFeature: record(
      'addFeature',
      async (asm, feature) => {
        const saved = { ...clone(feature), featureId: `F${++counter}` };
        state.features.push(saved);
        if (feature.btType === 'BTMMate-64') {
          const [partMc, anchorMc] = feature.parameters.find((p) => p.parameterId === 'mateConnectorsQuery').queries;
          const anchor = state.features.find((f) => f.featureId === anchorMc.featureId);
          if (!isFlipped(anchor)) flipPart(connectorPath(partMc.featureId)[0]);
        }
        return { feature: saved };
      },
      (asm, f) => `${f.btType} ${f.name}`
    ),
    updateFeature: record(
      'updateFeature',
      async (asm, fid, feature) => {
        const i = state.features.findIndex((f) => f.featureId === fid);
        const wasFlipped = isFlipped(state.features[i]);
        state.features[i] = clone(feature);
        if (feature.btType === 'BTMMateConnector-66' && isFlipped(feature) !== wasFlipped) {
          const mate = state.features.find(
            (f) => f.btType === 'BTMMate-64' && JSON.stringify(f).includes(`"featureId":"${fid}"`)
          );
          if (mate) {
            const partMc = mate.parameters.find((p) => p.parameterId === 'mateConnectorsQuery').queries[0];
            flipPart(connectorPath(partMc.featureId)[0]);
          }
        }
        return { feature };
      },
      (asm, fid, f) => `${fid} ${f.name}${isFlipped(f) ? ' (flipPrimary)' : ''}`
    ),
    deleteFeature: record(
      'deleteFeature',
      async (asm, fid) => {
        state.features = state.features.filter((f) => f.featureId !== fid);
        return {};
      },
      (asm, fid) => fid
    ),
  };

  // Lets the harness check placement: where the newest spacer's ends are, in inches.
  window.spacerEnds = () => {
    const occ = state.occurrences[state.occurrences.length - 1];
    const inst = state.instances.find((x) => x.id === occ.path[0]);
    const length = Number(/Length_id=([\d.]+)/.exec(inst.configuration || '')?.[1] || 0) * IN;
    const toIn = (p) => p.map((x) => +(x / IN).toFixed(4));
    return {
      id: inst.id,
      start: toIn(g.applyPoint(occ.transform, [0, 0, 0])),
      end: toIn(g.applyPoint(occ.transform, [0, 0, length])),
      features: state.features.map((f) => `${f.featureId} ${f.btType} ${f.name}${isFlipped(f) ? ' flipped' : ''}`),
    };
  };
})();
