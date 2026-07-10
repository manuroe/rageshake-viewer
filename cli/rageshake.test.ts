import { describe, it, expect } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import { buildTar } from '../src/utils/tarWriter';
import { ingest, cmdPrecheck, cmdSummary, cmdGrep, cmdSlice, cmdOverview, run } from './rageshake';

const RAW_LOG = [
  '2026-01-15T10:00:00.000000Z  INFO [matrix-rust-sdk] Sentry configured (enabled: true)',
  '2026-01-15T10:00:01.000000Z ERROR [matrix-rust-sdk] Failed to send to @alice:example.org in !abc123defg456:example.org',
  '2026-01-15T10:00:02.000000Z  WARN [matrix-rust-sdk] retry scheduled',
].join('\n');

const ANON_LOG = [
  '# [rageshake-viewer-anonymized]',
  '2026-01-15T10:00:00.000000Z  INFO [matrix-rust-sdk] Sentry configured (enabled: true)',
  '2026-01-15T10:00:01.000000Z ERROR [matrix-rust-sdk] Failed to send to @user-0123456789ab:domain-01234567.org in !room-0123456789ab:domain-01234567.org',
  '2026-01-15T10:00:02.000000Z  WARN [matrix-rust-sdk] retry scheduled',
].join('\n');

const DETAILS = JSON.stringify({
  user_text: 'App crashed on launch',
  data: { user_id: '@user-0123456789ab:domain-01234567.org', Version: '25.1.0', sdk_sha: 'abc1234' },
});

function buildArchive(logText: string): Uint8Array {
  return gzipSync(buildTar([
    { name: 'details.json', data: strToU8(DETAILS) },
    { name: 'console.2026-01-15-10.log.gz', data: gzipSync(strToU8(logText)) },
  ]));
}

describe('rageshake CLI', () => {
  it('precheck fails on raw identifiers and passes on anonymized archive', () => {
    const raw = cmdPrecheck(ingest(buildArchive(RAW_LOG), 'raw.tar.gz'));
    expect(raw.ok).toBe(false);
    expect(raw.report).toContain('user-id');

    const anon = cmdPrecheck(ingest(buildArchive(ANON_LOG), 'anon.tar.gz'));
    expect(anon.ok).toBe(true);
  });

  it('precheck fails when no anonymization evidence exists', () => {
    const bytes = strToU8('2026-01-15T10:00:00.000000Z INFO nothing identifiable here');
    expect(cmdPrecheck(ingest(bytes, 'plain.log')).ok).toBe(false);
  });

  it('summary reports details.json fields and per-file counts', () => {
    const summary = JSON.parse(cmdSummary(ingest(buildArchive(ANON_LOG), 'anon.tar.gz')));
    expect(summary.details.userText).toBe('App crashed on launch');
    expect(summary.details.version).toBe('25.1.0');
    expect(summary.details.sdkSha).toBe('abc1234');
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0].name).toBe('console.2026-01-15-10.log.gz');
    expect(summary.files[0].errors).toBe(1);
    expect(summary.totals.warnings).toBe(1);
    expect(summary.lifecycle.lastColdStart).toContain('2026-01-15T10:00:00');
  });

  it('grep finds matching lines with line numbers', () => {
    const out = cmdGrep(ingest(buildArchive(ANON_LOG), 'anon.tar.gz'), 'retry scheduled', {});
    expect(out).toContain('# 1 matching lines');
    expect(out).toContain('WARN');
    expect(out).toContain('retry scheduled');
  });

  it('grep rejects a malformed --from timestamp instead of treating it as epoch', () => {
    const ing = ingest(buildArchive(ANON_LOG), 'anon.tar.gz');
    expect(() => cmdGrep(ing, 'retry', { from: 'not-a-date' })).toThrow(/invalid --from/);
  });

  it('distinguishes no matches from an offset past the end', () => {
    const ing = ingest(buildArchive(ANON_LOG), 'anon.tar.gz');
    expect(cmdGrep(ing, 'no-such-text-anywhere', {})).toContain('# no matching lines');
    // "retry scheduled" matches one line; offset 5 is past the single match.
    expect(cmdGrep(ing, 'retry scheduled', { offset: '5' })).toContain('past the end');
  });

  it('does not report phantom gaps for timestamp-interleaved merged logs', () => {
    // Two processes whose lines interleave in time: after merge the array is
    // timestamp-ordered but per-file lineNumbers are not, so a lineNumber-delta
    // gap would fire between adjacent merged entries. Index-delta must not.
    const consoleLog = [
      '# [rageshake-viewer-anonymized]',
      '2026-01-15T10:00:00.000000Z INFO [matrix-rust-sdk] console line one',
      '2026-01-15T10:00:02.000000Z INFO [matrix-rust-sdk] console line two',
    ].join('\n');
    const nseLog = [
      '# [rageshake-viewer-anonymized]',
      '2026-01-15T10:00:01.000000Z INFO [matrix-rust-sdk] nse line one',
    ].join('\n');
    const archive = gzipSync(buildTar([
      { name: 'console.2026-01-15-10.log.gz', data: gzipSync(strToU8(consoleLog)) },
      { name: 'nse.2026-01-15-10.log.gz', data: gzipSync(strToU8(nseLog)) },
    ]));
    const out = cmdSlice(ingest(archive, 'merged.tar.gz'), {});
    expect(out).not.toMatch(/\.\.\. \d+ lines \.\.\./);
  });

  it('applies --offset to overview tree output', () => {
    const ing = ingest(buildArchive(ANON_LOG), 'anon.tar.gz');
    const full = cmdOverview(ing, {});
    const offset = cmdOverview(ing, { limit: '1', offset: '1' });
    // First body node of the full tree must be gone once we skip it.
    const firstNode = full.split('\n').find((l) => !l.startsWith('#'));
    expect(firstNode).toBeDefined();
    expect(offset.split('\n')).not.toContain(firstNode);
  });

  it('run returns usage on missing args', () => {
    expect(run([]).code).toBe(2);
    expect(run([]).output).toContain('Commands:');
  });
});
