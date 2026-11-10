/**
 * Response formats other than JSON, and the one function that chooses between
 * them (csv-output; design D1, D2).
 *
 * JSON is the default and is not in the registry: a request gets JSON unless it
 * ranks an offered format strictly above `application/json`. A route offers
 * formats through `config.formats`; the `onRequest` hook in app.js answers 406
 * when a request selects a registry format its route does not offer.
 */

import { csvSerializer } from './csv.js';

export const JSON_TYPE = 'application/json';

/**
 * The API's non-JSON formats, by media type. `serializer(source)` builds, once
 * per route, the object that turns records into text; `extension` names the
 * downloaded file; `contentType` is the full header value.
 */
export const FORMATS = {
  'text/csv': {
    contentType: 'text/csv; charset=utf-8; header=present',
    extension: 'csv',
    serializer: csvSerializer,
  },
};

/**
 * The `q` of each media range in an `Accept` header, by lowercased range
 * (`text/csv`, `*\/*`, …). Parameters other than `q` are ignored; a malformed
 * `q` counts as 1, as if absent.
 *
 * @param {string} [accept]
 * @returns {Map<string, number>}
 */
function qualities(accept) {
  const ranges = new Map();
  for (const part of String(accept ?? '').split(',')) {
    const [range, ...params] = part.split(';').map((s) => s.trim());
    if (!range) continue;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.split('=').map((s) => s.trim());
      if (name.toLowerCase() === 'q') {
        const parsed = Number(value);
        if (value !== '' && Number.isFinite(parsed)) q = Math.min(Math.max(parsed, 0), 1);
      }
    }
    // A range named twice keeps its highest q.
    const key = range.toLowerCase();
    ranges.set(key, Math.max(ranges.get(key) ?? 0, q));
  }
  return ranges;
}

/**
 * The media type to serve: the offered format the request ranks highest, when
 * its `q` is above zero and strictly above any `q` the request gives
 * `application/json` explicitly; otherwise JSON. A tie goes to JSON, and a
 * wildcard never selects a non-JSON format.
 *
 * @param {string} [accept]   the request's `Accept` header
 * @param {string[]} offered  media types from {@link FORMATS}
 * @returns {string} a media type from `offered`, or {@link JSON_TYPE}
 */
export function negotiate(accept, offered = []) {
  const ranges = qualities(accept);
  const json = ranges.get(JSON_TYPE) ?? 0;
  let best = JSON_TYPE;
  let bestQ = json;
  for (const type of offered) {
    const q = ranges.get(type) ?? 0;
    if (q > 0 && q > bestQ) {
      best = type;
      bestQ = q;
    }
  }
  return best;
}

/** Every media type in the registry: what a request can select anywhere. */
export const ALL_FORMATS = Object.keys(FORMATS);
