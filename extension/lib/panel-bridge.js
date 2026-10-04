// Talks to the FRC Inserter right-panel page (docs/), which is the only place
// Onshape sends selections. We hand the panel a private MessageChannel port so
// our messages never reach Onshape's own postMessage listener (Onshape stops
// talking to a panel that posts it unrecognized messages).
(function (root) {
  root.FRCI = root.FRCI || {};

  root.FRCI.createPanelBridge = function ({ config, log, onKey }) {
    const panelUrl = config.panelUrl.split('?')[0];
    const panelOrigin = new URL(panelUrl).origin;
    const listeners = new Set();
    let iframe = null;
    let port = null;
    let pending = null;
    let selections = [];
    let openedByUs = false;

    const notify = () => listeners.forEach((fn) => fn());

    function findIframe() {
      return [...document.querySelectorAll('iframe')].find((f) => (f.src || '').startsWith(panelUrl)) || null;
    }

    function disconnect() {
      if (port) port.close();
      if (pending) pending.close();
      port = pending = null;
      selections = [];
      notify();
    }

    function tryConnect() {
      if (pending) pending.close();
      const channel = new MessageChannel();
      pending = channel.port1;
      channel.port1.onmessage = (e) => handle(channel.port1, e.data || {});
      try {
        iframe.contentWindow.postMessage({ frcInserter: 'connect' }, panelOrigin, [channel.port2]);
      } catch (_) {
        // The iframe hasn't loaded the panel yet; the next tick retries.
      }
    }

    function handle(from, msg) {
      if (msg.type === 'hello') {
        if (port && port !== from) port.close();
        port = from;
        pending = null;
        log('Panel connected');
      } else if (from !== port) {
        return;
      }
      if (msg.type === 'hello' || msg.type === 'selection') {
        selections = Array.isArray(msg.selections) ? msg.selections : [];
        log('Selection', selections);
        notify();
      } else if (msg.type === 'key') {
        onKey(msg);
      }
    }

    setInterval(() => {
      const found = findIframe();
      if (found !== iframe) {
        iframe = found;
        disconnect();
        if (iframe) iframe.addEventListener('load', disconnect);
        else openedByUs = false;
      }
      if (iframe && !port) tryConnect();
    }, 400);

    // Resolves true once predicate() holds, or false on timeout/abort.
    function waitFor(predicate, { timeoutMs = Infinity, signal } = {}) {
      return new Promise((resolve) => {
        if (predicate()) return resolve(true);
        let timer;
        const finish = (value) => {
          listeners.delete(check);
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(value);
        };
        const check = () => predicate() && finish(true);
        const onAbort = () => finish(false);
        listeners.add(check);
        if (Number.isFinite(timeoutMs)) timer = setTimeout(() => finish(false), timeoutMs);
        if (signal) signal.addEventListener('abort', onAbort);
      });
    }

    // Onshape's markup isn't documented, so look for anything visible whose
    // tooltip-ish attributes carry the extension's name.
    function findPanelButton() {
      if (config.panelButtonSelector) return document.querySelector(config.panelButtonSelector);
      const name = config.panelName.toLowerCase();
      const attrs = ['title', 'aria-label', 'data-original-title', 'data-tooltip', 'tooltip', 'uib-tooltip', 'alt'];
      const hits = [...document.querySelectorAll(attrs.map((a) => `[${a}]`).join(','))].filter(
        (el) =>
          el.tagName !== 'IFRAME' &&
          el.getClientRects().length > 0 &&
          attrs.some((a) => (el.getAttribute(a) || '').toLowerCase().includes(name))
      );
      const clickable = (el) => el.closest('button, [role="button"], a');
      const hit = hits.find(clickable) || hits[0];
      return hit ? clickable(hit) || hit : null;
    }

    async function ensureOpen(timeoutMs = 6000) {
      if (port) return true;
      if (!findIframe()) {
        const button = findPanelButton();
        if (!button) {
          log('Panel button not found');
          return false;
        }
        button.click();
        openedByUs = true;
      }
      return waitFor(() => Boolean(port), { timeoutMs });
    }

    function closeIfOpenedByUs() {
      if (!openedByUs || !findIframe()) return;
      const button = findPanelButton();
      if (button) button.click();
      openedByUs = false;
    }

    return {
      get connected() {
        return Boolean(port);
      },
      get selections() {
        return selections;
      },
      waitFor,
      ensureOpen,
      closeIfOpenedByUs,
    };
  };
})(globalThis);
