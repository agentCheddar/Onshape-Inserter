// Plays the Onshape client's side of the right-panel protocol: opens the
// panel iframe from a button and posts SELECTION messages to it.
(function () {
  const PANEL = 'http://localhost:8282';
  const path = location.pathname.split('/');
  const ids = { documentId: path[2], workspaceId: path[4], elementId: path[6] };
  let iframe = null;
  let ready = false;
  let invalid = 0;
  let current = [];

  const $ = (id) => document.getElementById(id);

  function status() {
    $('status').textContent =
      `Panel: ${iframe ? (ready ? 'open, initialized' : 'open, loading') : 'closed'}` +
      ` · selected: ${current.length}` +
      ` · unrecognized messages from panel: ${invalid}`;
  }

  function openPanel() {
    iframe = document.createElement('iframe');
    const q = new URLSearchParams({ ...ids, server: location.origin });
    iframe.src = `${PANEL}/?${q}`;
    $('right-panel').append(iframe);
    ready = false;
    status();
  }

  function closePanel() {
    iframe.remove();
    iframe = null;
    ready = false;
    status();
  }

  $('panel-button').addEventListener('click', () => (iframe ? closePanel() : openPanel()));

  window.addEventListener('message', (e) => {
    if (e.origin !== PANEL) return;
    const d = e.data || {};
    const known = ['applicationInit', 'keepAlive', 'showMessageBubble', 'requestSelection', 'stopRequest'];
    if (!known.includes(d.messageName) || d.documentId !== ids.documentId) {
      invalid++; // Real Onshape would stop sending selections now.
    } else if (d.messageName === 'applicationInit') {
      ready = true;
      if ($('replay').checked) sendSelection();
    }
    status();
  });

  function sendSelection() {
    if (iframe && ready && invalid === 0) {
      iframe.contentWindow.postMessage({ messageName: 'SELECTION', selections: current }, PANEL);
    }
  }

  const entity = (entityType, selectionId, instance) => ({
    selectionType: 'ENTITY',
    entityType,
    selectionId,
    occurrencePath: [instance],
  });
  const choices = {
    holes: [entity('EDGE', 'RIM', 'PLATE_A'), entity('EDGE', 'RIM_BOTTOM', 'PLATE_B')],
    faces: [entity('FACE', 'TOP', 'PLATE_A'), entity('FACE', 'BOTTOM', 'PLATE_B')],
    holeFace: [entity('FACE', 'BOTTOM', 'PLATE_B'), entity('EDGE', 'RIM', 'PLATE_A')],
    clear: [],
  };
  for (const [key, list] of Object.entries(choices)) {
    $(`select-${key}`).addEventListener('click', () => {
      current = list;
      sendSelection();
      status();
    });
  }
  status();
})();
