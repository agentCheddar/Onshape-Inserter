// The insert pipeline: two selections -> gap -> configured library part ->
// insert -> position -> mate.
(function (root) {
  const UNITS = {
    meter: [1, 'm'],
    millimeter: [1e-3, 'mm'],
    centimeter: [1e-2, 'cm'],
    inch: [0.0254, 'in'],
    foot: [0.3048, 'ft'],
    yard: [0.9144, 'yd'],
  };
  // These mates hold the part's start face on the anchor hole.
  const PINNED_MATES = ['FASTENED', 'REVOLUTE'];

  // Pulls {did, wvm, wvmid, eid} out of an Onshape document URL or path.
  function parseDocumentUrl(url) {
    const m = /\/documents\/([0-9a-f]{24})\/([wvm])\/([0-9a-f]{24})\/e\/([0-9a-f]{24})/.exec(url || '');
    return m && { did: m[1], wvm: m[2], wvmid: m[3], eid: m[4] };
  }

  // Assembly definitions may hand back configurations URL-encoded; the API
  // wants them plain because they get encoded again as a query parameter.
  function plainConfiguration(c) {
    if (!c || c === 'default') return undefined;
    return /%[0-9A-F]{2}/i.test(c) ? decodeURIComponent(c) : c;
  }

  const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  root.FRCI = root.FRCI || {};
  root.FRCI.parseDocumentUrl = parseDocumentUrl;

  root.FRCI.createInserter = function ({ api, geometry: g, config, log }) {
    const fmtIn = (m) => `${g.toIn(m).toFixed(3)} in`;
    const tolerances = {
      parallelToleranceDeg: config.parallelToleranceDeg,
      coaxialTolerance: g.fromIn(config.coaxialToleranceIn),
    };

    const cache = new Map();
    function cached(key, ttlMs, fn) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
      const promise = fn();
      cache.set(key, { at: Date.now(), promise });
      promise.catch(() => cache.delete(key));
      return promise;
    }

    function currentAssembly() {
      const ref = parseDocumentUrl(location.pathname);
      if (!ref) throw new Error('Open an assembly first.');
      if (ref.wvm !== 'w') throw new Error('This is a version, not a workspace. Switch to a workspace to insert parts.');
      return { did: ref.did, wid: ref.wvmid, eid: ref.eid };
    }

    function findOccurrence(def, path) {
      return (def.rootAssembly.occurrences || []).find((o) => samePath(o.path, path));
    }

    // Walks an occurrence path down through subassemblies to the instance at its end.
    function findInstance(def, path) {
      let asm = def.rootAssembly;
      for (let i = 0; i < path.length; i++) {
        const inst = (asm.instances || []).find((x) => x.id === path[i]);
        if (!inst || i === path.length - 1) return inst || null;
        const candidates = (def.subAssemblies || []).filter(
          (s) => s.documentId === inst.documentId && s.elementId === inst.elementId
        );
        asm =
          candidates.find(
            (s) => s.documentMicroversion === inst.documentMicroversion && s.fullConfiguration === inst.fullConfiguration
          ) ||
          candidates.find((s) => s.fullConfiguration === inst.fullConfiguration) ||
          candidates[0];
        if (!asm) return null;
      }
      return null;
    }

    function sourceRef(inst) {
      return inst.documentVersion
        ? { did: inst.documentId, wvm: 'v', wvmid: inst.documentVersion, eid: inst.elementId }
        : { did: inst.documentId, wvm: 'm', wvmid: inst.documentMicroversion, eid: inst.elementId };
    }

    async function resolveSelection(sel, def, asm) {
      const inst = findInstance(def, sel.path);
      const occ = findOccurrence(def, sel.path);
      if (!inst || !occ) throw new Error("Couldn't find the selected part in the assembly. Try selecting again.");
      if (inst.type !== 'Part') throw new Error('Select faces or edges on parts.');
      const ref = sourceRef(inst);
      const configuration = plainConfiguration(inst.configuration);
      const details = await cached(
        `bd:${ref.did}/${ref.wvmid}/${ref.eid}/${inst.partId}/${configuration}`,
        10 * 60e3,
        () => api.partBodyDetails(ref, inst.partId, configuration, asm.did)
      );
      const entity = g.findEntity(details, sel.id);
      if (!entity) {
        throw new Error(`Couldn't find the selected ${String(sel.entityType || 'entity').toLowerCase()} on ${inst.name}.`);
      }
      return { ...g.toWorld(entity, occ.transform), selection: sel, occurrenceTransform: occ.transform };
    }

    async function measureIn(asm, selections) {
      if (selections.length !== 2) throw new Error('Select exactly two faces or circular edges.');
      const def = await api.assemblyDefinition(asm);
      const [a, b] = await Promise.all(selections.map((s) => resolveSelection(s, def, asm)));
      return { def, a, b, gap: g.measure(a, b, tolerances) };
    }

    async function resolveLibrary(part, asm) {
      const ref = parseDocumentUrl(part.partStudioUrl);
      if (!ref) throw new Error(`Set partStudioUrl for "${part.name}" in extension/config.js.`);
      let lib;
      if (ref.did === asm.did) {
        // Library in this same document: insert straight from this workspace.
        lib = { ref: { did: ref.did, wvm: 'w', wvmid: asm.wid, eid: ref.eid }, versionId: undefined };
      } else if (ref.wvm === 'v') {
        lib = { ref, versionId: ref.wvmid };
      } else {
        // Parts from other documents can only be inserted from a version; use the newest.
        const versions = await cached(`versions:${ref.did}`, 2 * 60e3, () => api.versions(ref.did));
        const latest = [...(versions || [])].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))[0];
        if (!latest || (versions.length === 1 && latest.name === 'Start')) {
          throw new Error(`Create a version of the library document for "${part.name}" first.`);
        }
        lib = { ref: { did: ref.did, wvm: 'v', wvmid: latest.id, eid: ref.eid }, versionId: latest.id };
      }
      const ttl = lib.ref.wvm === 'v' ? Infinity : 30e3;
      lib.conf = await cached(`conf:${lib.ref.wvmid}/${lib.ref.eid}`, ttl, () => api.configuration(lib.ref));
      lib.ttl = ttl;
      return lib;
    }

    function findConfigParam(conf, nameOrId) {
      return (conf.configurationParameters || []).find((p) => p.parameterName === nameOrId || p.parameterId === nameOrId);
    }

    function configurationParameters(conf, part, lengthM) {
      const lengthName = part.lengthParameter || 'Length';
      const lengthParam = findConfigParam(conf, lengthName);
      if (!lengthParam || !String(lengthParam.btType).startsWith('BTMConfigurationParameterQuantity')) {
        throw new Error(`"${part.name}" needs a length configuration input named "${lengthName}".`);
      }
      const range = lengthParam.rangeAndDefault || {};
      const [factor, abbr] = UNITS[range.units] || UNITS.inch;
      const value = lengthM / factor;
      if (
        (Number.isFinite(range.minValue) && value < range.minValue - 1e-9) ||
        (Number.isFinite(range.maxValue) && value > range.maxValue + 1e-9)
      ) {
        throw new Error(
          `${value.toFixed(3)} ${abbr} is outside the ${range.minValue}–${range.maxValue} ${abbr} range "${part.name}" allows.`
        );
      }
      const parameters = [{ parameterId: lengthParam.parameterId, parameterValue: `${+value.toFixed(6)} ${abbr}` }];
      for (const [key, wanted] of Object.entries(part.otherConfiguration || {})) {
        const p = findConfigParam(conf, key);
        if (!p) throw new Error(`"${part.name}" has no configuration input named "${key}".`);
        let parameterValue = String(wanted);
        if (Array.isArray(p.options)) {
          const option = p.options.find((o) => o.optionName === wanted || o.option === wanted);
          if (!option) {
            throw new Error(`"${key}" has no option "${wanted}". Options: ${p.options.map((o) => o.optionName).join(', ')}.`);
          }
          parameterValue = option.option;
        }
        parameters.push({ parameterId: p.parameterId, parameterValue });
      }
      return parameters;
    }

    function libraryPartId(lib, part, configuration, asm) {
      return cached(`part:${lib.ref.wvmid}/${lib.ref.eid}/${part.partName || ''}`, lib.ttl, async () => {
        const solids = ((await api.parts(lib.ref, configuration, asm.did)) || []).filter(
          (p) => p.bodyType === 'solid' && !p.isHidden
        );
        const match = part.partName ? solids.find((p) => p.name === part.partName) : solids[0];
        if (!match) {
          throw new Error(
            part.partName
              ? `No part named "${part.partName}" in the library Part Studio for "${part.name}".`
              : `The library Part Studio for "${part.name}" has no parts.`
          );
        }
        if (!part.partName && solids.length > 1) log(`"${part.name}" Part Studio has ${solids.length} parts; using ${match.name}`);
        return match.partId;
      });
    }

    function mateConnector(name, path, deterministicId, inferenceType) {
      return {
        btType: 'BTMMateConnector-66',
        featureType: 'mateConnector',
        name,
        suppressed: false,
        isHidden: false,
        parameters: [
          { btType: 'BTMParameterEnum-145', enumName: 'Origin type', value: 'ON_ENTITY', parameterId: 'originType' },
          {
            btType: 'BTMParameterQueryWithOccurrenceList-67',
            parameterId: 'originQuery',
            parameterName: '',
            libraryRelationType: 'NONE',
            queries: [
              { btType: 'BTMInferenceQueryWithOccurrence-1083', inferenceType, path, deterministicIds: [deterministicId] },
            ],
          },
        ],
      };
    }

    function mate(name, mateType, connectorFeatureIds) {
      return {
        btType: 'BTMMate-64',
        featureType: 'mate',
        returnAfterSubfeatures: false,
        subFeatures: [],
        namespace: '',
        version: 2,
        name,
        suppressed: false,
        parameters: [
          { btType: 'BTMParameterEnum-145', namespace: '', enumName: 'Mate type', value: mateType, parameterId: 'mateType' },
          {
            btType: 'BTMParameterQueryWithOccurrenceList-67',
            parameterId: 'mateConnectorsQuery',
            queries: connectorFeatureIds.map((featureId) => ({
              btType: 'BTMFeatureQueryWithOccurrence-157',
              path: [],
              featureId,
              queryData: '',
            })),
          },
        ],
      };
    }

    function withFlippedPrimary(feature) {
      const parameters = (feature.parameters || []).filter((p) => p.parameterId !== 'flipPrimary');
      parameters.push({ btType: 'BTMParameterBoolean-144', parameterId: 'flipPrimary', value: true });
      return { ...feature, parameters };
    }

    // Adds connectors + mate, then checks the part stayed where we put it. Which
    // way an edge's implicit connector faces isn't predictable, so if the mate
    // flipped the part we flip the anchor connector. If that still doesn't land
    // right, the mate is removed and the part is left placed but unmated.
    async function mateIntoPlace(asm, { part, mateType, newInstance, axis, anchor, gap, expectedStart, transform }) {
      const created = [];
      const add = async (feature) => {
        const { feature: saved } = await api.addFeature(asm, feature);
        created.push(saved);
        return saved;
      };
      const verify = async () => {
        const def = await api.assemblyDefinition(asm);
        const occ = findOccurrence(def, [newInstance.id]);
        const anchorOcc = findOccurrence(def, anchor.selection.path);
        const check = occ && g.axisCheck(occ.transform, axis, expectedStart, gap.dir);
        log('Mate check', check);
        return Boolean(
          check && check.ok && anchorOcc && g.sameTransform(anchorOcc.transform, anchor.occurrenceTransform, 1e-6)
        );
      };
      try {
        const partMc = await add(mateConnector(`${part.name} end`, [newInstance.id], axis.startFaceId, 'CENTROID'));
        const anchorMc = await add(mateConnector(`${part.name} anchor`, anchor.selection.path, anchor.selection.id, 'CENTER'));
        await add(mate(`${part.name} ${mateType.toLowerCase()}`, mateType, [partMc.featureId, anchorMc.featureId]));
        if (await verify()) return 'mated';
        log('Mate moved the part; flipping the anchor connector');
        await api.updateFeature(asm, anchorMc.featureId, withFlippedPrimary(anchorMc));
        if (await verify()) return 'mated';
      } catch (err) {
        log('Mating failed', err);
      }
      for (const f of created.reverse()) await api.deleteFeature(asm, f.featureId).catch((err) => log(err));
      await api.transformOccurrences(asm, [[newInstance.id]], transform);
      const anchorOcc = findOccurrence(await api.assemblyDefinition(asm), anchor.selection.path);
      if (anchorOcc && !g.sameTransform(anchorOcc.transform, anchor.occurrenceTransform, 1e-6)) {
        await api.transformOccurrences(asm, [anchor.selection.path], anchor.occurrenceTransform).catch((err) => log(err));
      }
      return 'unmated';
    }

    // Quick gap readout for the picker.
    async function measure(selections) {
      const { gap } = await measureIn(currentAssembly(), selections);
      return { gapM: gap.distance, anchorIsCircle: gap.anchorIsCircle, text: fmtIn(gap.distance) };
    }

    async function insert(part, selections, progress = () => {}) {
      const asm = currentAssembly();
      progress('Measuring…');
      const [{ def, a, b, gap }, lib] = await Promise.all([measureIn(asm, selections), resolveLibrary(part, asm)]);
      const lengthM = g.chooseLength(gap.distance, part);

      progress(`Configuring ${part.name} at ${fmtIn(lengthM)}…`);
      const parameters = configurationParameters(lib.conf, part, lengthM);
      const { encodedId: configuration } = await api.encodeConfiguration(lib.ref.did, lib.ref.eid, parameters, lib.versionId);
      const partId = await libraryPartId(lib, part, configuration, asm);
      const axis = g.partAxis(await api.partBodyDetails(lib.ref, partId, configuration, asm.did), lengthM);

      const mateType = String(part.mate || 'NONE').toUpperCase();
      const anchor = gap.anchorIndex === 0 ? a : b;
      const willMate = mateType !== 'NONE' && gap.anchorIsCircle && Boolean(axis.startFaceId);
      const pinned = willMate && PINNED_MATES.includes(mateType);
      // Pinned mates hold the start face on the anchor; otherwise center any extra length.
      const expectedStart = pinned ? gap.start : g.add(gap.start, g.scale(gap.dir, -(lengthM - gap.distance) / 2));
      const transform = g.placementTransform({
        partStart: axis.start,
        partEnd: axis.end,
        worldStart: expectedStart,
        dir: gap.dir,
      });

      progress(`Inserting ${part.name}…`);
      const before = new Set(def.rootAssembly.instances.map((i) => i.id));
      await api.createInstance(asm, {
        documentId: lib.ref.did,
        elementId: lib.ref.eid,
        versionId: lib.versionId,
        partId,
        configuration,
        isAssembly: false,
        isWholePartStudio: false,
        includePartTypes: ['PARTS'],
      });
      const added = (await api.assemblyDefinition(asm)).rootAssembly.instances.filter((i) => !before.has(i.id));
      const newInstance = added.find((i) => i.partId === partId) || added[added.length - 1];
      if (!newInstance) throw new Error("The part was inserted but Onshape didn't report it back. Check the assembly.");

      progress('Positioning…');
      await api.transformOccurrences(asm, [[newInstance.id]], transform);

      const warnings = [];
      let mateResult = 'none';
      if (mateType !== 'NONE') {
        if (!gap.anchorIsCircle) {
          warnings.push("Two flat faces don't say where the part goes, so it's at the center of the first face, unmated.");
        } else if (!axis.startFaceId) {
          warnings.push("Couldn't find a flat end face on the library part to mate, so it's placed but unmated.");
        } else {
          progress('Mating…');
          mateResult = await mateIntoPlace(asm, { part, mateType, newInstance, axis, anchor, gap, expectedStart, transform });
          if (mateResult === 'unmated') {
            warnings.push(`Couldn't add a ${mateType.toLowerCase()} mate, so the part is placed but unmated.`);
          }
        }
      }
      return { gapM: gap.distance, lengthM, instance: newInstance, mateResult, warnings, text: fmtIn(lengthM) };
    }

    return { measure, insert, fmtIn };
  };
})(globalThis);
