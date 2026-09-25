// Places: searching for addresses and landmarks (Photon, OpenStreetMap data),
// your saved places and recent searches, and walking directions (FOSSGIS OSRM).
(function (A) {
  'use strict';
  const BBOX = '174.2,-37.45,175.35,-36.2';           // greater Auckland
  const cache = new Map();

  function label(p) {
    const pr = p.properties || {};
    const name = pr.name || [pr.housenumber, pr.street].filter(Boolean).join(' ') || pr.street || 'Unnamed place';
    const where = [pr.name && pr.street ? [pr.housenumber, pr.street].filter(Boolean).join(' ') : '', pr.district || pr.locality, pr.city !== 'Auckland' ? pr.city : '']
      .filter((x, i, arr) => x && arr.indexOf(x) === i && x !== name);
    return { name, sub: where.join(', ') || 'Auckland', kind: pr.osm_value || pr.type || 'place' };
  }

  A.places = {
    /** Addresses and places matching the text, nearest Auckland first. */
    async search(q) {
      q = q.trim();
      if (q.length < 3) return [];
      if (cache.has(q)) return cache.get(q);
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=-36.87&lon=174.76&limit=8&bbox=${BBOX}&lang=en`);
      if (!r.ok) return [];
      const j = await r.json();
      const out = (j.features || []).map((f) => Object.assign(label(f), { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], type: 'place' }));
      cache.set(q, out);
      return out;
    },
    /** What's at a point on the map. */
    async reverse(lat, lon) {
      try {
        const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`);
        const j = await r.json();
        const f = (j.features || [])[0];
        if (f) return Object.assign(label(f), { lat, lon, type: 'place' });
      } catch (e) { /* offline */ }
      return { name: 'Dropped pin', sub: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon, type: 'place' };
    },

    /** Walking directions between two points: the path and step-by-step turns. */
    async walk(a, b) {
      const key = [a.lon, a.lat, b.lon, b.lat].map((v) => (+v).toFixed(5)).join(',');
      if (cache.has(key)) return cache.get(key);
      const p = (async () => {
        try {
          const r = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}` +
                                `?overview=full&geometries=geojson&steps=true`);
          const j = await r.json();
          const route = j.routes && j.routes[0];
          if (!route) throw new Error('no route');
          const steps = [];
          for (const s of route.legs[0].steps) {
            const m = s.maneuver || {};
            const on = s.name ? ` onto ${s.name}` : '';
            let t;
            if (m.type === 'depart') t = `Head ${m.bearing_after != null ? compass(m.bearing_after) : 'off'}${s.name ? ' on ' + s.name : ''}`;
            else if (m.type === 'arrive') t = 'Arrive';
            else if (m.modifier === 'straight' || m.type === 'continue' || m.type === 'new name') t = `Continue${s.name ? ' along ' + s.name : ''}`;
            else if (m.modifier) t = `Turn ${m.modifier.replace('slight ', 'slightly ').replace('sharp ', 'sharp ')}${on}`;
            else t = `Continue${on}`;
            if (steps.length && steps[steps.length - 1].text === t) { steps[steps.length - 1].dist += s.distance; continue; }
            steps.push({ text: t, dist: s.distance });
          }
          return { coords: route.geometry.coordinates, dist: route.distance, dur: route.duration, steps: steps.filter((s) => s.text !== 'Arrive' || true) };
        } catch (e) {
          return { coords: [[a.lon, a.lat], [b.lon, b.lat]], dist: null, dur: null, steps: [], straight: true };
        }
      })();
      cache.set(key, p);
      return p;
    },

    // ---------- saved places and recents ----------
    home() {
      const h = A.settings.get('home');
      if (h) return h;
      // until you set one: your first watched stop
      const r = A.ROUTES[A.settings.get('stops')[0]];
      const s = r && r.stops.find((x) => x.code === A.settings.get('stops')[0]);
      return s ? { name: A.settings.get('place') || 'Home', sub: s.name, lat: s.lat, lon: s.lon, type: 'home' } : null;
    },
    work() { return A.settings.get('work') || null; },
    recents() { return A.settings.get('recentPlaces') || []; },
    remember(p) {
      if (!p || p.type === 'home' || p.type === 'work' || p.type === 'pin') return;
      const list = A.places.recents().filter((x) => !(Math.abs(x.lat - p.lat) < 1e-5 && Math.abs(x.lon - p.lon) < 1e-5));
      list.unshift({ name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, type: p.type === 'stop' ? 'stop' : 'recent', code: p.code, id: p.id });
      A.settings.set('recentPlaces', list.slice(0, 8));
    },
  };

  function compass(deg) {
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
  }
})(window.AKL);
