// The toolbar popup: copy the page, or start picking an element on it, to paste into nib as layers.
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));
for (const el of document.querySelectorAll('[data-msg]')) el.textContent = t(el.dataset.msg);
const status = document.getElementById('status');

/** The capture code into the active tab; throws on pages Chrome keeps extensions out of (chrome://, the Web Store). */
async function inject() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
  } catch {
    throw new Error(t('cannotRead'));
  }
  return tab.id;
}

const call = async (tabId, name) => (await chrome.scripting.executeScript({ target: { tabId }, func: (n) => globalThis.__nibCopy[n](), args: [name] }))[0]?.result;

document.getElementById('page').onclick = async () => {
  status.textContent = t('copying');
  try {
    const r = await call(await inject(), 'page');
    await navigator.clipboard.writeText(r.text);
    status.textContent = t(r.truncated ? 'copiedSome' : 'copied', r.count);
  } catch (e) {
    status.textContent = e.message;
  }
};

document.getElementById('pick').onclick = async () => {
  try {
    await call(await inject(), 'pick');
    window.close();
  } catch (e) {
    status.textContent = e.message;
  }
};
