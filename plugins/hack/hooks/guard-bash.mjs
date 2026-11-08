// PreToolUse guard for Bash in hackathon kit repos:
// - commit messages must be Conventional Commits (and carry no AI attribution unless allowed)
// - no pushes to main, no plain force pushes
// - issue/PR writes go through the hack CLI so the board stays consistent
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVENTIONAL, CONVENTIONAL_HINT, currentBranch, findKitRoot, readJson } from '../lib/util.mjs';

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  );
  process.exit(0);
}

// Reads one shell word starting at s[i]; understands "...", '...', and "$(cat <<'EOF' ... EOF)".
function readWord(s, i) {
  while (s[i] === ' ' || s[i] === '\t') i++;
  const rest = s.slice(i);
  const heredoc = rest.match(/^"?\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\s*\n?\s*\)"?/);
  if (heredoc) return heredoc[2];
  if (s[i] === '"') {
    let out = '';
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\' && j + 1 < s.length) {
        out += s[++j];
      } else if (s[j] === '"') {
        return out;
      } else {
        out += s[j];
      }
    }
    return out;
  }
  if (s[i] === "'") {
    const end = s.indexOf("'", i + 1);
    return s.slice(i + 1, end === -1 ? undefined : end);
  }
  return (rest.match(/^[^\s;&|]+/) || [''])[0];
}

function commitMessages(cmd) {
  const msgs = [];
  const re = /\bgit\s+(?:-[cC]\s+\S+\s+)*commit\b/g;
  let m;
  while ((m = re.exec(cmd))) {
    const tail = cmd.slice(m.index + m[0].length);
    const flag = tail.match(/(?:^|\s)(?:-m|--message)(?:=|\s+)|(?:^|\s)-[a-zA-Z]*m(?=\s)/);
    if (!flag) continue;
    const separator = tail.search(/&&|\|\||;|\n/);
    if (separator !== -1 && separator < flag.index) continue; // the flag belongs to a later command
    msgs.push(readWord(tail, flag.index + flag[0].length));
  }
  return msgs;
}

function checkCommit(cmd, cfg) {
  for (const msg of commitMessages(cmd)) {
    const subject = msg.split('\n')[0].trim();
    if (!CONVENTIONAL.test(subject)) {
      deny(`Commit message must follow Conventional Commits: ${CONVENTIONAL_HINT} Got: "${subject}". Rewrite the message and commit again.`);
    }
    if (subject.length > 100) deny(`Commit subject is ${subject.length} characters; keep it under 72.`);
  }
  const attribution = /(co-authored-by:.*(claude|anthropic))|(generated with \[?claude)/i;
  if (!cfg.allowAiAttribution && /\bgit\b[^\n]*\bcommit\b/.test(cmd) && attribution.test(cmd)) {
    deny('This repo does not use AI attribution lines in commits (hackathon.json allowAiAttribution is false). Remove the trailer and commit again.');
  }
}

function checkPush(cmd, cfg, cwd) {
  const main = cfg.mainBranch || 'main';
  const re = /\bgit\s+(?:-C\s+\S+\s+)?push\b([^\n;&|]*)/g;
  let m;
  while ((m = re.exec(cmd))) {
    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
    const flags = tokens.filter((t) => t.startsWith('-'));
    const positional = tokens.filter((t) => !t.startsWith('-'));
    const force = flags.some((f) => f === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(f));
    if (force && !flags.some((f) => f.startsWith('--force-with-lease'))) {
      deny('Plain force pushes are blocked here. Use --force-with-lease on your own task branch (hack ship does this for you).');
    }
    if (flags.some((f) => f === '--all' || f === '--mirror')) deny('Pushing all branches is blocked. Push your task branch only.');
    const refspecs = positional.slice(1);
    const branch = currentBranch(cwd);
    const targets = refspecs.length
      ? refspecs.map((r) => {
          const dst = (r.includes(':') ? r.split(':').pop() : r).replace(/^\+/, '').replace(/^refs\/heads\//, '');
          return dst === 'HEAD' ? branch : dst;
        })
      : [branch];
    if (targets.includes(main)) {
      deny(`Never push to ${main}. Work on a task branch and ship it with \`hack ship <issue>\` (PR, CI, squash merge).`);
    }
  }
}

function checkGhWrites(cmd) {
  const m = cmd.match(/\bgh\s+(issue\s+(?:create|comment)|pr\s+(?:create|merge|comment))\b/);
  if (!m) return;
  const hint = {
    'issue create': 'Create tasks with `hack task create ...` (or `--bug`), questions with `hack ask ...`.',
    'issue comment': 'Comment with `hack say <issue|radio> "..."` so other agents can tell it apart from human answers.',
    'pr create': 'Open PRs with `hack ship <issue>`.',
    'pr merge': 'Merge with `hack ship <issue>`; it waits for green CI.',
    'pr comment': 'Use `hack say <issue> "..."` on the task instead.',
  }[m[1].replace(/\s+/g, ' ')];
  deny(`In this repo, GitHub writes go through the hack CLI. ${hint}`);
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
const cmd = String(input.tool_input?.command || '');
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = findKitRoot(cwd);
if (!root || !cmd) process.exit(0);
const cfg = readJson(join(root, 'hackathon.json'), {});

checkGhWrites(cmd);
checkCommit(cmd, cfg);
checkPush(cmd, cfg, cwd);
process.exit(0);
