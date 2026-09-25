// Turning the AT API into what the screens show: stop boards, trains, every bus.
(function (A) {
  'use strict';
  const T = A.time;

  // ======================= buses at our stops =======================
  const stopCache = {};                 // code -> stop attributes
  const schedCache = {};                // code|route -> { at, list }

  async function fetchStop(code) {
    if (stopCache[code]) return stopCache[code];
    const j = await A.api.get('/gtfs/v3/stops?filter%5Bstop_code%5D=' + encodeURIComponent(code));
    const a = j && j.data && j.data[0] && j.data[0].attributes;
    if (!a) throw new Error(`Stop ${code} not found`);
    stopCache[code] = a;
    return a;
  }

  /** Scheduled departures from a stop: from an hour ago, [hours] ahead. */
  async function schedule(stopId, route, hours) {
    const nowSec = T.now();
    const h = T.parts(Date.now()).h;
    const queries = [[T.date(), Math.max(0, h - 1)]];
    if (h < 3) queries.push([T.date(null, -1), h + 23]);
    const out = new Map();
    for (const [date, hour] of queries) {
      const j = await A.api.get(`/gtfs/v3/stops/${stopId}/stoptrips?filter%5Bdate%5D=${date}` +
                                `&filter%5Bstart_hour%5D=${hour}&hour_range=${hours}`);
      for (const e of (j && j.data) || []) {
        const a = e.attributes;
        if (!a || a.pickup_type === 1) continue;
        const r = String(a.route_id || '').split('-')[0];
        if (route && r.toLowerCase() !== route.toLowerCase()) continue;
        out.set(a.trip_id, {
          tripId: a.trip_id, route: r,
          headsign: A.cleanHeadsign(a.trip_headsign || a.stop_headsign),
          stopSeq: +a.stop_sequence,
          scheduled: T.serviceEpoch(a.service_date, a.departure_time),
        });
      }
    }
    return Array.from(out.values()).filter((d) => d.scheduled > nowSec - 7200).sort((a, b) => a.scheduled - b.scheduled);
  }

  async function vehiclesFor(tripIds) {
    const out = {};
    for (let i = 0; i < tripIds.length; i += 30) {
      const j = await A.api.get('/realtime/legacy/vehiclelocations?tripid=' + tripIds.slice(i, i + 30).join(','));
      for (const e of (j && j.response && j.response.entity) || []) {
        const v = A.parseVehicle(e);
        if (v && v.tripId) out[v.tripId] = v;
      }
    }
    return out;
  }

  A.buses = {
    /** One stop's board: the next buses with live times and where they are. */
    async board(code, route) {
      const attr = await fetchStop(code);
      const now = T.now();
      const key = code + '|' + route;
      let cached = schedCache[key];
      if (!cached || now - cached.at > 300 || !cached.list.some((d) => d.scheduled > now + 600)) {
        cached = schedCache[key] = { at: now, list: await schedule(attr.stop_id, route, 5) };
      }
      const window_ = cached.list.filter((d) => d.scheduled >= now - 1800 && d.scheduled <= now + 4 * 3600);
      const rt = await A.tripUpdates(window_.map((d) => d.tripId).slice(0, 40));
      const deps = window_.map((d) => {
        const u = rt[d.tripId];
        if (!u) return Object.assign({ delay: null, live: false }, d);
        const delay = (u.seq === d.stopSeq && u.time != null) ? u.time - d.scheduled : (u.delay || 0);
        return Object.assign({}, d, {
          delay, live: true, cancelled: u.cancelled,
          gone: u.seq != null && u.seq > d.stopSeq, vehicleSeq: u.seq,
        });
      });
      const coming = deps.filter((d) => d.live && !d.gone && !d.cancelled).map((d) => d.tripId);
      const vehicles = coming.length ? await vehiclesFor(coming.slice(0, 30)) : {};
      const shown = deps.map((d) => {
        const x = Object.assign({}, d, { vehicle: vehicles[d.tripId] || null });
        x.expected = x.scheduled + (x.delay || 0);
        x.stopsAway = x.vehicleSeq != null && x.stopSeq - x.vehicleSeq >= 0 ? x.stopSeq - x.vehicleSeq : null;
        return x;
      }).filter((d) => !d.gone && d.expected >= now - 45).sort((a, b) => a.expected - b.expected);
      return {
        code, name: attr.stop_name, lat: +attr.stop_lat, lon: +attr.stop_lon,
        route: (shown[0] && shown[0].route) || route,
        headsign: (shown[0] && shown[0].headsign) || (cached.list[0] && cached.list[0].headsign) || '',
        departures: shown, updated: now, error: null,
      };
    },

    /** The rest of today's timetable at a stop (for the timetable panel). */
    async today(code, route) {
      const attr = await fetchStop(code);
      const now = T.now();
      const list = await schedule(attr.stop_id, route, 24);
      return list.filter((d) => d.scheduled >= now - 60 && d.scheduled < now + 24 * 3600);
    },
  };

  // ======================= trains =======================
  const NET = A.NET;
  const KX = Math.cos(36.9 * Math.PI / 180);

  /** Snaps a GPS fix onto the nearest station-to-station stretch of the train's own line. */
  const byLine = NET.lineIds.map((_, li) => NET.segs.filter((s) => s.line === li).map((s) => {
    const p = s.poly;
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    const ax = s.lon0 * KX, ay = s.lat0, dx = s.lon1 * KX - ax, dy = s.lat1 - ay;
    return { s, cum, ax, ay, dx, dy, l2: dx * dx + dy * dy };
  }));
  A.place = function (line, lat, lon) {
    const px = lon * KX;
    let best = null, bestT = 0, bd = Infinity;
    for (const g of byLine[line]) {
      const t = g.l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - g.ax) * g.dx + (lat - g.ay) * g.dy) / g.l2));
      const ex = g.ax + t * g.dx - px, ey = g.ay + t * g.dy - lat;
      const d = ex * ex + ey * ey;
      if (d < bd) { bd = d; best = g; bestT = t; }
    }
    if (!best || bd > 0.015 * 0.015) return null;          // >~1.5 km off the line: a depot
    const p = best.s.poly, cum = best.cum;
    const goal = bestT * cum[cum.length - 1];
    for (let i = 0; i < cum.length - 1; i++) {
      if (goal <= cum[i + 1] || i === cum.length - 2) {
        const span = cum[i + 1] - cum[i];
        const f = span === 0 ? 0 : (goal - cum[i]) / span;
        return [p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * f, p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * f];
      }
    }
    return [p[p.length - 2], p[p.length - 1]];
  };

  const platformStation = {};
  NET.stations.forEach((st, i) => Object.keys(st.platforms).forEach((pid) => { platformStation[pid] = i; }));
  let trainIds = null, discovered = 0;
  const tripCache = {};

  A.trains = {
    /** Every train on the network, placed on the diagram. */
    async poll() {
      const now = T.now();
      const path = '/realtime/legacy/vehiclelocations?vehicleid=';
      let j;
      if (!trainIds || now - discovered > 1800) {
        // every AT train is an AM-class unit with a 59xxx id
        const all = [];
        for (let i = 59000; i < 60000; i++) all.push(i);
        j = await A.api.get(path + all.join(','));
        discovered = now;
      } else {
        j = await A.api.get(path + trainIds);
      }
      const vehicles = [];
      for (const e of (j && j.response && j.response.entity) || []) {
        const v = A.parseVehicle(e);
        if (v) vehicles.push(v);
      }
      if (vehicles.length) trainIds = vehicles.map((v) => v.id).sort().join(',');
      const placed = [];
      for (const v of vehicles) {
        const code = v.routeId ? v.routeId.slice(0, v.routeId.lastIndexOf('-')) : null;
        const li = NET.lineIds.indexOf(code);
        if (li < 0) continue;
        const xy = A.place(li, v.lat, v.lon);
        if (!xy) continue;
        placed.push({ v, line: li, x: xy[0], y: xy[1], delay: null, stopSeq: null });
      }
      const rt = await A.tripUpdates(placed.map((t) => t.v.tripId));
      for (const t of placed) {
        const u = t.v.tripId && rt[t.v.tripId];
        if (u) { t.delay = u.delay; t.stopSeq = u.seq; }
      }
      return placed;
    },

    /** A train's run: where it's going and its stops, cached per trip. */
    async trip(tripId, startDate) {
      if (tripCache[tripId]) return tripCache[tripId];
      const t = await A.api.get('/gtfs/v3/trips/' + tripId);
      const attrs = t && t.data && t.data.attributes;
      const date = startDate || T.date();
      const stops = [];
      const st = await A.api.get(`/gtfs/v3/trips/${tripId}/stoptimes`);
      for (const e of (st && st.data) || []) {
        const a = e.attributes;
        if (!a) continue;
        const si = platformStation[a.stop_id];
        stops.push({
          seq: +a.stop_sequence, station: si != null ? si : null,
          name: si != null ? NET.stations[si].name : (a.stop_headsign || a.stop_id),
          scheduled: T.serviceEpoch(date, a.departure_time || a.arrival_time),
        });
      }
      stops.sort((a, b) => a.seq - b.seq);
      return (tripCache[tripId] = { tripId, headsign: A.cleanHeadsign(attrs && attrs.trip_headsign), stops });
    },

    /** The next trains from every platform of a station, with live delays. */
    async departures(index) {
      const st = NET.stations[index];
      const now = T.now();
      const h = T.parts(Date.now()).h;
      const rows = [];
      await Promise.all(Object.keys(st.platforms).map(async (stopId) => {
        const j = await A.api.get(`/gtfs/v3/stops/${stopId}/stoptrips?filter%5Bdate%5D=${T.date()}` +
                                  `&filter%5Bstart_hour%5D=${h}&hour_range=2`);
        for (const e of (j && j.data) || []) {
          const a = e.attributes;
          if (!a || a.pickup_type === 1) continue;
          const rid = String(a.route_id || '');
          const li = NET.lineIds.indexOf(rid.slice(0, rid.lastIndexOf('-')));
          if (li < 0) continue;
          const sched = T.serviceEpoch(a.service_date, a.departure_time);
          if (sched < now - 1800) continue;
          rows.push({ tripId: a.trip_id, line: li, platform: st.platforms[stopId],
                      headsign: A.cleanHeadsign(a.trip_headsign), scheduled: sched, seq: +a.stop_sequence, delay: null });
        }
      }));
      rows.sort((a, b) => a.scheduled - b.scheduled);
      const soon = rows.slice(0, 30);
      const rt = await A.tripUpdates(soon.map((d) => d.tripId));
      return soon.map((d) => {
        const u = rt[d.tripId];
        if (u) d.delay = (u.seq === d.seq && u.time != null) ? u.time - d.scheduled : u.delay;
        d.expected = d.scheduled + (d.delay || 0);
        return d;
      }).filter((d) => d.expected >= now - 30).sort((a, b) => a.expected - b.expected).slice(0, 16);
    },
  };

  // ======================= every vehicle on the network =======================
  const headsigns = {};
  A.live = {
    /** The whole feed (~80 KB gzipped): buses we can name, trains, and ferries in service. */
    async all() {
      const j = await A.api.get('/realtime/legacy/vehiclelocations');
      const now = T.now();
      const buses = [], trains = [], ferries = [];
      for (const e of (j && j.response && j.response.entity) || []) {
        const v = A.parseVehicle(e);
        if (!v || isNaN(v.lat) || now - v.timestamp > 900) continue;   // parked vehicles stop reporting
        const route = v.routeId ? v.routeId.split('-')[0] : null;
        if (v.id.startsWith('59')) {
          const code = v.routeId ? v.routeId.slice(0, v.routeId.lastIndexOf('-')) : null;
          trains.push({ v, line: NET.lineIds.indexOf(code), route });
          continue;
        }
        const info = A.fleet.info(v.label);
        if (info) buses.push({ v, info, route });
        else if (v.label && route) ferries.push({ v, route, name: v.label });  // unlabelled ids are other boats
      }
      return { buses, trains, ferries };
    },
    /** Where a tapped vehicle's trip is going and how late it is. */
    async trip(tripId) {
      let head = headsigns[tripId];
      if (!head) {
        const t = await A.api.get('/gtfs/v3/trips/' + tripId);
        head = t && t.data && t.data.attributes && A.cleanHeadsign(t.data.attributes.trip_headsign);
        if (head) headsigns[tripId] = head;
      }
      let delay = null;
      try { const u = (await A.tripUpdates([tripId]))[tripId]; delay = u ? u.delay : null; } catch (e) { /* fine */ }
      return { tripId, headsign: head || null, delay };
    },
  };
})(window.AKL);
