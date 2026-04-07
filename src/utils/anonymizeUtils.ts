import type { AnonymizationDictionary, ParsedLogLine } from '../types/log.types';

/**
 * Marker line prepended to exported anonymized logs.
 *
 * When this string appears as the very first non-empty line of a log file,
 * the viewer recognises the file as previously anonymized and pre-activates
 * the anonymized button state. The marker is stripped before the rest of the
 * file is parsed normally.
 *
 * @example
 * ```
 * # [rageshake-viewer-anonymized]
 * 2026-01-01T00:00:00Z INFO @user0:domain0.org joined !room0:domain0.org
 * ```
 */
export const ANONYMIZED_LOG_MARKER = '# [rageshake-viewer-anonymized]';

// ---------------------------------------------------------------------------
// Matrix identifier regexes (per spec Appendix 4)
// ---------------------------------------------------------------------------

/**
 * Server name component used inside composite identifier patterns.
 *
 * Covers:
 * - IPv6 literals:    `[hexchars]`
 * - IPv4 / DNS names: `matrix.org`, `1.2.3.4`, `sub.matrix.org`
 * - Optional port:    `:8448`
 *
 * A dot is required in the hostname part so that bare digits (e.g. `0`, `1`)
 * or single-label names (e.g. `localhost`, `channel`) are never mistaken for
 * Matrix server names. Without this guard, an identifier like `#channel:0`
 * would cause every `0` digit in every log line to be replaced with a domain
 * alias, silently corrupting timestamps and other unrelated values.
 */
const SERVER_NAME_PAT =
  '(?:\\[[0-9A-Fa-f:.]+\\]|[A-Za-z0-9][A-Za-z0-9\\-]*(?:\\.[A-Za-z0-9][A-Za-z0-9\\-]*)+'  +
  ')(?::\\d{1,5})?';

/**
 * Matches all Matrix identifiers in a text string.
 *
 * Patterns are ordered longest-first (identifiers with domain before bare
 * event/room IDs) so that `$id:domain` is captured before `$id`.
 */
const MATRIX_IDENTIFIER_RE = new RegExp(
  [
    // User ID:  @localpart:server_name
    // The Matrix spec requires lowercase localparts in modern IDs, but
    // historical servers (e.g. old Synapse versions) allowed uppercase letters
    // such as "@Bob:matrix.org". Accept both cases so those IDs are anonymized.
    `@[a-zA-Z0-9._=\\-/+]+:${SERVER_NAME_PAT}`,
    // Room alias: #alias:server_name
    `#[^:\\s\\x00]+:${SERVER_NAME_PAT}`,
    // Room ID with domain: !opaque_id:server_name
    `![A-Za-z0-9._~=+\\-/]+:${SERVER_NAME_PAT}`,
    // Event ID with domain: $opaque_id:server_name
    `\\$[A-Za-z0-9._~=+\\-/]+:${SERVER_NAME_PAT}`,
    // Modern event ID (no domain, base64url, min 10 chars to reduce false positives)
    `\\$[A-Za-z0-9+/=_\\-]{10,}`,
    // Modern room ID (no domain, base64url, min 10 chars)
    `![A-Za-z0-9+/=_\\-]{10,}`,
  ].join('|'),
  'g',
);

// ---------------------------------------------------------------------------
// Dictionary builder
// ---------------------------------------------------------------------------

/**
 * Scan every raw text field in `logLines` and build a bidirectional
 * anonymization dictionary.
 *
 * Replacement aliases follow the naming scheme:
 * - Domains:      `domain0.org`, `domain1.org`, …
 * - User IDs:     `@user0:domain0.org`, `@user1:domain0.org`, …
 * - Room IDs:     `!room0:domain0.org`, `!room1:domain0.org`, …
 * - Room aliases: `#room_alias_0:domain0.org`, …
 * - Event IDs:    `$event0:domain0.org` (with domain) or `$event0` (modern)
 *
 * Domains encountered inside Matrix identifiers are registered in the `forward`
 * map so that standalone occurrences of the same domain string in log text are
 * also replaced by `applyAnonymization` without a second scan pass.
 *
 * @example
 * ```ts
 * const dict = buildAnonymizationDictionary(parsedLines);
 * dict.forward['@alice:matrix.example.org']; // '@user0:domain0.org'
 * dict.reverse['@user0:domain0.org'];         // '@alice:matrix.example.org'
 * ```
 */
export function buildAnonymizationDictionary(logLines: readonly ParsedLogLine[]): AnonymizationDictionary {
  let userCount = 0;
  let roomCount = 0;
  let aliasCount = 0;
  let eventCount = 0;
  let domainCount = 0;

  const forward: Record<string, string> = {};
  const reverse: Record<string, string> = {};

  function register(original: string, alias: string): void {
    if (forward[original] !== undefined) return;
    forward[original] = alias;
    reverse[alias] = original;
  }

  /**
   * Return the existing or freshly-created alias for `serverName`.
   *
   * The bare server name (port stripped) is registered in `forward` so that
   * any standalone occurrence of that domain in log text is replaced by
   * `applyAnonymization` without needing an extra scan pass.
   */
  function getOrCreateDomainAlias(serverName: string): string {
    const bare = serverName.replace(/:\d{1,5}$/, '');
    if (forward[bare] !== undefined) return forward[bare];
    const alias = `domain${domainCount++}.org`;
    register(bare, alias);
    // Map the port-bearing variant to the same alias (forward only; the reverse
    // canonical target is the bare name).
    if (serverName !== bare) {
      forward[serverName] = alias;
    }
    return alias;
  }

  function processIdentifier(id: string): void {
    if (id.startsWith('@')) {
      const colonIdx = id.indexOf(':');
      if (colonIdx === -1) return;
      const domainAlias = getOrCreateDomainAlias(id.slice(colonIdx + 1));
      if (forward[id] === undefined) {
        register(id, `@user${userCount}:${domainAlias}`);
        userCount++;
      }
    } else if (id.startsWith('#')) {
      const colonIdx = id.indexOf(':');
      if (colonIdx === -1) return;
      const domainAlias = getOrCreateDomainAlias(id.slice(colonIdx + 1));
      if (forward[id] === undefined) {
        register(id, `#room_alias_${aliasCount}:${domainAlias}`);
        aliasCount++;
      }
    } else if (id.startsWith('!')) {
      const colonIdx = id.indexOf(':');
      if (colonIdx !== -1) {
        const domainAlias = getOrCreateDomainAlias(id.slice(colonIdx + 1));
        if (forward[id] === undefined) {
          register(id, `!room${roomCount}:${domainAlias}`);
          roomCount++;
        }
      } else {
        if (forward[id] === undefined) {
          register(id, `!room${roomCount}`);
          roomCount++;
        }
      }
    } else if (id.startsWith('$')) {
      const colonIdx = id.indexOf(':');
      if (colonIdx !== -1) {
        const domainAlias = getOrCreateDomainAlias(id.slice(colonIdx + 1));
        if (forward[id] === undefined) {
          register(id, `$event${eventCount}:${domainAlias}`);
          eventCount++;
        }
      } else {
        if (forward[id] === undefined) {
          register(id, `$event${eventCount}`);
          eventCount++;
        }
      }
    }
  }

  function scanText(text: string): void {
    MATRIX_IDENTIFIER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MATRIX_IDENTIFIER_RE.exec(text)) !== null) {
      processIdentifier(m[0]);
    }
  }

  for (const line of logLines) {
    scanText(line.rawText);
    if (line.continuationLines) {
      for (const cl of line.continuationLines) {
        scanText(cl);
      }
    }
  }

  return { forward, reverse };
}

// ---------------------------------------------------------------------------
// Text transformation
// ---------------------------------------------------------------------------

/**
 * Checks whether a forward/reverse map key is a bare domain name (no sigil).
 * Used to separate the two replacement strategies.
 */
function isBareKey(k: string): boolean {
  const c = k[0];
  return c !== '@' && c !== '#' && c !== '!' && c !== '$';
}

/**
 * Replace all original identifiers in `text` with their anonymized aliases.
 *
 * Two-phase strategy:
 * 1. One pass with `MATRIX_IDENTIFIER_RE` (a fixed, V8-JIT-optimizable pattern)
 *    to find all sigil-prefixed Matrix identifiers, then resolve via Map lookup.
 *    This avoids building a large alternation regex from dictionary keys, which
 *    causes V8 to fall back to slow interpreted NFA mode.
 * 2. Split/join for bare domain names (e.g. `matrix.org`) that can appear
 *    standalone in log text. There are typically very few (< 20) unique domains,
 *    so the linear-scan split/join cost is negligible. Sorted longest-first to
 *    prevent a shorter key from consuming a longer overlapping key.
 *
 * @example
 * ```ts
 * const dict = buildAnonymizationDictionary(lines);
 * applyAnonymization('@alice:example.org invited @bob:example.org', dict);
 * // '@user0:domain0.org invited @user1:domain0.org'
 * ```
 */
export function applyAnonymization(text: string, dict: AnonymizationDictionary): string {
  const { forward } = dict;
  if (Object.keys(forward).length === 0) return text;
  // Phase 1: sigil-prefixed identifiers via MATRIX_IDENTIFIER_RE + Map.
  MATRIX_IDENTIFIER_RE.lastIndex = 0;
  let result = text.replace(MATRIX_IDENTIFIER_RE, (m) => forward[m] ?? m);
  // Phase 2: bare domain names, longest-first to avoid partial clobbering.
  for (const [key, val] of Object.entries(forward)
    .filter(([k]) => isBareKey(k))
    .sort(([a], [b]) => b.length - a.length)) {
    if (result.includes(key)) result = result.split(key).join(val);
  }
  return result;
}

/**
 * Recover original identifiers from anonymized aliases in `text`.
 *
 * Uses the same two-phase strategy as `applyAnonymization`:
 * 1. A compact alias-candidate pattern finds all sigil-prefixed alias forms
 *    generated by `buildAnonymizationDictionary` (including short aliases like
 *    `!room0` and `$event0` that fall below `MATRIX_IDENTIFIER_RE`'s 10-char
 *    minimum for modern IDs).
 * 2. Split/join for bare domain alias names (`domain0.org`, etc.).
 *
 * @example
 * ```ts
 * applyUnanonymization('@user0:domain0.org', dict);
 * // '@alice:example.org'
 * ```
 */
export function applyUnanonymization(text: string, dict: AnonymizationDictionary): string {
  const { reverse } = dict;
  if (Object.keys(reverse).length === 0) return text;
  // Phase 1: sigil-prefixed aliases. The pattern splits on `:` so the local part
  // and server part are captured together via the optional `(?::[^\s]+)?` group.
  const candidateRe = /[@#!$][^\s:]+(?::[^\s]+)?/g;
  let result = text.replace(candidateRe, (m) => reverse[m] ?? m);
  // Phase 2: bare domain alias names.
  for (const [key, val] of Object.entries(reverse)
    .filter(([k]) => isBareKey(k))
    .sort(([a], [b]) => b.length - a.length)) {
    if (result.includes(key)) result = result.split(key).join(val);
  }
  return result;
}

/**
 * Compile a reusable text anonymizer from a dictionary. Precomputes all
 * derived structures once so the returned function is as cheap as possible
 * per invocation. Use this for batch processing (e.g. the full log).
 *
 * The compiled anonymizer uses the same two-phase strategy as
 * `applyAnonymization`: MATRIX_IDENTIFIER_RE scan + Map lookup for
 * sigil-prefixed identifiers, then split/join for bare domain names.
 *
 * @example
 * ```ts
 * const apply = buildCompiledAnonymizer(dict);
 * const anonLines = lines.map(l => apply(l.rawText));
 * ```
 */
export function buildCompiledAnonymizer(dict: AnonymizationDictionary): (text: string) => string {
  const { forward } = dict;
  if (Object.keys(forward).length === 0) return (text) => text;
  // Precompute bare-domain pairs once (sorted longest-first).
  const domainPairs = Object.entries(forward)
    .filter(([k]) => isBareKey(k))
    .sort(([a], [b]) => b.length - a.length) as Array<[string, string]>;
  // Fresh regex instance per compiled anonymizer so each closure owns its
  // own lastIndex state and they don't interfere with each other.
  const candidateRe = new RegExp(MATRIX_IDENTIFIER_RE.source, 'g');
  return (text: string): string => {
    let result = text.replace(candidateRe, (m) => forward[m] ?? m);
    for (const [key, val] of domainPairs) {
      if (result.includes(key)) result = result.split(key).join(val);
    }
    return result;
  };
}

/**
 * Compile a reusable text unanonymizer from a dictionary. Counterpart of
 * `buildCompiledAnonymizer` for restoring original identifiers.
 *
 * Uses a compact alias-candidate pattern instead of MATRIX_IDENTIFIER_RE so
 * that short aliases without a domain suffix (`!room0`, `$event0`) — which
 * fall below the 10-char minimum in the modern-ID patterns — are found
 * correctly.
 *
 * @example
 * ```ts
 * const restore = buildCompiledUnanonymizer(dict);
 * const origLines = anonLines.map(l => restore(l.rawText));
 * ```
 */
export function buildCompiledUnanonymizer(dict: AnonymizationDictionary): (text: string) => string {
  const { reverse } = dict;
  if (Object.keys(reverse).length === 0) return (text) => text;
  // Precompute bare domain alias pairs once.
  const domainAliasPairs = Object.entries(reverse)
    .filter(([k]) => isBareKey(k))
    .sort(([a], [b]) => b.length - a.length) as Array<[string, string]>;
  // Pattern: sigil + non-whitespace-non-colon local part + optional `:server` suffix.
  // Matches all alias forms produced by buildAnonymizationDictionary, including
  // short ones like !room0 and $event0 that have no domain component.
  // Stops at `/` so that URIs like `/_matrix/...rooms/!room0:domain0.org/messages`
  // are matched as `!room0:domain0.org`, not `!room0:domain0.org/messages`.
  const candidateRe = new RegExp('[@#!$][^\\s:]+(?::[^\\s/]+)?', 'g');
  return (text: string): string => {
    let result = text.replace(candidateRe, (m) => reverse[m] ?? m);
    for (const [key, val] of domainAliasPairs) {
      if (result.includes(key)) result = result.split(key).join(val);
    }
    return result;
  };
}

// ---------------------------------------------------------------------------
// Log-line transformers
// ---------------------------------------------------------------------------

/**
 * Return a new `ParsedLogLine` with all text fields anonymized according to
 * `dict`. Structural and numeric fields (`lineNumber`, all timestamp fields,
 * `level`, `filePath`, `sourceLineNumber`) are preserved unchanged.
 *
 * @example
 * ```ts
 * const anonLine = anonymizeLogLine(parsedLine, dict);
 * anonLine.rawText;                              // anonymized
 * anonLine.lineNumber === parsedLine.lineNumber; // true
 * ```
 */
export function anonymizeLogLine(line: ParsedLogLine, dict: AnonymizationDictionary): ParsedLogLine {
  return {
    ...line,
    rawText: applyAnonymization(line.rawText, dict),
    message: applyAnonymization(line.message, dict),
    strippedMessage: applyAnonymization(line.strippedMessage, dict),
    continuationLines: line.continuationLines?.map((cl) => applyAnonymization(cl, dict)),
  };
}

/**
 * Return a new `ParsedLogLine` with anonymized aliases restored to originals.
 *
 * Used when unanonymizing a log that was loaded from an already-anonymized file
 * (i.e., no in-memory backup of the original lines exists).
 */
export function unanonymizeLogLine(line: ParsedLogLine, dict: AnonymizationDictionary): ParsedLogLine {
  return {
    ...line,
    rawText: applyUnanonymization(line.rawText, dict),
    message: applyUnanonymization(line.message, dict),
    strippedMessage: applyUnanonymization(line.strippedMessage, dict),
    continuationLines: line.continuationLines?.map((cl) => applyUnanonymization(cl, dict)),
  };
}

// ---------------------------------------------------------------------------
// Marker detection
// ---------------------------------------------------------------------------

/**
 * Return true if `rawContent` was previously exported with the anonymization
 * marker. Only the first non-empty line is inspected.
 *
 * @example
 * ```ts
 * detectAnonymizedLog('# [rageshake-viewer-anonymized]\n2026-01-01T00:00:00Z INFO hello');
 * // true
 * detectAnonymizedLog('2026-01-01T00:00:00Z INFO hello');
 * // false
 * ```
 */
export function detectAnonymizedLog(rawContent: string): boolean {
  for (const line of rawContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed === ANONYMIZED_LOG_MARKER;
    }
  }
  return false;
}

/**
 * Strip the anonymization marker from `rawContent` so the remainder can be
 * parsed normally. Returns the content unchanged if the marker is absent.
 */
export function stripAnonymizedMarker(rawContent: string): string {
  const lf = ANONYMIZED_LOG_MARKER + '\n';
  if (rawContent.startsWith(lf)) return rawContent.slice(lf.length);
  const crlf = ANONYMIZED_LOG_MARKER + '\r\n';
  if (rawContent.startsWith(crlf)) return rawContent.slice(crlf.length);
  return rawContent;
}
