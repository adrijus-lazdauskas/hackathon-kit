// PostToolUse hook: tells the agent when the subscription usage limit gets close, so it can
// hand its task off cleanly, and reports a task the limit hook released while it was paused.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findKitRoot, readJson } from '../lib/util.mjs';
import { describe, fmtIn, fmtReset, readNotices, readUsage, thresholds, worstWindow, writeNotices } from '../lib/usage.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const root = findKitRoot(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (!root) process.exit(0);

const cfg = readJson(join(root, 'hackathon.json'), {});
const tz = cfg.timezone || 'Europe/Berlin';
const t = thresholds(cfg);
const notices = readNotices();
const session = String(input.session_id || 'unknown');
const messages = [];

// 1. A task was released by the limit hook while this agent waited for the reset.
const released = notices.released?.[root];
if (released && !released.acknowledged) {
  messages.push(
    `[hackathon kit] While you waited for the usage limit, your task(s) ${released.tasks.map((n) => `#${n}`).join(', ')} were released so teammates could continue (work pushed to ${released.branches.join(', ') || 'the task branch'}). Don't keep editing them blindly: run \`hack next\`. It gives you a free task, possibly the same one if nobody took it, and checks out the latest branch.`,
  );
  released.acknowledged = true;
}

// 2. Usage warnings, once per level and window, the hand-off one repeated every 10 minutes.
const usage = readUsage();
const w = worstWindow(usage);
if (w && w.pct >= t.warn) {
  const s = (notices.sessions ||= {})[session] || {};
  const windowKey = `${w.key}:${w.resetsAt}`;
  const reset = `${fmtReset(w.resetsAt, tz)}, in ${fmtIn(w.resetsAt)}`;
  if (w.pct >= t.handoff) {
    if (!s.handoffAt || Date.now() - s.handoffAt > 10 * 60000 || s.handoffWindow !== windowKey) {
      messages.push(
        `[hackathon kit] Usage: ${describe(usage, tz)}. Your ${w.label} limit is almost used up (resets ${reset}). Stop starting new work. Finish only the step you are in, commit and push, then either \`hack ship <n>\` if the task is done and checks pass, or \`hack release <n> --note "<done / next / gotchas>"\` so a teammate's agent continues. Then run \`hack pause\` (repeat it until it says the limit has reset) and carry on with the work loop.`,
      );
      s.handoffAt = Date.now();
      s.handoffWindow = windowKey;
    }
  } else if (s.warnWindow !== windowKey) {
    messages.push(
      `[hackathon kit] Usage: ${describe(usage, tz)}. Plan to finish your current task soon and don't start a large one; commit and push often. At ${t.handoff}% you will be asked to hand off.`,
    );
    s.warnWindow = windowKey;
  }
  notices.sessions[session] = s;
}

if (!messages.length) process.exit(0);
writeNotices(notices);
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: messages.join('\n\n') } }),
);
