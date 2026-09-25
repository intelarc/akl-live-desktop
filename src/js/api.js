// Auckland Transport's developer API, Open-Meteo weather, and the fleet list.
(function (A) {
  'use strict';

  // ---------- AT API ----------
  A.api = {
    key() {
      return (A.settings.get('apiKey') || (window.AKL_KEYS && window.AKL_KEYS.at) || '').trim();
    },
    builtIn() { return !A.settings.get('apiKey') && !!(window.AKL_KEYS && window.AKL_KEYS.at); },
    async get(path) {
      const k = this.key();
      if (!k) throw new Error('No AT API key: add one in Settings');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const r = await fetch('https://api.at.govt.nz' + path, {
          headers: { 'Ocp-Apim-Subscription-Key': k, Accept: 'application/json' },
          signal: ctrl.signal, cache: 'no-store',
        });
        if (r.status === 404) return null;                 // stoptrips: nothing in the window
        if (r.status === 401) throw new Error('AT rejected the API key (401)');
        if (r.status === 429) throw new Error('AT says slow down (429)');
        if (!r.ok) throw new Error('AT API error ' + r.status);
        return await r.json();
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('AT API timed out');
        if (e instanceof TypeError) throw new Error('No connection to AT');
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };

  /** A vehicle from the realtime feed. */
  A.parseVehicle = function (e) {
    const v = e && e.vehicle;
    const pos = v && v.position;
    if (!pos || pos.latitude == null) return null;
    const trip = v.trip || {};
    const info = v.vehicle || {};
    const id = String(info.id || e.id || '');
    // trains (59xxx) report m/s as GTFS-realtime says; buses report km/h
    const toKmh = id.startsWith('59') ? 3.6 : 1;
    return {
      id,
      label: String(info.label || '').replace(/\s+/g, ' ').trim(),
      tripId: trip.trip_id || null,
      routeId: trip.route_id || null,
      directionId: trip.direction_id != null ? +trip.direction_id : null,
      startDate: trip.start_date || null,
      lat: +pos.latitude,
      lon: +pos.longitude,
      bearing: pos.bearing != null ? +pos.bearing : null,
      speedKmh: pos.speed != null ? +pos.speed * toKmh : null,
      timestamp: +(v.timestamp || 0),
      occupancy: v.occupancy_status != null ? +v.occupancy_status : null,
    };
  };

  /** The feed's stop_time_update is sometimes an object, sometimes a list (take the latest). */
  function stopTimeUpdate(tu) {
    const s = tu.stop_time_update;
    if (!s) return null;
    return Array.isArray(s) ? s[s.length - 1] || null : s;
  }

  /** Delay and last stop event per trip. */
  A.tripUpdates = async function (ids) {
    const out = {};
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    for (let i = 0; i < uniq.length; i += 30) {
      const j = await A.api.get('/realtime/legacy/tripupdates?tripid=' + uniq.slice(i, i + 30).join(','));
      const ents = (j && j.response && j.response.entity) || [];
      for (const ent of ents) {
        const tu = ent.trip_update;
        if (!tu || !tu.trip) continue;
        const stu = stopTimeUpdate(tu);
        const ev = stu && (stu.departure || stu.arrival);
        out[tu.trip.trip_id] = {
          seq: stu && stu.stop_sequence != null ? +stu.stop_sequence : null,
          delay: ev && ev.delay != null ? +ev.delay : (tu.delay != null ? +tu.delay : null),
          time: ev && ev.time != null ? +ev.time : null,
          cancelled: !!ent.is_deleted || tu.trip.schedule_relationship === 3,
        };
      }
    }
    return out;
  };

  /** "Waikowhai To Britomart Via Hillsborough Rd" -> "Britomart" */
  A.cleanHeadsign = function (raw) {
    let s = String(raw || '');
    const to = s.search(/ to /i);
    if (to >= 0) s = s.slice(to + 4);
    const via = s.search(/ via /i);
    if (via >= 0) s = s.slice(0, via);
    s = s.trim().replace(/\s+\d+$/, '');
    const st = (A.NET.stations || []).find((x) => x.key.toLowerCase() === s.toLowerCase());
    if (st) return st.name;
    return s.split(' ').map((w) => (w.length > 3 && w === w.toUpperCase()) ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
  };

  /** "27H-203" -> "27H", "E-W-201" -> "E-W": the route's name, without its version. */
  A.routeShort = (id) => { const s = String(id || ''); const i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };

  A.occupancy = function (o) {
    return ['Empty', 'Plenty of seats', 'Few seats left', 'Standing room', 'Very full', 'Full',
            'Not taking passengers'][o] || null;
  };

  // ---------- weather ----------
  A.weather = {
    async fetch() {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=-36.87&longitude=174.76' +
        '&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m' +
        '&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=12&timezone=Pacific%2FAuckland',
        { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      const c = j.current || {};
      const w = {
        tempC: c.temperature_2m, code: c.weather_code, cloudCover: c.cloud_cover,
        precipMm: c.precipitation || 0, windKmh: c.wind_speed_10m,
        hourly: (j.hourly && j.hourly.time || []).map((t, i) => ({
          time: t, temp: j.hourly.temperature_2m[i], code: j.hourly.weather_code[i],
          rainChance: j.hourly.precipitation_probability[i],
        })),
      };
      return A.weather.enrich(w);
    },
    enrich(w) {
      const code = w.code;
      w.foggy = code === 45 || code === 48;
      w.thunder = code >= 95;
      w.rain = (code >= 51 && code <= 57) ? 1
        : ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || w.thunder)
          ? ((code === 65 || code === 67 || code === 82 || w.precipMm > 4) ? 3 : 2)
          : (w.precipMm > 0.2 ? 1 : 0);
      return w;
    },
    /** [emoji, words] */
    describe(code, cloud, night) {
      if (code >= 95) return ['⛈', 'Thunder'];
      if (code >= 80 && code <= 82) return ['🌦', 'Showers'];
      if (code >= 61 && code <= 67) return ['🌧', 'Rain'];
      if (code >= 51 && code <= 57) return ['🌦', 'Drizzle'];
      if (code === 45 || code === 48) return ['🌫', 'Fog'];
      if (code === 3 || cloud > 85) return ['☁', 'Overcast'];
      if ((code >= 1 && code <= 2) || cloud > 30) return [night ? '☁' : '⛅', 'Partly cloudy'];
      return [night ? '☾' : '☀', night ? 'Clear' : 'Sunny'];
    },
  };

  // ---------- the fleet: what model a fleet number is ----------
  const OPERATORS = {
    NB: 'NZ Bus', RT: 'Ritchies', GB: 'Go Bus', HE: 'Howick & Eastern', TR: 'Tranzurban',
    WB: 'Waiheke Bus Co', BA: 'Bayes', PC: 'Pavlovich',
  };
  const OP_COLORS = {
    NB: '#3D8BFF', RT: '#FF6B4A', PC: '#FF6B4A', GB: '#00C2B8', HE: '#B36BFF', TR: '#7ED957',
    WB: '#FFC53D', BA: '#FF7FD1',
  };
  /** "CRRC eT12 MAX" -> "eT12 MAX", but "MAN 16.250" and "Yutong E13" stay whole. */
  const shortName = (m) => {
    const rest = m.name.startsWith(m.maker + ' ') ? m.name.slice(m.maker.length + 1) : m.name;
    return /^\d/.test(rest) || rest.length <= 4 ? m.name : rest;
  };
  const models = (A.FLEET_DATA.models || []).map((m) => Object.assign({}, m, {
    doubleDeck: (m.decks || 1) >= 2,
    short: shortName(m),
    kind: (m.electric ? 'Electric' : 'Diesel') + ((m.decks || 1) >= 2 ? ' double-decker' : ' single-decker') +
      (m.axles === 3 ? ', three axles' : ''),
  }));
  const byId = {};
  models.forEach((m) => { byId[m.id] = m; });
  const ranges = (A.FLEET_DATA.ranges || []).map(([p, a, b, id]) => ({ prefix: p, first: a, last: b, model: byId[id] }))
    .filter((r) => r.model);
  const LABEL = /^([A-Za-z]{1,3})\s*0*(\d+)$/;

  A.fleet = {
    OPERATORS,
    models,
    model: (id) => byId[id] || null,
    color: (code) => OP_COLORS[code] || '#9AA3AE',
    /** Operator and model for a label ("NB5075"); null if it isn't a bus we know the operator of. */
    info(label) {
      const m = LABEL.exec(String(label || '').trim());
      if (!m) return null;
      const code = m[1].toUpperCase();
      if (!OPERATORS[code]) return null;
      const num = +m[2];
      const r = ranges.find((x) => x.prefix === code && num >= x.first && num <= x.last);
      return { code, operator: OPERATORS[code], fleetNo: String(label).replace(/\s+/g, ''), model: r ? r.model : null };
    },
    /** [["NZ Bus", "NB5752–5786, NB5800–5842"], ...] */
    numbers(model) {
      const by = {};
      for (const r of ranges) {
        if (r.model !== model) continue;
        (by[r.prefix] = by[r.prefix] || []).push(r.first === r.last ? `${r.prefix}${r.first}` : `${r.prefix}${r.first}–${r.last}`);
      }
      return Object.keys(by).map((p) => [OPERATORS[p] || p, by[p].join(', ')]);
    },
    codeOf: (name) => Object.keys(OPERATORS).find((k) => OPERATORS[k] === name) || '',
  };
})(window.AKL);
