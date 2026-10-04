// FRC Inserter's Onshape right-panel page. Onshape only sends selections to
// app panels, so this page's whole job is to pass them to the Chrome
// extension over the private port the extension hands it.
(function () {
  const params = new URLSearchParams(location.search);
  const ids = {
    documentId: params.get('documentId'),
    workspaceId: params.get('workspaceId'),
    elementId: params.get('elementId'),
  };
  const server = params.get('server') || 'https://cad.onshape.com';
  const recent = [];
  let port = null;
  let selections = [];

  // Only valid Onshape messages may go to the parent window: Onshape stops
  // sending selections to a panel that posts anything it doesn't recognize.
  function toOnshape(messageName, extra = {}) {
    window.parent.postMessage({ ...ids, messageName, ...extra }, server);
  }

  function toExtension(msg) {
    if (port) port.postMessage(msg);
  }

  function normalize(data) {
    const list = data.selections || data.selection || [];
    return (Array.isArray(list) ? list : [list])
      .map((s) => ({
        id: s.selectionId || s.deterministicId || s.id,
        entityType: s.entityType,
        path: Array.isArray(s.occurrencePath)
          ? s.occurrencePath
          : typeof s.occurrencePath === 'string'
            ? s.occurrencePath.split('/').filter(Boolean)
            : s.path || [],
      }))
      .filter((s) => s.id);
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== server) return;
    const data = e.data || {};

    if (data.frcInserter === 'connect' && e.ports && e.ports[0]) {
      if (port) port.close();
      port = e.ports[0];
      port.onmessage = (m) => fromExtension(m.data || {});
      toExtension({ type: 'hello', selections });
      render();
      return;
    }

    if (!data.messageName) return;
    recent.unshift(data);
    recent.length = Math.min(recent.length, 8);
    if (data.messageName === 'SELECTION') {
      selections = normalize(data);
      toExtension({ type: 'selection', selections });
    }
    render();
  });

  function fromExtension(msg) {
    if (msg.type === 'ping') toExtension({ type: 'hello', selections });
    else if (msg.type === 'bubble') toOnshape('showMessageBubble', { message: String(msg.message) });
  }

  // If you've clicked into this panel, the hotkey lands here; pass it along.
  document.addEventListener('keydown', (e) => {
    toExtension({
      type: 'key',
      code: e.code,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    });
  });

  function render() {
    const status = document.getElementById('status');
    status.textContent = port ? 'Connected to the Chrome extension' : 'Waiting for the FRC Inserter Chrome extension…';
    status.className = port ? 'status ok' : 'status';

    const list = document.getElementById('selection');
    list.replaceChildren(
      ...selections.map((s) => {
        const li = document.createElement('li');
        li.textContent = `${(s.entityType || 'entity').toLowerCase()} ${s.id}`;
        return li;
      })
    );
    document.getElementById('count').textContent =
      selections.length === 1 ? '1 thing selected' : `${selections.length} things selected`;
    document.getElementById('raw').textContent = recent.length
      ? recent.map((m) => JSON.stringify(m, null, 2)).join('\n\n')
      : 'No messages from Onshape yet.';
  }

  render();
  toOnshape('applicationInit');
})();
