// AT's whole timetable (gtfs.zip), compiled for one service day, and a RAPTOR
// journey planner over it. Runs in a Web Worker; the compiled day is cached in
// IndexedDB so only the first launch each day does the heavy lifting.
'use strict';

const INF = 0x3fffffff;
const DB = 'akl-gtfs', STORE = 'days', VERSION = 4;     // bump VERSION when the compiled format changes
let N = null;                                           // today's compiled network (lookups use it)
const DAYS = new Map();                                 // date -> compiled network (today and tomorrow)

const post = (m, t) => self.postMessage(m, t || []);
const progress = (text, pct) => post({ type: 'progress', text, pct });

self.onmessage = async (e) => {
  const m = e.data;
  try {
    let result;
    switch (m.type) {
      case 'open': result = await openDay(m); break;
      case 'compile': result = await compileDay(m); break;
      case 'plan': result = plan(m); break;
      case 'searchStops': result = searchStops(m.q, m.limit || 12); break;
      case 'nearby': result = nearby(m.lat, m.lon, m.radius || 600, m.limit || 12); break;
      case 'stop': result = stopInfo(m.stopId); break;
      case 'allStops': result = allStops(); break;
      case 'route': result = routeInfo(m.short); break;
      case 'trip': result = tripInfo(m.tripId); break;
      case 'routesList': result = routesList(); break;
      default: throw new Error('unknown request ' + m.type);
    }
    post({ type: 'result', id: m.id, result });
  } catch (err) {
    post({ type: 'result', id: m.id, error: String((err && err.message) || err) });
  }
};

// ======================= cache =======================
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res) => {
    const q = db.transaction(STORE).objectStore(STORE).get(key);
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => res(null);
  });
}
async function idbPutOnly(key, value, keep) {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const keys = st.getAllKeys();                 // keep only the days still wanted
    keys.onsuccess = () => { for (const k of keys.result) if (!keep.some((d) => String(k).endsWith('|' + d))) st.delete(k); };
    st.put(value, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => res(false);
  });
}

/** Use today's compiled network from the cache if it's there. */
async function openDay(m) {
  const key = `${VERSION}|${m.etag}|${m.date}`;
  const have = DAYS.get(m.date);
  if (have && have.key === key) { if (m.primary) N = have; return { ok: true, stats: stats(have) }; }
  const cached = await idbGet(key).catch(() => null);
  if (!cached) return { ok: false };
  cached.nameLower = cached.stopName.map((s) => s.toLowerCase());
  keepDay(m.date, cached, m.keep);
  if (m.primary) N = cached;
  return { ok: true, stats: stats(cached) };
}
function keepDay(date, net, keep) {
  DAYS.set(date, net);
  for (const d of Array.from(DAYS.keys())) if (keep && !keep.includes(d)) DAYS.delete(d);
}
function stats(n) {
  n = n || N;
  return { date: n.date, stops: n.nStops, trips: n.tripId.length, patterns: n.patRoute.length, routes: n.routeShort.length };
}

// ======================= reading the zip =======================
function zipEntries(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('gtfs.zip is damaged');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    out[name] = { method, comp, size, local };
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
async function unzip(buf, entries, name) {
  const e = entries[name];
  if (!e) return null;
  const dv = new DataView(buf);
  const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
  const raw = new Uint8Array(buf, start, e.comp);
  if (e.method === 0) return raw.slice();
  const ds = new DecompressionStream('deflate-raw');
  const out = new Uint8Array(e.size);
  const reader = new Blob([raw]).stream().pipeThrough(ds).getReader();
  let off = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, off);
    off += value.length;
  }
  return out;
}

// ======================= CSV, straight from bytes =======================
/** Calls row(fields) for each line; fields are [start, end) byte offsets into buf. */
function eachRow(buf, onHeader, onRow) {
  const n = buf.length;
  let i = 0;
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) i = 3;
  const f = new Int32Array(64);
  let header = true;
  while (i < n) {
    let k = 0, start = i, quoted = false;
    f[0] = i;
    while (i < n) {
      const c = buf[i];
      if (c === 34) { quoted = !quoted; i++; continue; }            // "
      if (!quoted && c === 44) { f[k * 2 + 1] = i; k++; f[k * 2] = i + 1; i++; continue; }
      if (!quoted && (c === 10 || c === 13)) break;
      i++;
    }
    f[k * 2 + 1] = i;
    const cols = k + 1;
    while (i < n && (buf[i] === 10 || buf[i] === 13)) i++;
    if (i === start) break;
    if (header) { onHeader(f, cols); header = false; } else onRow(f, cols);
  }
}
const utf8 = new TextDecoder();
function str(buf, a, b) {
  if (buf[a] === 34 && buf[b - 1] === 34) { a++; b--; }
  return b > a ? utf8.decode(buf.subarray(a, b)).replace(/""/g, '"') : '';
}
function ascii(buf, a, b) {
  let s = '';
  for (let i = a; i < b; i++) s += String.fromCharCode(buf[i]);
  return s;
}
function hms(buf, a, b) {
  if (b <= a) return -1;
  let h = 0, i = a;
  while (i < b && buf[i] !== 58) { h = h * 10 + buf[i] - 48; i++; }
  const m = (buf[i + 1] - 48) * 10 + buf[i + 2] - 48;
  const s = (buf[i + 4] - 48) * 10 + buf[i + 5] - 48;
  return h * 3600 + m * 60 + s;
}
function num(buf, a, b) {
  let v = 0;
  for (let i = a; i < b; i++) v = v * 10 + buf[i] - 48;
  return v;
}
function cols(buf, f, n) {
  const out = {};
  for (let k = 0; k < n; k++) out[ascii(buf, f[k * 2], f[k * 2 + 1]).trim()] = k;
  return out;
}
function table(buf, pick) {
  const rows = [];
  let c;
  eachRow(buf, (f, n) => { c = cols(buf, f, n); }, (f) => {
    const r = {};
    for (const name of pick) { const k = c[name]; r[name] = k == null ? '' : str(buf, f[k * 2], f[k * 2 + 1]); }
    rows.push(r);
  });
  return rows;
}

// ======================= compiling a day =======================
function activeServices(cal, dates, ymd) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d.getUTCDay()];
  const on = new Set();
  for (const r of cal) if (r.start_date <= ymd && ymd <= r.end_date && r[day] === '1') on.add(r.service_id);
  for (const r of dates) if (r.date === ymd) { if (r.exception_type === '1') on.add(r.service_id); else on.delete(r.service_id); }
  return on;
}
function prevDay(ymd) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) - 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
const toRad = Math.PI / 180;
function meters(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * toRad * Math.cos((lat1 + lat2) / 2 * toRad), y = (lat2 - lat1) * toRad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

async function compileDay(m) {
  const t0 = performance.now();
  const buf = m.zip;
  const ymd = m.date;
  const entries = zipEntries(buf);
  const read = async (name) => unzip(buf, entries, name);
  progress('Reading the timetable…', 5);

  const cal = table(await read('calendar.txt'), ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date']);
  const calDates = table((await read('calendar_dates.txt')) || new Uint8Array(0), ['service_id', 'date', 'exception_type']);
  const onToday = activeServices(cal, calDates, ymd);
  const onPrev = activeServices(cal, calDates, prevDay(ymd));

  // routes
  const routeRows = table(await read('routes.txt'), ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color']);
  const routeIdx = new Map();
  const routeId = [], routeShort = [], routeLong = [], routeType = [], routeAgency = [];
  for (const r of routeRows) {
    routeIdx.set(r.route_id, routeId.length);
    routeId.push(r.route_id); routeShort.push(r.route_short_name || r.route_id.split('-')[0]);
    routeLong.push(r.route_long_name); routeType.push(+r.route_type || 3); routeAgency.push(r.agency_id);
  }

  // stops
  progress('Reading stops…', 12);
  const stopRows = table(await read('stops.txt'), ['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'parent_station', 'platform_code']);
  const stopIdx = new Map();
  const nStops = stopRows.length;
  const stopId = [], stopCode = [], stopName = [], stopPlat = [];
  const stopLat = new Float64Array(nStops), stopLon = new Float64Array(nStops);
  const stopType = new Uint8Array(nStops), stopParent = new Int32Array(nStops).fill(-1);
  stopRows.forEach((r, i) => {
    stopIdx.set(r.stop_id, i);
    stopId.push(r.stop_id); stopCode.push(r.stop_code); stopName.push(r.stop_name); stopPlat.push(r.platform_code);
    stopLat[i] = +r.stop_lat; stopLon[i] = +r.stop_lon; stopType[i] = +r.location_type || 0;
  });
  stopRows.forEach((r, i) => { if (r.parent_station && stopIdx.has(r.parent_station)) stopParent[i] = stopIdx.get(r.parent_station); });

  // trips running today, and yesterday's that run past midnight
  progress('Reading trips…', 18);
  const tripRows = table(await read('trips.txt'), ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id']);
  const inst = new Map();          // trip_id -> [instances]; an instance is { i, off }
  const tripId = [], tripRoute = [], tripHead = [], tripDir = [], tripShape = [], tripOff = [];
  for (const r of tripRows) {
    const today = onToday.has(r.service_id), prev = onPrev.has(r.service_id);
    if (!today && !prev) continue;
    const list = [];
    for (const off of [today ? 0 : null, prev ? -86400 : null]) {
      if (off === null) continue;
      list.push({ i: tripId.length, off });
      tripId.push(r.trip_id); tripRoute.push(routeIdx.has(r.route_id) ? routeIdx.get(r.route_id) : 0);
      tripHead.push(r.trip_headsign); tripDir.push(+r.direction_id || 0); tripShape.push(r.shape_id); tripOff.push(off);
    }
    inst.set(r.trip_id, list);
  }

  // stop times, straight from bytes: the big one
  progress('Reading 1.1 million stop times…', 26);
  const st = await read('stop_times.txt');
  const events = new Map();        // instance -> { s: [], a: [], d: [], q: [], pu: [], do: [] }
  let c = null, curId = null, cur = null;
  const fields = { trip: 0, arr: 0, dep: 0, stop: 0, seq: 0, pu: -1, dof: -1 };
  let rowCount = 0;
  eachRow(st, (f, n) => {
    c = cols(st, f, n);
    fields.trip = c.trip_id; fields.arr = c.arrival_time; fields.dep = c.departure_time; fields.stop = c.stop_id;
    fields.seq = c.stop_sequence; fields.pu = c.pickup_type == null ? -1 : c.pickup_type; fields.dof = c.drop_off_type == null ? -1 : c.drop_off_type;
  }, (f) => {
    rowCount++;
    const ta = f[fields.trip * 2], tb = f[fields.trip * 2 + 1];
    // rows come grouped by trip: only decode the id when it changes
    let same = curId !== null && tb - ta === curId.length;
    if (same) for (let i = 0; i < curId.length; i++) if (st[ta + i] !== curId.charCodeAt(i)) { same = false; break; }
    if (!same) {
      curId = ascii(st, ta, tb);
      const list = inst.get(curId);
      cur = list ? list.map((x) => { const o = { x, s: [], a: [], d: [], q: [], pu: [], dof: [] }; events.set(x.i, o); return o; }) : null;
    }
    if (!cur) return;
    const s = stopIdx.get(ascii(st, f[fields.stop * 2], f[fields.stop * 2 + 1]));
    if (s == null) return;
    let a = hms(st, f[fields.arr * 2], f[fields.arr * 2 + 1]);
    let d = hms(st, f[fields.dep * 2], f[fields.dep * 2 + 1]);
    if (a < 0) a = d; if (d < 0) d = a;
    const q = num(st, f[fields.seq * 2], f[fields.seq * 2 + 1]);
    const pu = fields.pu >= 0 ? st[f[fields.pu * 2]] - 48 : 0;
    const dof = fields.dof >= 0 ? st[f[fields.dof * 2]] - 48 : 0;
    for (const o of cur) { o.s.push(s); o.a.push(a + o.x.off); o.d.push(d + o.x.off); o.q.push(q); o.pu.push(pu === 1 ? 1 : 0); o.dof.push(dof === 1 ? 1 : 0); }
  });

  // patterns: trips of one route with the same stops (and pickup rules) share one
  progress('Building the network…', 62);
  const patKey = new Map();
  const patTrips = [];
  for (const [ti, o] of events) {
    if (o.s.length < 2) continue;
    if (o.x.off < 0 && o.a[o.a.length - 1] < 0) continue;        // yesterday's run, over before midnight
    if (o.x.off === 0 && o.d[0] >= 86400 + 4 * 3600) continue;
    // a couple of trips list their stops out of order
    let sorted = true;
    for (let k = 1; k < o.q.length; k++) if (o.q[k] < o.q[k - 1]) { sorted = false; break; }
    if (!sorted) {
      const idx = o.q.map((_, k) => k).sort((x, y) => o.q[x] - o.q[y]);
      for (const key of ['s', 'a', 'd', 'q', 'pu', 'dof']) o[key] = idx.map((k) => o[key][k]);
    }
    const key = tripRoute[ti] + '|' + o.s.join(',') + '|' + o.pu.join('') + o.dof.join('');
    let p = patKey.get(key);
    if (p == null) { p = patTrips.length; patKey.set(key, p); patTrips.push([]); }
    patTrips[p].push(ti);
  }
  const nPat = patTrips.length;
  const patRoute = new Int32Array(nPat), patStart = new Int32Array(nPat + 1), patLen = new Int32Array(nPat);
  const patTripStart = new Int32Array(nPat + 1);
  let stopsTotal = 0, timesTotal = 0, tripsTotal = 0;
  for (let p = 0; p < nPat; p++) {
    const o = events.get(patTrips[p][0]);
    patLen[p] = o.s.length; stopsTotal += o.s.length; tripsTotal += patTrips[p].length; timesTotal += o.s.length * patTrips[p].length;
  }
  const patStops = new Int32Array(stopsTotal), patPick = new Uint8Array(stopsTotal), patDrop = new Uint8Array(stopsTotal);
  const patTrip = new Int32Array(tripsTotal), patTimeStart = new Int32Array(nPat + 1);
  const arr = new Int32Array(timesTotal), dep = new Int32Array(timesTotal);
  const tripSeq = [];
  let ps = 0, pt = 0, ptime = 0;
  for (let p = 0; p < nPat; p++) {
    const list = patTrips[p];
    const first = events.get(list[0]);
    list.sort((x, y) => events.get(x).d[0] - events.get(y).d[0]);
    patRoute[p] = tripRoute[list[0]];
    patStart[p] = ps; patTripStart[p] = pt; patTimeStart[p] = ptime;
    for (let k = 0; k < first.s.length; k++) { patStops[ps + k] = first.s[k]; patPick[ps + k] = first.pu[k] ? 0 : 1; patDrop[ps + k] = first.dof[k] ? 0 : 1; }
    ps += first.s.length;
    const L = first.s.length;
    for (const ti of list) {
      const o = events.get(ti);
      patTrip[pt++] = ti;
      for (let k = 0; k < L; k++) { arr[ptime + k] = o.a[k]; dep[ptime + k] = o.d[k]; }
      ptime += L;
      tripSeq[ti] = o.q;
    }
  }
  patStart[nPat] = ps; patTripStart[nPat] = pt; patTimeStart[nPat] = ptime;
  // trip -> (pattern, index in pattern), and the stop sequence numbers realtime uses
  const tripPat = new Int32Array(tripId.length).fill(-1), tripPos = new Int32Array(tripId.length).fill(-1);
  for (let p = 0; p < nPat; p++) for (let j = patTripStart[p]; j < patTripStart[p + 1]; j++) { tripPat[patTrip[j]] = p; tripPos[patTrip[j]] = j - patTripStart[p]; }
  const seqStart = new Int32Array(tripId.length + 1);
  let seqTotal = 0;
  for (let t = 0; t < tripId.length; t++) { seqStart[t] = seqTotal; seqTotal += tripSeq[t] ? tripSeq[t].length : 0; }
  seqStart[tripId.length] = seqTotal;
  const seqs = new Int32Array(seqTotal);
  for (let t = 0; t < tripId.length; t++) if (tripSeq[t]) seqs.set(tripSeq[t], seqStart[t]);

  // stop -> patterns through it
  progress('Linking stops…', 74);
  const cnt = new Int32Array(nStops);
  for (let i = 0; i < stopsTotal; i++) cnt[patStops[i]]++;
  const spStart = new Int32Array(nStops + 1);
  for (let s = 0; s < nStops; s++) spStart[s + 1] = spStart[s] + cnt[s];
  const spPat = new Int32Array(stopsTotal), spPos = new Int32Array(stopsTotal);
  const fill = spStart.slice(0, nStops);
  for (let p = 0; p < nPat; p++) for (let k = 0; k < patLen[p]; k++) {
    const s = patStops[patStart[p] + k];
    spPat[fill[s]] = p; spPos[fill[s]] = k; fill[s]++;
  }
  // which modes stop where (1 bus, 2 train, 4 ferry)
  const stopModes = new Uint8Array(nStops);
  const bit = (t) => (t === 2 ? 2 : t === 4 ? 4 : 1);
  for (let p = 0; p < nPat; p++) for (let k = 0; k < patLen[p]; k++) stopModes[patStops[patStart[p] + k]] |= bit(routeType[patRoute[p]]);

  // walking between nearby stops (up to 450 m), found with a grid
  progress('Working out transfers…', 80);
  const cell = 0.005, grid = new Map();
  const gkey = (la, lo) => Math.floor(la / cell) * 100000 + Math.floor(lo / cell);
  for (let s = 0; s < nStops; s++) if (stopType[s] === 0 && spStart[s + 1] > spStart[s]) {
    const k = gkey(stopLat[s], stopLon[s]);
    let g = grid.get(k); if (!g) grid.set(k, g = []); g.push(s);
  }
  const fpS = [], fpD = [];
  const fpStart = new Int32Array(nStops + 1);
  for (let s = 0; s < nStops; s++) {
    fpStart[s] = fpS.length;
    if (stopType[s] !== 0 || spStart[s + 1] === spStart[s]) continue;
    const gy = Math.floor(stopLat[s] / cell), gx = Math.floor(stopLon[s] / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const g = grid.get((gy + dy) * 100000 + gx + dx);
      if (!g) continue;
      for (const t of g) {
        if (t === s) continue;
        const d = meters(stopLat[s], stopLon[s], stopLat[t], stopLon[t]);
        if (d <= 450) { fpS.push(t); fpD.push(Math.round(d)); }
      }
    }
  }
  fpStart[nStops] = fpS.length;

  // shapes, for drawing rides on the map (only the ones running today)
  progress('Reading route shapes…', 86);
  const want = new Map();
  tripShape.forEach((sid) => { if (sid && !want.has(sid)) want.set(sid, want.size); });
  const shapeBuf = await read('shapes.txt');
  const pts = Array.from({ length: want.size }, () => []);
  let sc = null, lastSid = null, lastIdx = -1;
  eachRow(shapeBuf, (f, n) => { sc = cols(shapeBuf, f, n); }, (f) => {
    const sid = ascii(shapeBuf, f[sc.shape_id * 2], f[sc.shape_id * 2 + 1]);
    if (sid !== lastSid) { lastSid = sid; lastIdx = want.has(sid) ? want.get(sid) : -1; }
    if (lastIdx < 0) return;
    pts[lastIdx].push(+ascii(shapeBuf, f[sc.shape_pt_sequence * 2], f[sc.shape_pt_sequence * 2 + 1]),
                      +ascii(shapeBuf, f[sc.shape_pt_lon * 2], f[sc.shape_pt_lon * 2 + 1]),
                      +ascii(shapeBuf, f[sc.shape_pt_lat * 2], f[sc.shape_pt_lat * 2 + 1]));
  });
  let shapeTotal = 0;
  for (const p of pts) shapeTotal += p.length / 3;
  const shapeStart = new Int32Array(want.size + 1), shapeXY = new Float32Array(shapeTotal * 2);
  let so = 0;
  pts.forEach((p, i) => {
    shapeStart[i] = so;
    const idx = [];
    for (let k = 0; k < p.length; k += 3) idx.push(k);
    idx.sort((x, y) => p[x] - p[y]);
    for (const k of idx) { shapeXY[so * 2] = p[k + 1]; shapeXY[so * 2 + 1] = p[k + 2]; so++; }
  });
  shapeStart[want.size] = so;
  const tripShapeIdx = new Int32Array(tripId.length).map((_, t) => (want.has(tripShape[t]) ? want.get(tripShape[t]) : -1));

  const net = {
    key: `${VERSION}|${m.etag}|${ymd}`, date: ymd, nStops,
    routeId, routeShort, routeLong, routeType, routeAgency,
    stopId, stopCode, stopName, stopPlat, stopLat, stopLon, stopType, stopParent, stopModes,
    tripId, tripRoute: Int32Array.from(tripRoute), tripHead, tripDir: Int8Array.from(tripDir), tripOff: Int32Array.from(tripOff),
    tripPat, tripPos, tripShapeIdx, seqStart, seqs,
    patRoute, patStart, patLen, patStops, patPick, patDrop, patTripStart, patTrip, patTimeStart, arr, dep,
    spStart, spPat, spPos, fpStart, fpTo: Int32Array.from(fpS), fpDist: Int32Array.from(fpD),
    shapeStart, shapeXY,
  };
  progress('Saving for next time…', 95);
  await idbPutOnly(net.key, net, m.keep || [ymd]).catch(() => {});
  net.nameLower = net.stopName.map((s) => s.toLowerCase());
  keepDay(ymd, net, m.keep);
  if (m.primary || !N) N = net;
  progress('Ready', 100);
  return { ok: true, stats: stats(net), ms: Math.round(performance.now() - t0), rows: rowCount };
}

// ======================= RAPTOR =======================
/** Stops within walking distance of a point, with how far. */
function around(lat, lon, radius) {
  const out = [];
  const dLat = radius / 111000, dLon = radius / (111000 * Math.cos(lat * toRad));
  for (let s = 0; s < N.nStops; s++) {
    if (N.stopType[s] !== 0 || N.spStart[s + 1] === N.spStart[s]) continue;
    const la = N.stopLat[s], lo = N.stopLon[s];
    if (Math.abs(la - lat) > dLat || Math.abs(lo - lon) > dLon) continue;
    const d = meters(lat, lon, la, lo);
    if (d <= radius) out.push([s, d]);
  }
  return out.sort((a, b) => a[1] - b[1]);
}

function tripAt(p, j) { return N.patTrip[N.patTripStart[p] + j]; }
function depAt(p, j, k) { return N.dep[N.patTimeStart[p] + j * N.patLen[p] + k]; }
function arrAt(p, j, k) { return N.arr[N.patTimeStart[p] + j * N.patLen[p] + k]; }

/**
 * One RAPTOR run: the best arrival at the destination with 1, 2, 3... rides,
 * leaving the origin no earlier than t0 (seconds after the service day's midnight).
 */
function raptor(access, egress, t0, o) {
  const n = N.nStops, K = o.maxRides;
  const secPerM = o.secPerM;
  const tau = [], pType = [], pA = [], pB = [], pC = [], pD = [];
  for (let k = 0; k <= K; k++) {
    tau.push(new Int32Array(n).fill(INF));
    pType.push(new Int8Array(n)); pA.push(new Int32Array(n)); pB.push(new Int32Array(n)); pC.push(new Int32Array(n)); pD.push(new Int32Array(n));
  }
  const best = new Int32Array(n).fill(INF);
  const egressAt = new Int32Array(n).fill(-1);
  for (const [s, d] of egress) egressAt[s] = Math.round(d * secPerM);
  let marked = new Set();
  for (const [s, d] of access) {
    const t = t0 + Math.round(d * secPerM);
    if (t < tau[0][s]) { tau[0][s] = t; best[s] = t; pType[0][s] = 1; pD[0][s] = Math.round(d); marked.add(s); }
  }
  let target = INF;
  const results = [];
  const modeOk = (p) => {
    const t = N.routeType[N.patRoute[p]];
    return (t === 2 ? o.train : t === 4 ? o.ferry : o.bus);
  };
  for (let k = 1; k <= K && marked.size; k++) {
    const Q = new Map();
    for (const s of marked) {
      for (let i = N.spStart[s]; i < N.spStart[s + 1]; i++) {
        const p = N.spPat[i], pos = N.spPos[i];
        if (!modeOk(p)) continue;
        const q = Q.get(p);
        if (q === undefined || pos < q) Q.set(p, pos);
      }
    }
    const next = new Set();
    const slack = k === 1 ? 0 : o.change;
    for (const [p, startPos] of Q) {
      const L = N.patLen[p], nT = N.patTripStart[p + 1] - N.patTripStart[p], base = N.patStart[p];
      let j = -1, boardPos = -1, boardStop = -1;
      for (let pos = startPos; pos < L; pos++) {
        const s = N.patStops[base + pos];
        if (j >= 0 && N.patDrop[base + pos]) {
          const a = arrAt(p, j, pos);
          if (a < best[s] && a < target) {
            tau[k][s] = a; best[s] = a;
            pType[k][s] = 2; pA[k][s] = p; pB[k][s] = j; pC[k][s] = boardPos; pD[k][s] = pos;
            next.add(s);
          }
        }
        const ready = tau[k - 1][s];
        if (ready < INF && N.patPick[base + pos] && pType[k - 1][s] !== 0) {
          const r = ready + slack;
          if (j < 0 || r <= depAt(p, j, pos)) {
            // earliest trip leaving here at r or later (trips are in departure order)
            let lo = 0, hi = j < 0 ? nT : j;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (depAt(p, mid, pos) >= r) hi = mid; else lo = mid + 1; }
            if (lo < (j < 0 ? nT : j)) { j = lo; boardPos = pos; boardStop = s; }
          }
        }
      }
    }
    // walk between nearby stops after riding
    const rode = Array.from(next);
    for (const s of rode) {
      const ts = tau[k][s];
      for (let i = N.fpStart[s]; i < N.fpStart[s + 1]; i++) {
        const t = N.fpTo[i], d = N.fpDist[i];
        const a = ts + Math.round(d * secPerM) + 30;
        if (a < best[t] && a < target) {
          tau[k][t] = a; best[t] = a;
          pType[k][t] = 3; pA[k][t] = s; pD[k][t] = d;
          next.add(t);
        }
      }
    }
    // how's the destination looking with k rides?
    let bestK = INF, bestE = -1;
    for (const [e] of egress) {
      if (tau[k][e] < INF) {
        const a = tau[k][e] + egressAt[e];
        if (a < bestK) { bestK = a; bestE = e; }
      }
    }
    if (bestK < target) { target = bestK; results.push({ k, e: bestE, arrive: bestK }); }
    marked = next;
  }
  return results.map((r) => build(r, tau, pType, pA, pB, pC, pD, egressAt, secPerM));
}

/** Follows the parent pointers back from the destination into legs. */
function build(r, tau, pType, pA, pB, pC, pD, egressAt, secPerM) {
  const legs = [];
  let s = r.e, k = r.k;
  legs.push({ mode: 'walk', fromStop: s, toStop: -1, start: tau[k][s], end: r.arrive });
  for (let guard = 0; guard < 40; guard++) {
    const t = pType[k][s];
    if (t === 2) {
      const p = pA[k][s], j = pB[k][s], bp = pC[k][s], ap = pD[k][s];
      const from = N.patStops[N.patStart[p] + bp];
      legs.unshift({ mode: 'ride', p, j, bp, ap, fromStop: from, toStop: s, start: depAt(p, j, bp), end: arrAt(p, j, ap) });
      s = from; k -= 1;
    } else if (t === 3) {
      const from = pA[k][s];
      legs.unshift({ mode: 'walk', fromStop: from, toStop: s, dist: pD[k][s], start: tau[k][from], end: tau[k][s] });
      s = from;
    } else if (t === 1) {
      legs.unshift({ mode: 'walk', fromStop: -1, toStop: s, dist: pD[k][s], start: tau[k][s] - Math.round(pD[k][s] * secPerM), end: tau[k][s] });
      break;
    } else break;
  }
  return { rides: r.k, arrive: r.arrive, legs };
}

/** When you'd actually have to leave: the first ride, less the walk to it. */
function leaveAt(it) {
  const i = it.legs.findIndex((l) => l.mode === 'ride');
  if (i < 0) return it.legs[0].start;
  const w = i > 0 ? it.legs[0].end - it.legs[0].start : 0;
  return it.legs[i].start - w;
}

function plan(m) {
  const today = N;
  N = (m.date && DAYS.get(m.date)) || N;
  try { return planOn(m); } finally { N = today; }
}
function planOn(m) {
  if (!N) throw new Error('The timetable is still loading');
  const o = {
    maxRides: m.opts.maxRides || 4, change: m.opts.change || 90,
    secPerM: 1.28 / (m.opts.walkSpeed || 1.3),             // 1.28: streets aren't straight lines
    bus: m.opts.bus !== false, train: m.opts.train !== false, ferry: m.opts.ferry !== false,
  };
  const maxWalk = m.opts.maxWalk || 900;
  const from = m.from, to = m.to;
  const access = around(from.lat, from.lon, maxWalk).slice(0, 60);
  const egress = around(to.lat, to.lon, maxWalk).slice(0, 60);
  const direct = meters(from.lat, from.lon, to.lat, to.lon);
  const day = m.dayStart;
  const found = [];
  const seen = new Set();
  const addAll = (list) => {
    for (const it of list) {
      const rides = it.legs.filter((l) => l.mode === 'ride');
      if (!rides.length) continue;
      const key = rides.map((l) => N.tripId[tripAt(l.p, l.j)] + '@' + l.bp + '-' + l.ap).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(it);
    }
  };
  if (!access.length || !egress.length) {
    return { itineraries: [], direct: Math.round(direct), note: !access.length ? 'No stops within walking distance of the start' : 'No stops within walking distance of the end' };
  }
  if (m.arriveBy) {
    // try leaving at steps back from the deadline; keep whatever still arrives in time
    const deadline = m.time - day;
    for (let back = 10 * 60; back <= 180 * 60 && found.length < 14; back += back < 60 * 60 ? 4 * 60 : 10 * 60) {
      addAll(raptor(access, egress, deadline - back, o).filter((r) => r.arrive <= deadline));
    }
    found.sort((a, b) => leaveAt(b) - leaveAt(a) || a.arrive - b.arrive);
  } else {
    let t = m.time - day;
    for (let i = 0; i < 8 && found.length < (m.count || 6); i++) {
      const res = raptor(access, egress, t, o);
      if (!res.length) break;
      addAll(res);
      const firstRide = res[0].legs.find((l) => l.mode === 'ride');
      if (!firstRide) break;
      t = firstRide.start - (res[0].legs[0].end - res[0].legs[0].start) + 60;
    }
    found.sort((a, b) => a.arrive - b.arrive || leaveAt(b) - leaveAt(a));
  }
  // drop options that are worse in every way than another one
  const kept = found.filter((a) => !found.some((b) => b !== a && b.arrive <= a.arrive && leaveAt(b) >= leaveAt(a) &&
    b.rides <= a.rides && (b.arrive < a.arrive || leaveAt(b) > leaveAt(a) || b.rides < a.rides)));
  return {
    itineraries: kept.slice(0, m.count || 6).map((it) => describe(it, from, to, day)),
    direct: Math.round(direct), walkOnly: direct <= 1500 ? Math.round(direct * o.secPerM) : null,
  };
}

function stopJson(s) {
  return { idx: s, id: N.stopId[s], code: N.stopCode[s], name: N.stopName[s], lat: N.stopLat[s], lon: N.stopLon[s],
           platform: N.stopPlat[s] || '', parent: N.stopParent[s] >= 0 ? N.stopName[N.stopParent[s]] : '' };
}

/** A found journey, in plain terms, with times as epoch seconds. */
function describe(it, from, to, day) {
  const legs = it.legs.map((l) => {
    if (l.mode === 'walk') {
      const a = l.fromStop >= 0 ? stopJson(l.fromStop) : { name: from.name || 'Start', lat: from.lat, lon: from.lon };
      const b = l.toStop >= 0 ? stopJson(l.toStop) : { name: to.name || 'Destination', lat: to.lat, lon: to.lon };
      return { mode: 'walk', from: a, to: b, start: day + l.start, end: day + l.end,
               dist: Math.round(l.dist != null ? l.dist : meters(a.lat, a.lon, b.lat, b.lon)) };
    }
    const ti = tripAt(l.p, l.j), r = N.patRoute[l.p], type = N.routeType[r];
    const stops = [];
    for (let k = l.bp; k <= l.ap; k++) {
      const s = N.patStops[N.patStart[l.p] + k];
      stops.push(Object.assign(stopJson(s), { arr: day + arrAt(l.p, l.j, k), dep: day + depAt(l.p, l.j, k),
                                              seq: N.seqs[N.seqStart[ti] + k] }));
    }
    return {
      mode: type === 2 ? 'train' : type === 4 ? 'ferry' : 'bus',
      route: { id: N.routeId[r], short: N.routeShort[r], long: N.routeLong[r], type, agency: N.routeAgency[r] },
      tripId: N.tripId[ti], headsign: N.tripHead[ti], serviceDay: day + N.tripOff[ti],
      from: stops[0], to: stops[stops.length - 1], stops,
      start: day + l.start, end: day + l.end, shape: cutShape(ti, stops),
    };
  });
  for (let i = legs.length - 1; i > 0; i--) {
    if (legs[i].mode === 'walk' && legs[i - 1].mode === 'walk') {
      const a = legs[i - 1], b = legs[i];
      legs.splice(i - 1, 2, { mode: 'walk', from: a.from, to: b.to, start: a.start, end: b.end, dist: a.dist + b.dist });
    }
  }
  // the first walk starts when it has to for the first ride
  const first = legs[0], second = legs[1];
  if (first.mode === 'walk' && second) { const dur = first.end - first.start; first.end = second.start; first.start = second.start - dur; }
  const rides = legs.filter((l) => l.mode !== 'walk');
  return {
    start: legs[0].start, end: legs[legs.length - 1].end,
    walk: legs.filter((l) => l.mode === 'walk').reduce((a, l) => a + l.dist, 0),
    transfers: Math.max(0, rides.length - 1), legs,
  };
}

/** The trip's shape between two of its stops, as [[lon, lat], ...]. */
function cutShape(ti, stops) {
  const si = N.tripShapeIdx[ti];
  const line = stops.map((s) => [s.lon, s.lat]);
  if (si < 0) return line;
  const a0 = N.shapeStart[si], a1 = N.shapeStart[si + 1];
  const nearest = (lat, lon, from) => {
    let best = from, bd = Infinity;
    for (let i = from; i < a1; i++) {
      const dx = (N.shapeXY[i * 2] - lon) * Math.cos(lat * toRad), dy = N.shapeXY[i * 2 + 1] - lat;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
      if (bd < 1e-9) break;
    }
    return best;
  };
  const i0 = nearest(stops[0].lat, stops[0].lon, a0);
  const i1 = nearest(stops[stops.length - 1].lat, stops[stops.length - 1].lon, i0);
  if (i1 <= i0) return line;
  const out = [];
  for (let i = i0; i <= i1; i++) out.push([+N.shapeXY[i * 2].toFixed(6), +N.shapeXY[i * 2 + 1].toFixed(6)]);
  return out;
}

// ======================= lookups for the screens =======================
function routesAt(s) {
  const seen = new Map();
  for (let i = N.spStart[s]; i < N.spStart[s + 1]; i++) {
    const r = N.patRoute[N.spPat[i]];
    const short = N.routeShort[r];
    if (!seen.has(short)) seen.set(short, { short, type: N.routeType[r], trips: 0 });
    seen.get(short).trips += N.patTripStart[N.spPat[i] + 1] - N.patTripStart[N.spPat[i]];
  }
  return Array.from(seen.values()).sort((a, b) => a.short.localeCompare(b.short, undefined, { numeric: true }));
}

function searchStops(q, limit) {
  if (!N) return [];
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const words = s.split(/\s+/);
  const out = [];
  for (let i = 0; i < N.nStops; i++) {
    const served = N.spStart[i + 1] > N.spStart[i];
    if (N.stopType[i] === 0 && !served) continue;
    if (N.stopType[i] === 1 && !N.nameLower[i]) continue;
    let score = 0;
    if (N.stopCode[i] === s) score = 100;
    else if (N.stopCode[i].startsWith(s) && /^\d+$/.test(s)) score = 60;
    else if (words.every((w) => N.nameLower[i].includes(w))) {
      score = 30 + (N.nameLower[i].startsWith(words[0]) ? 20 : 0) + (N.stopType[i] === 1 ? 15 : 0) + Math.min(10, (N.spStart[i + 1] - N.spStart[i]));
    }
    if (score) out.push([score, i]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, limit).map(([, i]) => Object.assign(stopJson(i), { station: N.stopType[i] === 1, modes: modesOf(i), routes: routesAt(i).map((r) => r.short).slice(0, 12) }));
}
function modesOf(i) {
  if (N.stopType[i] !== 1) return N.stopModes[i];
  let m = 0;
  for (let s = 0; s < N.nStops; s++) if (N.stopParent[s] === i) m |= N.stopModes[s];
  return m;
}

function nearby(lat, lon, radius, limit) {
  if (!N) return [];
  return around(lat, lon, radius).slice(0, limit).map(([s, d]) =>
    Object.assign(stopJson(s), { dist: Math.round(d), modes: N.stopModes[s], routes: routesAt(s).map((r) => r.short) }));
}

function stopInfo(id) {
  if (!N) return null;
  let s = N.stopId.indexOf(id);
  if (s < 0) s = N.stopCode.indexOf(id);
  if (s < 0) return null;
  const kids = [];
  for (let i = 0; i < N.nStops; i++) if (N.stopParent[i] === s) kids.push(Object.assign(stopJson(i), { routes: routesAt(i) }));
  return Object.assign(stopJson(s), { station: N.stopType[s] === 1, modes: modesOf(s), routes: routesAt(s), platforms: kids });
}

/** Every stop that has a service, for the map layer. */
function allStops() {
  if (!N) return null;
  const list = [];
  for (let i = 0; i < N.nStops; i++) {
    if (N.stopType[i] === 0 && N.spStart[i + 1] === N.spStart[i]) continue;
    list.push([N.stopId[i], N.stopCode[i], N.stopName[i], +N.stopLat[i].toFixed(6), +N.stopLon[i].toFixed(6), N.stopType[i] === 1 ? modesOf(i) : N.stopModes[i], N.stopType[i]]);
  }
  return list;
}

function routesList() {
  if (!N) return [];
  const by = new Map();
  for (let p = 0; p < N.patRoute.length; p++) {
    const r = N.patRoute[p], short = N.routeShort[r];
    const o = by.get(short) || { short, type: N.routeType[r], long: N.routeLong[r], trips: 0 };
    o.trips += N.patTripStart[p + 1] - N.patTripStart[p];
    by.set(short, o);
  }
  return Array.from(by.values()).sort((a, b) => a.short.localeCompare(b.short, undefined, { numeric: true }));
}

/** A route's shapes and main stops each way, for drawing it. */
function routeInfo(short) {
  if (!N) return null;
  const pats = [];
  for (let p = 0; p < N.patRoute.length; p++) if (N.routeShort[N.patRoute[p]].toLowerCase() === String(short).toLowerCase()) pats.push(p);
  if (!pats.length) return null;
  const byDir = new Map();
  for (const p of pats) {
    const t0 = N.patTrip[N.patTripStart[p]];
    const dir = N.tripDir[t0], n = N.patTripStart[p + 1] - N.patTripStart[p];
    const cur = byDir.get(dir);
    if (!cur || n > cur.n) byDir.set(dir, { p, n, t: t0 });
  }
  const shapes = new Set();
  const lines = [];
  for (const p of pats) {
    const si = N.tripShapeIdx[N.patTrip[N.patTripStart[p]]];
    if (si < 0 || shapes.has(si)) continue;
    shapes.add(si);
    const c = [];
    for (let i = N.shapeStart[si]; i < N.shapeStart[si + 1]; i += 2) c.push([+N.shapeXY[i * 2].toFixed(5), +N.shapeXY[i * 2 + 1].toFixed(5)]);
    lines.push(c);
  }
  const dirs = Array.from(byDir.entries()).map(([dir, { p, n, t }]) => ({
    dir, trips: n, headsign: N.tripHead[t],
    stops: Array.from(N.patStops.subarray(N.patStart[p], N.patStart[p] + N.patLen[p])).map(stopJson),
  }));
  let first = INF, last = -INF, trips = 0;
  for (const p of pats) {
    const nT = N.patTripStart[p + 1] - N.patTripStart[p];
    trips += nT;
    first = Math.min(first, depAt(p, 0, 0)); last = Math.max(last, depAt(p, nT - 1, 0));
  }
  const r = N.patRoute[pats[0]];
  return { short: N.routeShort[r], long: N.routeLong[r], type: N.routeType[r], agency: N.routeAgency[r], trips, first, last, dirs, lines };
}

/** A trip's stops and times (static), and its whole shape. */
function tripInfo(id) {
  if (!N) return null;
  const ti = N.tripId.indexOf(id);
  if (ti < 0) return null;
  const p = N.tripPat[ti], j = N.tripPos[ti];
  if (p < 0) return null;
  const stops = [];
  for (let k = 0; k < N.patLen[p]; k++) {
    const s = N.patStops[N.patStart[p] + k];
    stops.push(Object.assign(stopJson(s), { arr: arrAt(p, j, k), dep: depAt(p, j, k), seq: N.seqs[N.seqStart[ti] + k] }));
  }
  const si = N.tripShapeIdx[ti];
  const shape = [];
  if (si >= 0) for (let i = N.shapeStart[si]; i < N.shapeStart[si + 1]; i++) shape.push([+N.shapeXY[i * 2].toFixed(6), +N.shapeXY[i * 2 + 1].toFixed(6)]);
  const r = N.patRoute[p];
  return { tripId: id, route: N.routeShort[r], type: N.routeType[r], headsign: N.tripHead[ti], offset: N.tripOff[ti], stops, shape: shape.length ? shape : stops.map((s) => [s.lon, s.lat]) };
}
