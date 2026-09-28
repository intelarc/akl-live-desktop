// Real photos of each bus model, as in the Android app: the lead photo from its
// page on the AT Metro Wiki (CC BY-SA), or failing that a Wikimedia Commons
// photo whose file name says it's this very model. Looked up once a fortnight
// per model and remembered on this computer; the images themselves come from
// the browser's cache.
(function (A) {
  'use strict';
  const WIKI = 'https://atmetro.fandom.com';
  const VERSION = 3;                                // bumped when the lookup changes, so a wrong photo isn't kept
  const KEEP_MS = 14 * 864e5, MISS_MS = 864e5;      // a photo keeps a fortnight; not finding one is tried again tomorrow
  const STORE = 'akl.photos';
  const WIKI_CREDIT = 'Photo: AT Metro Wiki, CC BY-SA';
  const NOT_A_BUS = /logo|icon|wordmark|favicon|placeholder|\bmap\b|route_?map|diagram|\.svg|\.gif/i;
  // things that come up searching for a model number and are anything but a bus
  const OFF_TOPIC = /ship|boat|launch|ferry|yacht|vessel|aircraft|plane|locomotive|tram|truck|lorry|car\b|tractor|map|logo/i;

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { saved = {}; }
  const mem = new Map(), pending = new Map();

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const enc = encodeURIComponent;
  const wikiPage = (t) => WIKI + '/wiki/' + enc(t.replace(/ /g, '_')).replace(/%2F/g, '/');
  const api = (q) => `${WIKI}/api.php?action=query&format=json&origin=*&redirects=1&${q}`;
  async function json(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /** The lead photo of the first of these pages that has one. */
  async function leadPhoto(titles) {
    const q = (await json(api('prop=pageimages&piprop=thumbnail&pithumbsize=1200&titles=' + enc(titles.join('|'))))).query;
    if (!q) return null;
    // follow "normalized" and "redirects" so the answer lines up with what was asked
    const moved = {};
    for (const k of ['normalized', 'redirects']) for (const x of q[k] || []) moved[x.from] = x.to;
    const resolve = (t) => { for (let i = 0; i < 3 && moved[t]; i++) t = moved[t]; return t; };
    const byTitle = {};
    for (const p of Object.values(q.pages || {})) byTitle[p.title] = p;
    for (const t of titles) {
      const p = byTitle[resolve(t)];
      const src = p && p.thumbnail && p.thumbnail.source;
      if (src && !NOT_A_BUS.test(src)) return { url: src, page: wikiPage(p.title), credit: WIKI_CREDIT };
    }
    return null;
  }

  /** When the wiki doesn't mark a lead photo: the photos on the model's page, ones naming the model first. */
  async function pagePhoto(title, key) {
    const pages = ((await json(api('prop=images&imlimit=50&titles=' + enc(title)))).query || {}).pages || {};
    const page = Object.values(pages).find((p) => !('missing' in p));
    if (!page) return null;
    const files = (page.images || []).map((i) => i.title).filter((t) => !NOT_A_BUS.test(t) && /\.(jpe?g|png|webp)$/i.test(t));
    if (!files.length) return null;
    const ordered = files.sort((a, b) => norm(b).includes(key) - norm(a).includes(key)).slice(0, 20);
    const ip = ((await json(api('prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=1200&titles=' + enc(ordered.join('|'))))).query || {}).pages || {};
    const urls = {};
    for (const p of Object.values(ip)) { const i = (p.imageinfo || [])[0]; if (i) urls[p.title] = i.thumburl || i.url; }
    const best = ordered.map((t) => urls[t]).find(Boolean);
    return best ? { url: best, page: wikiPage(page.title), credit: WIKI_CREDIT } : null;
  }

  /** A Commons photo, only when its file name has the model in it and says bus or Auckland. */
  async function commons(q, key) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=15' +
      '&gsrsearch=' + enc(q + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=1200';
    const pages = Object.values(((await json(url)).query || {}).pages || {});
    const best = pages
      .filter((p) => { const i = (p.imageinfo || [])[0]; return i && (i.mime === 'image/jpeg' || i.mime === 'image/png'); })
      .filter((p) => norm(p.title).includes(key) && !OFF_TOPIC.test(p.title) &&
        /bus|auckland|nz|metro|link|kinetic|ritchies|go ?bus|tranzurban|howick/i.test(p.title))
      .sort((a, b) => (a.index || 99) - (b.index || 99))[0];
    if (!best) return null;
    const info = best.imageinfo[0], meta = info.extmetadata || {};
    const field = (k) => ((meta[k] && meta[k].value) || '').replace(/<[^>]+>/g, '').trim();
    const credit = [field('Artist').slice(0, 60), field('LicenseShortName')].filter(Boolean).join(', ');
    return { url: info.thumburl || info.url, page: info.descriptionurl, credit: 'Photo: ' + (credit ? credit + ', Wikimedia Commons' : 'Wikimedia Commons') };
  }

  /** Its own page on the wiki; a page the wiki's search turns up for it; then Commons, only if the file is plainly this model. */
  async function find(m) {
    const key = norm(m.key || m.short.split(' ')[0]);
    const titles = m.wiki && m.wiki.length ? m.wiki : [m.name];
    const lead = await leadPhoto(titles);
    if (lead) return lead;
    const search = (((await json(api('list=search&srnamespace=0&srlimit=8&srsearch=' + enc(m.name)))).query || {}).search || [])
      .map((r) => r.title).filter((t) => norm(t).includes(key));
    if (search.length) { const p = await leadPhoto(search); if (p) return p; }
    for (const t of Array.from(new Set(titles.concat(search)))) { const p = await pagePhoto(t, key); if (p) return p; }
    for (const q of [m.name + ' Auckland', m.name, m.short + ' bus']) { const p = await commons(q, key); if (p) return p; }
    return null;
  }

  function remember(id, p) {
    saved['v' + VERSION + ':' + id] = { t: Date.now(), url: p ? p.url : '', page: p ? p.page : '', credit: p ? p.credit : '' };
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { /* full: it's only a cache */ }
  }

  A.photos = {
    /** What's known already, without asking: a photo, null (none), or undefined (not looked up yet). */
    known(m) {
      if (!m) return null;
      if (mem.has(m.id)) return mem.get(m.id);
      const s = saved['v' + VERSION + ':' + m.id];
      if (s && Date.now() - s.t < (s.url ? KEEP_MS : MISS_MS)) {
        const p = s.url ? { url: s.url, page: s.page, credit: s.credit } : null;
        mem.set(m.id, p);
        return p;
      }
      return undefined;
    },
    /** A model's photo, looked up once and remembered. Offline: null, and tried again next time. */
    forModel(m) {
      const k = this.known(m);
      if (k !== undefined) return Promise.resolve(k);
      if (pending.has(m.id)) return pending.get(m.id);
      const job = find(m).then((p) => { mem.set(m.id, p); remember(m.id, p); return p; })
        .catch(() => null).finally(() => pending.delete(m.id));
      pending.set(m.id, job);
      return job;
    },
  };

  // photos that wouldn't load this session: don't keep asking (the drawing stays)
  const failed = new Set();

  /** A model's picture as HTML: its photo if we have it already, else a canvas to draw (and swap for the photo). */
  A.picHtml = function (m, cls) {
    let p = m && A.photos.known(m);
    if (p && failed.has(p.url)) p = null;
    return p ? `<img class="${cls} photo" src="${A.esc(p.url)}" alt="${A.esc(m.name)}" title="${A.esc(p.credit)}" referrerpolicy="no-referrer" decoding="async">`
      : `<canvas class="${cls}" data-portrait="${m ? m.id : ''}"></canvas>`;
  };
  /** The credit line that goes over a big photo (filled in when the photo arrives). */
  A.creditHtml = function (m) {
    let p = m && A.photos.known(m);
    if (p && failed.has(p.url)) p = null;
    return `<span class="pic-credit"${p ? '' : ' hidden'}>${p ? A.esc(p.credit) : ''}</span>`;
  };
  /** Looks up every model's photo in the background and warms the image cache, so they show straight away. */
  A.photos.prefetch = async function () {
    for (const m of A.fleet.models) {
      const p = await A.photos.forModel(m);
      if (p) { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.onerror = () => failed.add(p.url); i.src = p.url; }
    }
  };

  /**
   * Puts the model's photo in place of a drawn portrait canvas once it has
   * loaded (the drawing stays if there's no photo, or it won't load). A
   * `.pic-credit` next to it gets the credit, linked to where it's from.
   */
  A.photoFor = function (canvas) {
    const m = A.fleet.model(canvas.dataset.portrait);
    if (!m || canvas.dataset.photo || canvas.dataset.nophoto) return;       // the dex keeps unspotted ones a mystery
    canvas.dataset.photo = 'asked';
    A.photos.forModel(m).then((p) => {
      if (!p || !canvas.isConnected || failed.has(p.url)) return;
      const img = new Image();
      img.onerror = () => failed.add(p.url);
      img.className = canvas.className + ' photo';
      img.alt = m.name;
      img.title = p.credit;
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        if (!canvas.isConnected) return;
        canvas.replaceWith(img);
        const credit = img.parentElement && img.parentElement.querySelector('.pic-credit');
        if (credit) { credit.textContent = p.credit; credit.dataset.href = p.page || ''; credit.hidden = false; }
        const blur = img.parentElement && img.parentElement.querySelector('.pic-blur');
        if (blur) blur.style.backgroundImage = `url("${p.url.replace(/"/g, '%22')}")`;
      };
      img.src = p.url;
    });
  };
})(window.AKL);
