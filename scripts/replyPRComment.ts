#!/usr/bin/env tsx

/**
 * Reply to a PR review comment via GitHub CLI.
 *
 * Usage:
 *   npm run pr:reply -- --comment-id <id> --message "<text>"
 *   npm run pr:reply -- --comment-id <id> --message "<text>" --dry-run
 *   npm run pr:reply -- --batch-file pr-replies-template.json
 *   npm run pr:reply -- --batch-file pr-replies-template.json --dry-run
 *
 * Tip: to reference the current commit automatically:
 *   npm run pr:reply -- --comment-id <id> --message "Fixed in $(git rev-parse HEAD)"
 */

import { execFileSync, execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const commitRefPattern = /\b([0-9a-f]{7,40})\b/gi;

type ReplyEndpointType = 'reviewCommentReply' | 'issueCommentCreate';

interface BatchReplyItem {
  commentId: string;
  sourceType?: 'reviewInline' | 'reviewBody' | 'issueComment';
  replyEndpointType?: ReplyEndpointType;
  message?: string;
  skip?: boolean;
  author?: string;
  file?: string;
  line?: number;
  commentUrl?: string;
}

interface BatchReplyFile {
  pr?: number;
  owner?: string;
  repo?: string;
  replies: BatchReplyItem[];
}

interface BatchReplyResult {
  commentId: string;
  endpointType: ReplyEndpointType;
  status: 'success' | 'failed' | 'skipped' | 'dry-run';
  attempts: number;
  error?: string;
}

interface SingleArgs {
  mode: 'single';
  commentId: string;
  message: string;
  dryRun: boolean;
}

interface BatchArgs {
  mode: 'batch';
  batchFile: string;
  dryRun: boolean;
  maxRetries: number;
  continueOnError: boolean;
  resultsFile: string;
}

function parseArgs(): SingleArgs | BatchArgs {
  const args = process.argv.slice(2);
  const batchFileIdx = args.indexOf('--batch-file');
  const commentIdIdx = args.indexOf('--comment-id');
  const messageIdx = args.indexOf('--message');
  const dryRun = args.includes('--dry-run');
  const maxRetriesIdx = args.indexOf('--max-retries');
  const failOnAnyError = args.includes('--fail-on-any-error');
  const resultsFileIdx = args.indexOf('--results-file');

  if (batchFileIdx !== -1 && args[batchFileIdx + 1]) {
    const maxRetriesRaw = maxRetriesIdx !== -1 ? Number(args[maxRetriesIdx + 1]) : 1;
    if (Number.isNaN(maxRetriesRaw) || maxRetriesRaw < 1) {
      console.error('❌ --max-retries must be a positive integer');
      process.exit(1);
    }

    return {
      mode: 'batch',
      batchFile: args[batchFileIdx + 1],
      dryRun,
      maxRetries: maxRetriesRaw,
      continueOnError: !failOnAnyError,
      resultsFile: resultsFileIdx !== -1 && args[resultsFileIdx + 1]
        ? args[resultsFileIdx + 1]
        : 'pr-reply-results.json',
    };
  }

  if (commentIdIdx === -1 || !args[commentIdIdx + 1]) {
    console.error('❌ Missing --comment-id <id> or --batch-file <path>');
    process.exit(1);
  }
  if (messageIdx === -1 || !args[messageIdx + 1]) {
    console.error('❌ Missing --message "<text>"');
    process.exit(1);
  }

  return {
    mode: 'single',
    commentId: args[commentIdIdx + 1],
    message: args[messageIdx + 1],
    dryRun,
  };
}

function resolveCommitSha(commitRef: string): string | null {
  try {
    return execSync(`git rev-parse --verify ${commitRef}^{commit}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function commitExistsOnRemote(owner: string, repo: string, sha: string, env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync('gh', ['api', `repos/${owner}/${repo}/commits/${sha}`], {
      stdio: 'pipe',
      env,
    });
    return true;
  } catch {
    return false;
  }
}

function linkifyCommitRefs(message: string, owner: string, repo: string, env: NodeJS.ProcessEnv): string {
  const matches = [...message.matchAll(commitRefPattern)];

  if (matches.length === 0) {
    return message;
  }

  const resolved = new Map<string, string>();

  for (const match of matches) {
    const rawRef = match[1];
    const key = rawRef.toLowerCase();
    if (resolved.has(key)) {
      continue;
    }

    const fullSha = resolveCommitSha(rawRef);
    if (!fullSha) {
      continue;
    }

    if (!commitExistsOnRemote(owner, repo, fullSha, env)) {
      throw new Error(
        `Commit ${rawRef} resolves to ${fullSha} locally but is not available on origin yet. Push it before replying.`,
      );
    }

    resolved.set(key, fullSha);
  }

  return message.replace(commitRefPattern, (match, commitRef: string) => {
    const fullSha = resolved.get(commitRef.toLowerCase());
    if (!fullSha) {
      return match;
    }
    return `[${match}](https://github.com/${owner}/${repo}/commit/${fullSha})`;
  });
}

function readBatchFile(batchFile: string): BatchReplyFile {
  try {
    const content = readFileSync(batchFile, 'utf-8');
    const parsed = JSON.parse(content) as BatchReplyFile & { batchReplyTemplate?: BatchReplyFile };
    const batch = parsed.batchReplyTemplate ?? parsed;

    if (!Array.isArray(batch.replies)) {
      throw new Error(`Invalid batch file ${batchFile}: expected "replies" array.`);
    }

    return batch;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error reading batch file "${batchFile}": ${message}`);
    process.exit(1);
    // Unreachable but satisfies TypeScript return type
    throw new Error('unreachable');
  }
}

function ensureRepoContext(batch: BatchReplyFile): { owner: string; repo: string; prNumber: string } {
  const owner = batch.owner ?? execSync('gh repo view --json owner -q .owner.login', { encoding: 'utf-8' }).trim();
  const repo = batch.repo ?? execSync('gh repo view --json name -q .name', { encoding: 'utf-8' }).trim();
  const prNumber = String(batch.pr ?? execSync('gh pr view --json number -q .number', { encoding: 'utf-8' }).trim());
  return { owner, repo, prNumber };
}

function buildIssueCommentBody(item: BatchReplyItem, message: string): string {
  const contextParts: string[] = [`Replying to comment ${item.commentId}`];
  if (item.author) {
    contextParts.push(`by @${item.author}`);
  }
  if (item.file && item.line) {
    contextParts.push(`at ${item.file}:${item.line}`);
  }
  if (item.commentUrl) {
    contextParts.push(`(${item.commentUrl})`);
  }

  return `${contextParts.join(' ')}\n\n${message}`;
}

function postReply(
  owner: string,
  repo: string,
  prNumber: string,
  item: BatchReplyItem,
  body: string,
  env: NodeJS.ProcessEnv,
): void {
  const endpointType: ReplyEndpointType = item.replyEndpointType
    ?? (item.sourceType === 'reviewInline' ? 'reviewCommentReply' : 'issueCommentCreate');

  if (endpointType === 'reviewCommentReply') {
    if (!/^\d+$/.test(String(item.commentId))) {
      throw new Error(`reviewCommentReply requires a numeric comment ID, got: ${item.commentId}`);
    }
    execFileSync(
      'gh',
      ['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments/${item.commentId}/replies`, '--raw-field', `body=${body}`],
      { stdio: 'pipe', env },
    );
    return;
  }

  execFileSync('gh', ['api', `repos/${owner}/${repo}/issues/${prNumber}/comments`, '--raw-field', `body=${body}`], {
    stdio: 'pipe',
    env,
  });
}

function writeResultsFile(resultsFile: string, results: BatchReplyResult[]): void {
  const payload = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      success: results.filter(result => result.status === 'success').length,
      failed: results.filter(result => result.status === 'failed').length,
      skipped: results.filter(result => result.status === 'skipped').length,
      dryRun: results.filter(result => result.status === 'dry-run').length,
    },
    results,
  };

  writeFileSync(join(process.cwd(), resultsFile), JSON.stringify(payload, null, 2));
}

function runSingleReply(args: SingleArgs): void {
  const env = { ...process.env };
  env['GH_PAGER'] = 'cat';

  const owner = execSync('gh repo view --json owner -q .owner.login', { encoding: 'utf-8' }).trim();
  const repo = execSync('gh repo view --json name -q .name', { encoding: 'utf-8' }).trim();
  const prNumber = execSync('gh pr view --json number -q .number', { encoding: 'utf-8' }).trim();
  const replyBody = linkifyCommitRefs(args.message, owner, repo, env);

  if (args.dryRun) {
    process.stdout.write(`🧪 Dry run: no reply posted for comment #${args.commentId}\n`);
    process.stdout.write('--- reply body preview ---\n');
    process.stdout.write(`${replyBody}\n`);
    return;
  }

  execFileSync(
    'gh',
    ['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments/${args.commentId}/replies`, '--raw-field', `body=${replyBody}`],
    {
      stdio: 'pipe',
      env,
    },
  );

  process.stdout.write(`✅ Reply posted to comment #${args.commentId}\n`);
}

function runBatchReplies(args: BatchArgs): void {
  const batch = readBatchFile(args.batchFile);
  const { owner, repo, prNumber } = ensureRepoContext(batch);
  const env = { ...process.env };
  env['GH_PAGER'] = 'cat';

  const results: BatchReplyResult[] = [];
  let hasFailures = false;

  for (const item of batch.replies) {
    const endpointType: ReplyEndpointType = item.replyEndpointType
      ?? (item.sourceType === 'reviewInline' ? 'reviewCommentReply' : 'issueCommentCreate');
    if (item.skip) {
      results.push({
        commentId: item.commentId,
        endpointType,
        status: 'skipped',
        attempts: 0,
      });
      continue;
    }

    if (!item.message || !item.message.trim()) {
      results.push({
        commentId: item.commentId,
        endpointType,
        status: 'failed',
        attempts: 0,
        error: 'Missing message in batch item',
      });
      hasFailures = true;
      if (!args.continueOnError) {
        break;
      }
      continue;
    }

    const linkedMessage = linkifyCommitRefs(item.message, owner, repo, env);
    const replyBody = endpointType === 'issueCommentCreate'
      ? buildIssueCommentBody(item, linkedMessage)
      : linkedMessage;

    if (args.dryRun) {
      results.push({
        commentId: item.commentId,
        endpointType,
        status: 'dry-run',
        attempts: 0,
      });
      continue;
    }

    let attempts = 0;
    let posted = false;
    let lastError = '';

    while (attempts < args.maxRetries && !posted) {
      attempts += 1;
      try {
        postReply(owner, repo, prNumber, item, replyBody, env);
        posted = true;
      } catch (error: unknown) {
        if (error !== null && typeof error === 'object') {
          const err = error as { message?: unknown; status?: unknown; stdout?: unknown; stderr?: unknown };
          const parts: string[] = [];
          if (typeof err.message === 'string' && err.message.length > 0) {
            parts.push(`message=${err.message}`);
          }
          if (err.status !== undefined) {
            parts.push(`status=${String(err.status)}`);
          }
          if (err.stdout) {
            const stdout = String(err.stdout).trim();
            if (stdout) {
              parts.push(`stdout=${stdout}`);
            }
          }
          if (err.stderr) {
            const stderr = String(err.stderr).trim();
            if (stderr) {
              parts.push(`stderr=${stderr}`);
            }
          }
          lastError = parts.length > 0 ? parts.join('; ') : String(error);
        } else {
          lastError = String(error);
        }
      }
    }

    if (posted) {
      results.push({
        commentId: item.commentId,
        endpointType,
        status: 'success',
        attempts,
      });
      process.stdout.write(`✅ Reply posted to comment #${item.commentId}\n`);
      continue;
    }

    hasFailures = true;
    results.push({
      commentId: item.commentId,
      endpointType,
      status: 'failed',
      attempts,
      error: lastError,
    });
    console.error(`❌ Failed to reply to comment #${item.commentId}: ${lastError}`);
    if (!args.continueOnError) {
      break;
    }
  }

  writeResultsFile(args.resultsFile, results);
  process.stdout.write(`📄 Batch results saved to ${args.resultsFile}\n`);

  if (hasFailures) {
    process.exit(1);
  }
}

function main() {
  const args = parseArgs();
  if (args.mode === 'single') {
    runSingleReply(args);
    return;
  }

  runBatchReplies(args);
}

main();
