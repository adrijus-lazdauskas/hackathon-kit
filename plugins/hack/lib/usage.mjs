// Reads the usage limits that the kit's status line records, and keeps small notice state.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CACHE_DIR = process.env.HACK_CACHE_DIR || join(homedir(), '.cache', 'hackathon-kit');
const USAGE_FILE = join(CACHE_DIR, 'usage.json');
const NOTICE_FILE = join(CACHE_DIR, 'notices.json');

// hackathon.json sets the team defaults; HACK_USAGE_WARN_AT / HACK_USAGE_HANDOFF_AT override them
// for one agent, e.g. to see the hand-off in a test run without burning the whole limit.
export function thresholds(cfg = {}) {
  const u = cfg.usage || {};
  const env = (name) => (process.env[name] ? Number(process.env[name]) : undefined);
  const handoff = env('HACK_USAGE_HANDOFF_AT') ?? Number(u.handoffAt ?? 92);
  return {
    // The hand-off check sits inside the warning check, so the warning must not come later.
    warn: Math.min(env('HACK_USAGE_WARN_AT') ?? Number(u.warnAt ?? 80), handoff),
    handoff,
    releaseIfResetInMin: Number(u.releaseIfResetInMin ?? 15),
  };
}

// Returns { updatedAt, windows: [{ key, label, pct, resetsAt }] } with expired windows dropped,
// or null when there is no recent data (the status line has not run lately).
export function readUsage({ maxAgeMin = 20 } = {}) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return null;
  }
  if (!raw.updatedAt || Date.now() - raw.updatedAt > maxAgeMin * 60000) return null;
  const windows = [];
  for (const [key, label] of [['five_hour', '5-hour'], ['seven_day', 'weekly']]) {
    const w = raw[key];
    if (!w || typeof w.used_percentage !== 'number') continue;
    const resetsAt = w.resets_at ? w.resets_at * 1000 : null;
    if (resetsAt && resetsAt < Date.now()) continue;
    windows.push({ key, label, pct: w.used_percentage, resetsAt });
  }
  return { updatedAt: raw.updatedAt, windows };
}

export function worstWindow(usage) {
  if (!usage?.windows.length) return null;
  return [...usage.windows].sort((a, b) => b.pct - a.pct)[0];
}

export function fmtReset(ms, tz = 'Europe/Berlin') {
  if (!ms) return 'unknown';
  const d = new Date(ms);
  const opts = { timeZone: tz, hour: '2-digit', minute: '2-digit' };
  if (ms - Date.now() > 20 * 3600000) opts.weekday = 'short';
  return d.toLocaleString('de-DE', opts);
}

export function minutesUntil(ms) {
  return ms ? Math.max(0, Math.round((ms - Date.now()) / 60000)) : null;
}

export function fmtIn(ms) {
  const m = minutesUntil(ms);
  if (m === null) return 'unknown';
  if (m < 90) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

export function describe(usage, tz) {
  if (!usage?.windows.length) return 'no usage data yet (the kit status line has not reported limits)';
  return usage.windows
    .map((w) => `${w.label} limit ${Math.round(w.pct)}% (resets ${fmtReset(w.resetsAt, tz)}, in ${fmtIn(w.resetsAt)})`)
    .join(' · ');
}

export function readNotices() {
  try {
    return JSON.parse(readFileSync(NOTICE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeNotices(n) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(NOTICE_FILE, JSON.stringify(n));
  } catch {
    // notices are best effort
  }
}
