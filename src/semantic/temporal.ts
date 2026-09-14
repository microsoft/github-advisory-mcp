/**
 * Parse temporal intent from a free-text query and score how close an advisory's
 * publish date is to that period. Soft signal for reranking — not a hard filter.
 */

export interface Temporal {
  present: boolean;   // did the query express a period?
  start: number;      // epoch ms, inclusive
  end: number;        // epoch ms, exclusive
  residual: string;   // query with the temporal phrase removed (for embed/BM25)
}

const DAY = 86_400_000;
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const utc = (y: number, m = 0, d = 1) => Date.UTC(y, m, d);

/** Try each pattern; on match, return the window + the query minus the phrase. */
export function parseTemporal(query: string, now: number = Date.now()): Temporal {
  const none: Temporal = { present: false, start: 0, end: 0, residual: query };
  const strip = (re: RegExp): string => query.replace(re, ' ').replace(/\s+/g, ' ').trim();
  let m: RegExpMatchArray | null;

  // 1) explicit range YYYY-MM-DD..YYYY-MM-DD
  if ((m = query.match(/\b(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})\b/))) {
    return { present: true, start: Date.parse(m[1] + 'T00:00:00Z'), end: Date.parse(m[2] + 'T00:00:00Z') + DAY, residual: strip(/\b\d{4}-\d{2}-\d{2}\s*\.\.\s*\d{4}-\d{2}-\d{2}\b/) };
  }
  // 2) single ISO date
  if ((m = query.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    const s = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return { present: true, start: s, end: s + DAY, residual: strip(/\b\d{4}-\d{2}-\d{2}\b/) };
  }
  // 3) YYYY-MM
  if ((m = query.match(/\b(\d{4})-(\d{2})\b/))) {
    const y = +m[1], mo = +m[2] - 1;
    return { present: true, start: utc(y, mo), end: utc(y, mo + 1), residual: strip(/\b\d{4}-\d{2}\b/) };
  }
  // 4) month name + year ("August 2026", "aug 2026")
  if ((m = query.match(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/)) && MONTHS[m[1].toLowerCase()] !== undefined) {
    const mo = MONTHS[m[1].toLowerCase()], y = +m[2];
    return { present: true, start: utc(y, mo), end: utc(y, mo + 1), residual: strip(/\b[A-Za-z]{3,9}\.?\s+\d{4}\b/) };
  }
  // 5) "last/past N days|weeks|months|years"
  if ((m = query.match(/\b(?:last|past|within)\s+(\d+)\s+(day|week|month|year)s?\b/i))) {
    const n = +m[1], unit = m[2].toLowerCase();
    const span = unit === 'day' ? n * DAY : unit === 'week' ? n * 7 * DAY : unit === 'month' ? n * 30 * DAY : n * 365 * DAY;
    return { present: true, start: now - span, end: now + DAY, residual: strip(/\b(?:last|past|within)\s+\d+\s+(?:day|week|month|year)s?\b/i) };
  }
  // 6) "this|last week|month|year"
  if ((m = query.match(/\b(this|last)\s+(week|month|year)\b/i))) {
    const which = m[1].toLowerCase(), unit = m[2].toLowerCase();
    const d = new Date(now);
    let start: number, end: number;
    if (unit === 'year') {
      const y = d.getUTCFullYear() - (which === 'last' ? 1 : 0);
      start = utc(y, 0); end = which === 'last' ? utc(y + 1, 0) : now + DAY;
    } else if (unit === 'month') {
      const y = d.getUTCFullYear(), mo = d.getUTCMonth() - (which === 'last' ? 1 : 0);
      start = utc(y, mo); end = which === 'last' ? utc(y, mo + 1) : now + DAY;
    } else { // week
      const span = 7 * DAY;
      start = which === 'last' ? now - 2 * span : now - span; end = which === 'last' ? now - span : now + DAY;
    }
    return { present: true, start, end, residual: strip(/\b(?:this|last)\s+(?:week|month|year)\b/i) };
  }
  // 7) today / yesterday
  if (/\byesterday\b/i.test(query)) {
    const midnight = Math.floor(now / DAY) * DAY;
    return { present: true, start: midnight - DAY, end: midnight, residual: strip(/\byesterday\b/i) };
  }
  if (/\btoday\b/i.test(query)) {
    const midnight = Math.floor(now / DAY) * DAY;
    return { present: true, start: midnight, end: now + DAY, residual: strip(/\btoday\b/i) };
  }
  // 8) bare year (e.g. "2026")
  if ((m = query.match(/\b(19|20)\d{2}\b/))) {
    const y = +m[0];
    return { present: true, start: utc(y, 0), end: utc(y + 1, 0), residual: strip(/\b(?:19|20)\d{2}\b/) };
  }
  // 9) fuzzy "recent|recently|latest|newest" -> last 90 days (decay from now)
  if (/\b(recent|recently|latest|newest|new)\b/i.test(query)) {
    return { present: true, start: now - 90 * DAY, end: now + DAY, residual: strip(/\b(?:recent|recently|latest|newest|new)\b/i) };
  }

  return none;
}

/**
 * 1.0 inside the window; exponential decay by distance (days) to the nearest
 * boundary outside it. Unknown dates score 0.
 */
export function temporalRelevance(publishedMs: number, t: Temporal, halfLifeDays = 45): number {
  if (!t.present || !publishedMs) return 0;
  if (publishedMs >= t.start && publishedMs < t.end) return 1;
  const distDays = (publishedMs < t.start ? t.start - publishedMs : publishedMs - t.end) / DAY;
  return Math.exp(-distDays / halfLifeDays);
}
