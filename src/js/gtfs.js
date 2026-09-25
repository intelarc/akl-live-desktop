// The timetable engine's front door: starts the worker, feeds it AT's gtfs.zip
// (fetched by the desktop app, cached for the day), and asks it things.
(function (A) {
  'use strict';
  const S = A.gtfsState = { ready: false, loading: false, text: 'Waiting…', pct: 0, error: null, stats: null, date: null, dayStart: 0 };
  let worker = null, seq = 0, readyWaiters = [];
  const waiting = new Map();

  function send(type, data, transfer) {
    return new Promise((res, rej) => {
      const id = ++seq;
      waiting.set(id, { res, rej });
      worker.postMessage(Object.assign({ type, id }, data || {}), transfer || []);
    });
  }
  const emit = () => A.emit('gtfs', S);

  /** Where the zip comes from: the desktop app (no CORS there), or the dev server's proxy. */
  const source = {
    async etag() {
      if (A.desktop && A.desktop.gtfsInfo) return (await A.desktop.gtfsInfo()).etag;
      const r = await fetch('/__gtfs.etag', { cache: 'no-store' });
      if (!r.ok) throw new Error('No timetable source');
      return (await r.text()).trim();
    },
    async zip() {
      if (A.desktop && A.desktop.gtfsZip) return A.desktop.gtfsZip();
      const r = await fetch('/__gtfs.zip', { cache: 'no-store' });
      if (!r.ok) throw new Error('Couldn\'t download the timetable');
      return r.arrayBuffer();
    },
  };

  const days = () => [A.time.date().replace(/-/g, ''), A.time.date(null, 1).replace(/-/g, '')];
  /** Make sure a day's network is compiled (from the cache if we can). */
  async function ensure(ymd, primary) {
    const etag = await source.etag();
    let r = await send('open', { etag, date: ymd, keep: days(), primary });
    if (!r.ok) {
      if (primary) { S.text = 'Downloading AT\'s timetable…'; S.pct = 4; emit(); }
      const zip = await source.zip();
      r = await send('compile', { etag, date: ymd, zip, keep: days(), primary }, [zip]);
    }
    return r;
  }
  const pending = {};
  function day(ymd) { return pending[ymd] || (pending[ymd] = ensure(ymd, false).catch((e) => { delete pending[ymd]; throw e; })); }

  async function load() {
    S.loading = true; S.error = null; S.text = 'Loading the timetable…'; S.pct = 2; emit();
    const date = A.time.date();
    const ymd = date.replace(/-/g, '');
    try {
      const r = await ensure(ymd, true);
      Object.keys(pending).forEach((k) => delete pending[k]);
      S.ready = true; S.stats = r.stats; S.date = date; S.dayStart = A.time.serviceEpoch(date, '00:00:00');
      S.text = 'Ready'; S.pct = 100;
      readyWaiters.splice(0).forEach((f) => f());
    } catch (e) {
      S.error = e.message; S.text = e.message;
      setTimeout(load, 60000);
    } finally {
      S.loading = false; emit();
    }
  }

  // a new service day starts at 3 am: recompile then
  function scheduleRollover() {
    const p = A.time.parts(Date.now());
    let wait = ((27 - p.h) % 24) * 3600 - p.mi * 60 - p.s;
    if (wait <= 60) wait += 86400;
    setTimeout(() => { S.ready = false; load(); scheduleRollover(); }, wait * 1000);
  }

  const need = () => (S.ready ? Promise.resolve() : new Promise((res) => readyWaiters.push(res)));
  A.gtfs = {
    start() {
      if (worker) return;
      worker = new Worker('js/gtfs-worker.js');
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') { S.text = m.text; S.pct = m.pct; emit(); return; }
        if (m.type !== 'result') return;
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (w) (m.error ? w.rej(new Error(m.error)) : w.res(m.result));
      };
      worker.onerror = (e) => { S.error = e.message || 'The timetable engine stopped'; emit(); };
      load();
      scheduleRollover();
    },
    ready: need,
    /** from/to: { lat, lon, name }; time: epoch seconds (today or tomorrow); opts: see plan view */
    async plan(from, to, time, opts, arriveBy) {
      await need();
      const date = A.time.date(time * 1000);
      const ymd = date.replace(/-/g, '');
      if (ymd !== S.date.replace(/-/g, '')) await day(ymd);
      return send('plan', { from, to, time, arriveBy: !!arriveBy, opts: opts || {}, dayStart: A.time.serviceEpoch(date, '00:00:00'), date: ymd, count: 6 });
    },
    async searchStops(q, limit) { await need(); return send('searchStops', { q, limit }); },
    async nearby(lat, lon, radius, limit) { await need(); return send('nearby', { lat, lon, radius, limit }); },
    async stop(id) { await need(); return send('stop', { stopId: id }); },
    async allStops() { await need(); return send('allStops'); },
    async route(short) { await need(); return send('route', { short }); },
    async trip(tripId) { await need(); return send('trip', { tripId }); },
    async routes() { await need(); return send('routesList'); },
    async railTrack(segs) { await need(); return send('railTrack', { segs }); },
  };
})(window.AKL);
