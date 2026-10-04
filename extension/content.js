// Wires it together: hotkey -> part picker -> selection -> insert.
(function () {
  const { config, api, geometry } = FRCI;
  const log = (...args) => config.debug && console.log('[FRC Inserter]', ...args);
  const ui = FRCI.createUI();
  const inserter = FRCI.createInserter({ api, geometry, config, log });
  const bridge = FRCI.createPanelBridge({ config, log, onKey: (k) => matchesHotkey(k) && run() });
  let busy = false;

  function matchesHotkey(e) {
    const h = config.hotkey;
    return (
      e.code === h.code &&
      Boolean(e.altKey) === Boolean(h.alt) &&
      Boolean(e.shiftKey) === Boolean(h.shift) &&
      Boolean(e.ctrlKey) === Boolean(h.ctrl) &&
      Boolean(e.metaKey) === Boolean(h.meta)
    );
  }

  const isTyping = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  const usable = (sels) =>
    sels.length === 2 && sels.every((s) => s.id && (!s.entityType || /^(FACE|EDGE)$/i.test(s.entityType)));

  window.addEventListener(
    'keydown',
    (e) => {
      if (!matchesHotkey(e) || isTyping(e.target) || !FRCI.parseDocumentUrl(location.pathname)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      run();
    },
    true
  );

  async function run() {
    if (busy) return;
    busy = true;
    try {
      const panelReady = config.autoOpenPanel ? bridge.ensureOpen() : Promise.resolve(bridge.connected);

      // Measure in the background so the picker can show the gap.
      const gapText = (async () => {
        if (!usable(bridge.selections)) {
          if (!(await panelReady)) throw new Error(`Couldn't open the "${config.panelName}" panel.`);
          await bridge.waitFor(() => usable(bridge.selections), { timeoutMs: 800 });
        }
        if (!usable(bridge.selections)) return "Nothing selected yet. You'll pick two faces or circular edges next.";
        return `Gap: ${(await inserter.measure(bridge.selections)).text}`;
      })();

      const part = await ui.pickPart(config.parts, { text: 'Measuring…', promise: gapText });
      if (!part) return;

      if (!(await panelReady)) {
        throw new Error(
          `Couldn't open the "${config.panelName}" panel. Open it once from the right side of the assembly ` +
            '(or set panelButtonSelector in config.js), then try again.'
        );
      }
      // A panel that just opened may receive the current selection a moment after connecting.
      await bridge.waitFor(() => usable(bridge.selections), { timeoutMs: 600 });
      if (!usable(bridge.selections)) {
        const prompt = ui.toast(`Select two parallel faces or circular edges for ${part.name}. Esc cancels.`, 'prompt');
        const abort = new AbortController();
        const stopListening = ui.onEscape(() => abort.abort());
        const picked = await bridge.waitFor(() => usable(bridge.selections), { signal: abort.signal });
        stopListening();
        prompt.close();
        if (!picked) return;
      }

      const status = ui.toast(`Inserting ${part.name}…`, 'progress');
      try {
        const result = await inserter.insert(part, bridge.selections, (text) => status.update(text, 'progress'));
        const mated = result.mateResult === 'mated' ? `, ${String(part.mate).toLowerCase()} mate` : '';
        const summary = `Inserted ${part.name}: ${result.text} (gap ${inserter.fmtIn(result.gapM)}${mated})`;
        status.update([summary, ...result.warnings].join('\n'), result.warnings.length ? 'warning' : 'success');
      } catch (err) {
        log(err);
        status.update(err.message, 'error');
      }
      if (config.closePanelAfterInsert) bridge.closeIfOpenedByUs();
    } catch (err) {
      log(err);
      ui.toast(err.message, 'error');
    } finally {
      busy = false;
    }
  }
})();
