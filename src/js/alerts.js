// AT's service alerts: disruptions, detours, moved stops, no-service periods.
(function (A) {
  'use strict';
  const S = A.state.alerts = { list: [], updated: 0, error: null };

  // AT's text arrives as UTF-8 read as Windows-1252 ("â€¢" for "•"): put it back
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function fix(s) {
    if (!s || !/[ÂÃâ][\u0080-⃿]/.test(s)) return s || '';
    const bytes = [];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x100) bytes.push(c); else if (CP1252[c]) bytes.push(CP1252[c]); else return s;
    }
    const out = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    return out.includes('�') ? s : out;
  }
  const text = (t) => fix(((t && t.translation) || []).map((x) => x.text).find(Boolean) || '');

  const EFFECT = {
    NO_SERVICE: ['No service', 'late'], REDUCED_SERVICE: ['Reduced service', 'warn'], SIGNIFICANT_DELAYS: ['Delays', 'warn'],
    DETOUR: ['Detour', 'warn'], ADDITIONAL_SERVICE: ['Extra service', 'ok'], MODIFIED_SERVICE: ['Changed service', 'warn'],
    STOP_MOVED: ['Stop moved', 'blue'], OTHER_EFFECT: ['Heads up', 'sched'], UNKNOWN_EFFECT: ['Heads up', 'sched'],
  };

  function parse(j) {
    const now = A.time.now();
    const out = [];
    for (const e of (j && j.response && j.response.entity) || []) {
      const a = e.alert;
      if (!a) continue;
      const periods = (a.active_period || []).map((p) => ({ start: +p.start || 0, end: +p.end || Infinity }));
      const current = periods.find((p) => p.start <= now && now <= p.end);
      const upcoming = periods.filter((p) => p.start > now).sort((x, y) => x.start - y.start)[0];
      if (periods.length && !current && !upcoming) continue;               // all in the past
      const routes = new Set(), stops = new Set();
      for (const ie of a.informed_entity || []) {
        if (ie.route_id) routes.add(A.routeShort(ie.route_id));
        if (ie.stop_id) stops.add(ie.stop_id);
        if (ie.trip && ie.trip.route_id) routes.add(A.routeShort(ie.trip.route_id));
      }
      const [label, cls] = EFFECT[a.effect] || EFFECT.OTHER_EFFECT;
      out.push({
        id: e.id, header: text(a.header_text), description: text(a.description_text), detail: text(a.effect_detail),
        effect: a.effect, label, cls, cause: a.cause, severity: a.severity_level, url: text(a.url),
        active: !periods.length || !!current, next: current || upcoming || null,
        routes: Array.from(routes).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
        stopIds: Array.from(stops), stopCodes: Array.from(stops).map((s) => s.split('-')[0]),
      });
    }
    // what's happening now first, then the soonest
    return out.sort((x, y) => (y.active - x.active) || ((x.next ? x.next.start : 0) - (y.next ? y.next.start : 0)));
  }

  A.alerts = {
    async refresh() {
      try {
        S.list = parse(await A.api.get('/realtime/legacy/servicealerts'));
        S.updated = A.time.now(); S.error = null;
      } catch (e) { S.error = e.message; }
      A.emit('alerts', S);
    },
    /** Alerts touching any of these routes ("27H") or stops (code or id). */
    matching(routes, stops) {
      const r = new Set((routes || []).map(String));
      const st = new Set((stops || []).map(String));
      return S.list.filter((a) => a.routes.some((x) => r.has(x)) || a.stopIds.some((x) => st.has(x)) || a.stopCodes.some((x) => st.has(x)));
    },
    /** The ones that matter to you: your route, your stops, your favourite stops. */
    mine() {
      const favs = (A.settings.get('favStops') || []).map((f) => f.code || f.id);
      return A.alerts.matching([A.settings.get('route')].filter(Boolean), A.settings.get('stops').concat(favs)).filter((a) => a.active);
    },
    when(a) {
      if (!a.next) return 'Ongoing';
      const T = A.time;
      const fmtDay = (t) => new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t * 1000));
      const end = a.next.end === Infinity ? 'until further notice' : `until ${T.clock(a.next.end)}${fmtDay(a.next.end) !== fmtDay(T.now()) ? ' ' + fmtDay(a.next.end) : ''}`;
      return a.active ? `Now, ${end}` : `From ${fmtDay(a.next.start)} ${T.clock(a.next.start)}`;
    },
  };
})(window.AKL);
