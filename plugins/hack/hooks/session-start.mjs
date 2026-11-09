// SessionStart hook: in a hackathon kit repo, tells Claude where it stands before it touches code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findKitRoot, readJson, run } from '../lib/util.mjs';
import { describe, readNotices, readUsage, thresholds, worstWindow } from '../lib/usage.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // no input is fine
}
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = findKitRoot(cwd);
if (!root) process.exit(0);

const cfg = readJson(join(root, 'hackathon.json'), {});
const main = cfg.mainBranch || 'main';
const lines = [
  '[hackathon kit] This repo is built by several Claude Code agents at once (one per team member), coordinated through GitHub issues. Follow the kit rules in CLAUDE.md.',
  `Board: issue #${cfg.board} · team radio: #${cfg.radio}${cfg.pagesUrl ? ` · preview: ${cfg.pagesUrl}` : ''}`,
];

run('git', ['fetch', 'origin', '--quiet'], { cwd: root, allowFail: true, timeout: 8000 });
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, allowFail: true });
const behind = Number(run('git', ['rev-list', '--count', `HEAD..origin/${main}`], { cwd: root, allowFail: true }) || 0);
if (behind > 0) {
  lines.push(`Your branch "${branch}" is ${behind} commit(s) behind origin/${main}: run \`hack sync\` before changing code.`);
}

const held = run(
  'gh',
  ['issue', 'list', '--assignee', '@me', '--label', 'in-progress', '--state', 'open', '--json', 'number,title', '--jq', '.[] | "#\\(.number) \\(.title)"'],
  { cwd: root, allowFail: true, timeout: 8000 },
);
if (held) {
  lines.push(`You hold: ${held.split('\n').join('; ')}. Continue it, or hand it off with \`hack release <n> --note "..."\`.`);
}
const u = readUsage();
const w = worstWindow(u);
if (w) {
  const t = thresholds(cfg);
  const advice = w.pct >= t.handoff ? ' Almost used up: hand off instead of starting new work.' : '';
  lines.push(`Usage: ${describe(u, cfg.timezone)}.${advice}`);
}
const released = readNotices().released?.[root];
if (released && !released.acknowledged) {
  lines.push(`While you were paused by the usage limit, ${released.tasks.map((n) => `#${n}`).join(', ')} were released for teammates. Start with \`hack next\`.`);
}
const cli = process.env.CLAUDE_PLUGIN_ROOT ? ` (if \`hack\` is not found or fails to start: node "${process.env.CLAUDE_PLUGIN_ROOT}/bin/hack")` : '';
lines.push(`To work the board, run the /hack:work loop. CLI reference: \`hack help\`${cli}.`);
console.log(lines.join('\n'));
