/**
 * Cursor tokens for keyset pagination.
 *
 * A cursor names a position in the list's total `permid` ordering plus the
 * direction of travel, so one parameter carries both and an inconsistent
 * combination is unrepresentable. It is handed to clients only inside a
 * `links.next` / `links.prev` URL.
 *
 * The token is deliberately OPAQUE: base64url is encoding, not protection, and
 * nothing about it is part of the public contract. Keeping it opaque is what
 * lets the encoding grow later — a compound key for a name-ordered list, say —
 * without a client-visible break, where a raw `?after_permid=` would have frozen
 * the mechanism into the API on day one. No authorization decision depends on a
 * cursor's contents, so a hand-forged one can only name a position in data the
 * client may already read.
 */

/** Travel directions a cursor can encode. */
export const FORWARD = 'next';
export const BACKWARD = 'prev';

/**
 * Encode a position + direction into an opaque token.
 *
 * @param {{ permid: string, direction: 'next' | 'prev' }} position
 * @returns {string} base64url token
 */
export function encodeCursor({ permid, direction }) {
  return Buffer.from(JSON.stringify({ p: permid, d: direction }), 'utf8').toString('base64url');
}

/**
 * Decode a token back to `{ permid, direction }`, or `null` when it is not a
 * cursor this system issued. Every malformed input — bad base64, bad JSON, a
 * missing or non-string `permid`, an unknown direction — returns `null` rather
 * than throwing, so the seam can turn it into a 400 and a decode failure can
 * never surface as a 500.
 *
 * @param {string} token
 * @returns {{ permid: string, direction: 'next' | 'prev' } | null}
 */
export function decodeCursor(token) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const { p: permid, d: direction } = parsed;
  if (typeof permid !== 'string' || permid === '') return null;
  if (direction !== FORWARD && direction !== BACKWARD) return null;

  return { permid, direction };
}

/**
 * Build the `links.next` / `links.prev` pair for a page, at the route boundary.
 *
 * Every other query parameter of the current request is preserved — only
 * `cursor` is replaced — so following a link keeps the caller's filters and
 * page size.
 *
 * `hasMore` reports rows beyond the page IN THE DIRECTION OF TRAVEL, so which
 * link it answers depends on which way this request went:
 *
 *   - travelling forward (or no cursor at all): `hasMore` means a further page
 *     lies ahead, so it decides `next`. A preceding page exists exactly when
 *     this request arrived on a cursor.
 *   - travelling backward: `hasMore` means a further page lies BEHIND, so it
 *     decides `prev` instead — and `next` is unconditional, because the page we
 *     reversed out of is by construction still there.
 *
 * That asymmetry is what keeps `prev` null on the first page however the client
 * reached it, and keeps `next` from vanishing mid-way through a backward walk.
 * An empty page has no boundary record to point at, so both are `null`.
 *
 * @param {string} url  `request.url` (path + query)
 * @param {{ records: Array<{ permid: string }>, hasMore: boolean }} page
 * @param {{ permid: string, direction: 'next'|'prev' }} [cursor]
 *   the cursor this request travelled in on, if any
 * @returns {{ next: string|null, prev: string|null }}
 */
export function pageLinks(url, { records, hasMore }, cursor) {
  if (records.length === 0) return { next: null, prev: null };

  const backward = cursor?.direction === BACKWARD;
  const hasNext = backward || hasMore;
  const hasPrev = backward ? hasMore : Boolean(cursor);

  return {
    next: hasNext ? withCursor(url, records[records.length - 1].permid, FORWARD) : null,
    prev: hasPrev ? withCursor(url, records[0].permid, BACKWARD) : null,
  };
}

function withCursor(url, permid, direction) {
  // The base is required by the URL parser and discarded: these links are
  // path-relative, matching `links.self`.
  const parsed = new URL(url, 'http://pagination.invalid');
  parsed.searchParams.set('cursor', encodeCursor({ permid, direction }));
  return `${parsed.pathname}${parsed.search}`;
}
