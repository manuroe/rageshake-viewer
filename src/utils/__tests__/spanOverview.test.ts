import { describe, it, expect } from 'vitest';
import { buildSpanOverview, type SpanNode } from '../spanOverview';
import { createParsedLogLine } from '../../test/fixtures';

const line = (tail: string) =>
  `2026-04-12T20:16:41.614Z DEBUG matrix_sdk::x: msg | crates/x/mod.rs:9 | spans: ${tail}`;

function child(node: SpanNode, name: string): SpanNode | undefined {
  return node.children.find((c) => c.name === name);
}

describe('buildSpanOverview', () => {
  it('nests lines under their span chain', () => {
    const tree = buildSpanOverview([
      createParsedLogLine({ lineNumber: 1, rawText: line('root > build'), filePath: 'crates/x/mod.rs', sourceLineNumber: 9 }),
    ]);
    const build = child(child(tree, 'root')!, 'build');
    expect(build?.path).toBe('root > build');
    expect(build?.leaves[0].location).toBe('crates/x/mod.rs:9');
  });

  it('keeps same-basename files under the same span as distinct leaves', () => {
    const tree = buildSpanOverview([
      createParsedLogLine({ lineNumber: 1, rawText: line('root'), filePath: 'crates/a/mod.rs', sourceLineNumber: 42 }),
      createParsedLogLine({ lineNumber: 2, rawText: line('root'), filePath: 'crates/b/mod.rs', sourceLineNumber: 42 }),
    ]);
    const root = child(tree, 'root')!;
    expect(root.leaves.map((l) => l.location).sort()).toEqual(['crates/a/mod.rs:42', 'crates/b/mod.rs:42']);
  });

  it('groups by span name (not fields) and rolls counts up the subtree', () => {
    const lines = [
      createParsedLogLine({ lineNumber: 1, level: 'ERROR', rawText: line('root > sync_once{conn_id="encryption"}') }),
      createParsedLogLine({ lineNumber: 2, level: 'WARN', rawText: line('root > sync_once{conn_id="room-list"}') }),
      createParsedLogLine({ lineNumber: 3, level: 'INFO', rawText: line('root > sync_once{conn_id="encryption"}') }),
    ];
    const tree = buildSpanOverview(lines);

    expect(tree.errorCount).toBe(1);
    expect(tree.warnCount).toBe(1);

    // All three collapse into one sync_once node despite differing conn_id.
    const root = child(tree, 'root')!;
    expect(root.children).toHaveLength(1);
    const syncOnce = child(root, 'sync_once')!;
    expect(syncOnce.errorCount).toBe(1);
    expect(syncOnce.warnCount).toBe(1);

    // ...but the distinct conn_id values surface as node metadata.
    const connId = syncOnce.fields.find((f) => f.key === 'conn_id');
    expect(connId?.values.sort()).toEqual(['encryption', 'room-list']);
    expect(connId?.truncated).toBe(false);
  });

  it('marks a high-cardinality field as truncated', () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      createParsedLogLine({ lineNumber: i + 1, rawText: line(`root > send{request_id="REQ-${i}"}`) }),
    );
    const send = child(child(buildSpanOverview(lines), 'root')!, 'send')!;
    const reqId = send.fields.find((f) => f.key === 'request_id')!;
    expect(reqId.truncated).toBe(true);
    expect(reqId.values.length).toBe(5);
  });

  it('buckets lines with no spans under "(no span)"', () => {
    const tree = buildSpanOverview([
      createParsedLogLine({ lineNumber: 1, level: 'ERROR', rawText: '2026-04-12T20:16:41Z ERROR matrix_sdk::x: boom | crates/x/mod.rs:9 |', filePath: 'crates/x/mod.rs', sourceLineNumber: 9 }),
    ]);
    const noSpan = child(tree, '(no span)');
    expect(noSpan?.errorCount).toBe(1);
    expect(noSpan?.leaves[0].location).toBe('crates/x/mod.rs:9');
  });
});
