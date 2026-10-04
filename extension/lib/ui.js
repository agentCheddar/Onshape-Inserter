// Part picker and status toasts, drawn in a shadow root so Onshape's styles
// and ours can't collide.
(function (root) {
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .backdrop { position: fixed; inset: 0; pointer-events: auto; background: rgba(15, 23, 42, 0.12); }
    .picker {
      position: fixed; top: 18vh; left: 50%; transform: translateX(-50%); width: 300px; max-width: calc(100vw - 32px);
      background: #fff; color: #1f2937; border: 1px solid #d1d5db; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18); pointer-events: auto; overflow: hidden;
    }
    .head { padding: 12px 14px 8px; }
    .title { font-size: 14px; font-weight: 600; }
    .gap { font-size: 12px; color: #4b5563; margin-top: 4px; min-height: 16px; }
    .gap.error { color: #b91c1c; }
    ul { list-style: none; margin: 0; padding: 4px 0; border-top: 1px solid #eef0f3; }
    li { display: flex; align-items: center; gap: 10px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
    li.active, li:hover { background: #eef4ff; }
    kbd {
      min-width: 20px; padding: 1px 6px; border: 1px solid #c7ccd4; border-bottom-width: 2px; border-radius: 4px;
      font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; color: #374151; background: #f9fafb;
    }
    .hint { padding: 8px 14px 10px; font-size: 11px; color: #6b7280; border-top: 1px solid #eef0f3; }
    .toasts {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column;
      gap: 8px; align-items: center; width: 420px; max-width: calc(100vw - 32px);
    }
    .toast {
      display: flex; gap: 10px; align-items: flex-start; width: 100%; padding: 10px 12px; border-radius: 8px;
      background: #1f2937; color: #f9fafb; font-size: 13px; line-height: 1.4; white-space: pre-line;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25); pointer-events: auto; border-left: 4px solid #60a5fa;
    }
    .toast.success { border-left-color: #34d399; }
    .toast.warning { border-left-color: #fbbf24; }
    .toast.error { border-left-color: #f87171; }
    .toast.prompt { border-left-color: #a78bfa; }
    .toast .msg { flex: 1; }
    .toast button { all: unset; cursor: pointer; color: #9ca3af; font-size: 16px; line-height: 1; padding: 0 2px; }
    .toast button:hover { color: #f9fafb; }
    .spinner {
      width: 14px; height: 14px; margin-top: 2px; border: 2px solid #4b5563; border-top-color: #60a5fa;
      border-radius: 50%; animation: spin 0.8s linear infinite; flex: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  root.FRCI = root.FRCI || {};

  root.FRCI.createUI = function () {
    let shadow = null;

    function mount() {
      if (shadow) return shadow;
      const host = document.createElement('div');
      host.id = 'frc-inserter-ui';
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      document.documentElement.appendChild(host);
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${CSS}</style><div class="toasts"></div>`;
      return shadow;
    }

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    // Swallows every key while active so Onshape shortcuts don't fire underneath.
    function captureKeys(handler) {
      const listener = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        handler(e);
      };
      window.addEventListener('keydown', listener, true);
      return () => window.removeEventListener('keydown', listener, true);
    }

    // info: { text, promise } where promise resolves to a replacement line.
    function pickPart(parts, info) {
      const shadowRoot = mount();
      return new Promise((resolve) => {
        const backdrop = el('div', 'backdrop');
        const picker = el('div', 'picker');
        const head = el('div', 'head');
        const gap = el('div', 'gap', info.text || '');
        head.append(el('div', 'title', 'Insert part'), gap);
        const list = el('ul');
        let index = 0;
        const items = parts.map((part, i) => {
          const li = el('li');
          li.append(el('kbd', '', part.key), el('span', '', part.name));
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            finish(parts[i]);
          });
          list.append(li);
          return li;
        });
        const highlight = () => items.forEach((li, i) => li.classList.toggle('active', i === index));
        highlight();
        picker.append(head, list, el('div', 'hint', 'Press a key, ↑↓ and Enter, or Esc to cancel'));
        shadowRoot.append(backdrop, picker);

        let done = false;
        if (info.promise) {
          info.promise.then(
            (text) => !done && (gap.textContent = text),
            (err) => {
              if (done) return;
              gap.textContent = err.message;
              gap.classList.add('error');
            }
          );
        }

        const release = captureKeys((e) => {
          if (e.key === 'Escape') return finish(null);
          if (e.key === 'Enter') return finish(parts[index]);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            index = (index + (e.key === 'ArrowDown' ? 1 : parts.length - 1)) % parts.length;
            return highlight();
          }
          const part = parts.find((p) => String(p.key).toLowerCase() === e.key.toLowerCase());
          if (part) finish(part);
        });
        backdrop.addEventListener('mousedown', () => finish(null));

        function finish(part) {
          if (done) return;
          done = true;
          release();
          backdrop.remove();
          picker.remove();
          resolve(part);
        }
      });
    }

    // kind: 'progress' | 'prompt' | 'success' | 'warning' | 'error' | 'info'
    function toast(message, kind = 'info') {
      const box = el('div');
      const msg = el('div', 'msg');
      const close = el('button', '', '×');
      close.title = 'Dismiss';
      let timer;
      const handle = {
        update(text, newKind = kind) {
          kind = newKind;
          box.className = `toast ${kind}`;
          msg.textContent = text;
          box.querySelector('.spinner')?.remove();
          if (kind === 'progress') box.prepend(el('div', 'spinner'));
          clearTimeout(timer);
          const ttl = { success: 5000, info: 5000, warning: 12000, error: 15000 }[kind];
          if (ttl) timer = setTimeout(handle.close, ttl);
          return handle;
        },
        close() {
          clearTimeout(timer);
          box.remove();
        },
      };
      close.addEventListener('click', handle.close);
      box.append(msg, close);
      mount().querySelector('.toasts').append(box);
      return handle.update(message, kind);
    }

    // Calls onCancel when Esc is pressed; returns a function that stops listening.
    function onEscape(onCancel) {
      const listener = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      };
      window.addEventListener('keydown', listener, true);
      return () => window.removeEventListener('keydown', listener, true);
    }

    return { pickPart, toast, onEscape };
  };
})(globalThis);
