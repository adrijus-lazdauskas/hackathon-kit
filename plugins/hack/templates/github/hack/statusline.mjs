// Status line for hackathon kit repos.
// Records the subscription usage limits Claude Code passes to status lines, so the kit's hooks
// can warn the agent before the limit runs out. Shows your own status line (from your user
// settings) unchanged and adds a short usage badge.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = process.env.HACK_CACHE_DIR || join(homedir(), '.cache', 'hackathon-kit');
const WARN_AT = 80;

let raw = '';
let data = {};
try {
  raw = readFileSync(0, 'utf8');
  data = JSON.parse(raw || '{}');
} catch {
  // keep going with an empty object
}

const limits = data.rate_limits || {};
const windows = {
  five_hour: limits.five_hour || null,
  seven_day: limits.seven_day || null,
};
if (windows.five_hour || windows.seven_day) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, 'usage.json'), JSON.stringify({ updatedAt: Date.now(), ...windows }));
  } catch {
    // a status line must never fail
  }
}

function badge() {
  const parts = [];
  const now = Date.now() / 1000;
  for (const [key, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const w = windows[key];
    if (!w || typeof w.used_percentage !== 'number' || (w.resets_at && w.resets_at < now)) continue;
    parts.push(`${label} ${Math.round(w.used_percentage)}%`);
  }
  return parts.join(' · ');
}

function userStatusLine() {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const own = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).statusLine;
    if (!own?.command || own.command.includes('.github/hack/statusline')) return '';
    const r = spawnSync(own.command, { shell: true, input: raw, encoding: 'utf8', timeout: 5000 });
    return String(r.stdout || '').replace(/\n+$/, '');
  } catch {
    return '';
  }
}

const own = userStatusLine();
const usage = badge();
const high = [windows.five_hour, windows.seven_day].some((w) => w && w.used_percentage >= WARN_AT);
if (own) {
  process.stdout.write(high && usage ? `${own} · ⚠ ${usage}\n` : `${own}\n`);
} else {
  process.stdout.write(`hack · ${usage ? `${high ? '⚠ ' : ''}Kontingent ${usage}` : 'Kontingent: noch keine Daten'}\n`);
}
