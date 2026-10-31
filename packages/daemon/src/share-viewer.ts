/**
 * The viewer page of a shared design: a self-contained HTML file that reads share.json beside it and shows the
 * frames as a grid, one at a time (arrow keys, prototype hotspots), or full screen. No scripts from elsewhere,
 * so the folder can be served by any static host.
 */
export const VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nib</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #111113; color: #e9e9ec; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif; }
  header { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid #26262b; }
  header h1 { font-size: 15px; font-weight: 600; margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header span { color: #8d8d95; font-size: 12px; }
  button { font: inherit; color: inherit; background: #222226; border: 1px solid #2f2f35; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  button:hover { background: #2a2a30; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; padding: 24px; }
  .card { background: none; border: 0; padding: 0; text-align: left; }
  .card img { width: 100%; aspect-ratio: 16 / 10; object-fit: contain; background: #1b1b1f; border: 1px solid #26262b; border-radius: 10px; display: block; }
  .card:hover img { border-color: #4b8dff; }
  .card div { color: #a0a0a8; font-size: 12px; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stage { position: fixed; inset: 0; background: #000; display: none; }
  .stage.on { display: block; }
  .frame { position: absolute; transition: opacity 180ms ease; }
  .frame img { width: 100%; height: 100%; display: block; }
  .frame.fade { opacity: 0; }
  .hot { position: absolute; border-radius: 4px; cursor: pointer; }
  .hot:hover { box-shadow: 0 0 0 2px #4b8dffaa; background: #4b8dff1a; }
  .bar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 10px; background: #1c1c1fd9; opacity: 0; transition: opacity 200ms; }
  .stage:hover .bar { opacity: 1; }
  .bar span { min-width: 64px; text-align: center; color: #c9c9cf; font-variant-numeric: tabular-nums; }
  .empty { padding: 48px 24px; color: #8d8d95; }
  @media (prefers-reduced-motion: reduce) { .frame { transition: none; } }
</style>
</head>
<body>
<header><h1 id="title">nib</h1><span id="meta"></span><button id="present">Present</button></header>
<main id="grid" class="grid"></main>
<div id="stage" class="stage">
  <div id="frame" class="frame"><img id="image" alt=""></div>
  <div class="bar"><button id="prev">‹</button><span id="count"></span><button id="next">›</button><button id="close">✕</button></div>
</div>
<script>
(async () => {
  const share = await (await fetch('share.json', { cache: 'no-cache' })).json();
  const frames = share.frames;
  const $ = (id) => document.getElementById(id);
  document.title = $('title').textContent = share.name;
  $('meta').textContent = new Date(share.created).toLocaleString();
  if (!frames.length) $('grid').innerHTML = '<p class="empty">Nothing to show.</p>';
  for (const [i, f] of frames.entries()) {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = '<img loading="lazy" alt="">' + '<div></div>';
    b.querySelector('img').src = f.file;
    b.querySelector('div').textContent = f.name;
    b.onclick = () => show(i);
    $('grid').append(b);
  }
  let current = -1;
  const place = () => {
    const f = frames[current];
    if (!f) return;
    const s = Math.min(innerWidth / f.width, innerHeight / f.height);
    Object.assign($('frame').style, { width: f.width * s + 'px', height: f.height * s + 'px', left: (innerWidth - f.width * s) / 2 + 'px', top: (innerHeight - f.height * s) / 2 + 'px' });
    for (const h of $('frame').querySelectorAll('.hot')) {
      const l = f.links[Number(h.dataset.i)];
      Object.assign(h.style, { left: l.x * s + 'px', top: l.y * s + 'px', width: l.width * s + 'px', height: l.height * s + 'px' });
    }
  };
  const draw = () => {
    const f = frames[current];
    $('image').src = f.file;
    $('count').textContent = (current + 1) + ' / ' + frames.length;
    for (const h of $('frame').querySelectorAll('.hot')) h.remove();
    f.links.forEach((l, i) => {
      const h = document.createElement('div');
      h.className = 'hot';
      h.dataset.i = String(i);
      h.title = l.label || '';
      h.onclick = (e) => { e.stopPropagation(); follow(l); };
      $('frame').append(h);
    });
    place();
  };
  function show(i, transition) {
    if (i < 0 || i >= frames.length) return;
    const first = current < 0;
    $('stage').classList.add('on');
    current = i;
    history.replaceState(null, '', '#' + (i + 1));
    if (transition && transition !== 'instant' && !first) {
      $('frame').classList.add('fade');
      setTimeout(() => { draw(); $('frame').classList.remove('fade'); }, 180);
    } else draw();
  }
  function follow(l) {
    if (l.to === 'next') return show(current + 1, l.transition);
    if (l.to === 'previous') return show(current - 1, l.transition);
    const i = frames.findIndex((f) => f.id === l.to);
    if (i >= 0) show(i, l.transition);
  }
  const close = () => { $('stage').classList.remove('on'); current = -1; history.replaceState(null, '', '#'); if (document.fullscreenElement) document.exitFullscreen(); };
  $('prev').onclick = (e) => { e.stopPropagation(); show(current - 1); };
  $('next').onclick = (e) => { e.stopPropagation(); show(current + 1); };
  $('close').onclick = (e) => { e.stopPropagation(); close(); };
  $('stage').onclick = (e) => show(current + (e.shiftKey ? -1 : 1));
  $('present').onclick = () => { show(Math.max(0, current)); document.documentElement.requestFullscreen?.().catch(() => {}); };
  addEventListener('resize', place);
  addEventListener('keydown', (e) => {
    if (current < 0) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) show(current + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) show(current - 1);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  });
  const start = Number(location.hash.slice(1));
  if (start >= 1 && start <= frames.length) show(start - 1);
})();
</script>
</body>
</html>
`;
