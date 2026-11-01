// Runs in the page, injected by the popup each time it is used (the first copy stays). The build puts
// `domToPen` and `MAX_NODES` in front of it: the same capture nib's own browser uses to import pages.
if (!globalThis.__nibCopy) {
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

  const capture = (root, fullPage) => {
    const r = domToPen(root, { maxNodes: MAX_NODES, fullPage });
    return { text: JSON.stringify({ nib: 'dom', node: r.node, url: location.href, count: r.count }), count: r.count, truncated: r.truncated };
  };

  const write = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A page's permissions policy can deny the clipboard API; the copy command still works for the extension.
    }
    const onCopy = (e) => { e.clipboardData.setData('text/plain', text); e.preventDefault(); };
    document.addEventListener('copy', onCopy, true);
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', onCopy, true);
    if (!ok) throw new Error(t('clipboardDenied'));
  };

  const toast = (message) => {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);max-width:80vw;padding:10px 16px;border-radius:8px;background:#1d1e22;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)';
    document.documentElement.append(el);
    setTimeout(() => el.remove(), 3500);
  };

  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + cls.map((c) => `.${c}`).join('');
  };

  let picking = false;
  /** Outline the element under the pointer; a click copies it, ↑/↓ walk to its parent and back, Esc stops. */
  const pick = () => {
    if (picking) return;
    picking = true;
    const box = document.createElement('div');
    box.style.cssText = 'all:initial;position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;border:2px solid #4f7cff;background:rgba(79,124,255,.12);border-radius:2px';
    const tag = document.createElement('div');
    tag.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:4px;background:#4f7cff;color:#fff;font:11px/1.5 ui-monospace,monospace;white-space:nowrap';
    document.documentElement.append(box, tag);
    let target;
    const trail = [];
    const show = (el) => {
      target = el;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      tag.textContent = `${label(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
      Object.assign(tag.style, { left: `${Math.max(0, r.left)}px`, top: `${r.top > 22 ? r.top - 22 : r.bottom + 4}px` });
    };
    const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== target && !trail.includes(el)) { trail.length = 0; show(el); }
    };
    const onClick = async (e) => {
      swallow(e);
      const el = target;
      stop();
      if (!el) return;
      try {
        const r = capture(el, false);
        await write(r.text);
        toast(t(r.truncated ? 'copiedSome' : 'copied', r.count));
      } catch (err) {
        toast(err.message);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { swallow(e); stop(); }
      else if (e.key === 'ArrowUp' && target?.parentElement && target.parentElement !== document.documentElement) { swallow(e); trail.push(target); show(target.parentElement); }
      else if (e.key === 'ArrowDown' && trail.length) { swallow(e); show(trail.pop()); }
    };
    // The page should not react to the press that picks (links, buttons, drag handles).
    const listeners = [['mousemove', onMove], ['click', onClick], ['keydown', onKey], ['mousedown', swallow], ['mouseup', swallow], ['pointerdown', swallow], ['pointerup', swallow]];
    const stop = () => {
      picking = false;
      box.remove();
      tag.remove();
      for (const [type, fn] of listeners) removeEventListener(type, fn, true);
    };
    for (const [type, fn] of listeners) addEventListener(type, fn, true);
    toast(t('pickHint'));
  };

  globalThis.__nibCopy = { page: () => capture(document.documentElement, true), pick };
}
