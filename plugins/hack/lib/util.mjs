// Small helpers shared by the hack CLI and the hooks: git, repo discovery, config, state.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class HackError extends Error {}

export const CONVENTIONAL =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: \S.*/;
export const CONVENTIONAL_HINT =
  'type(scope): summary, e.g. "feat(map): add marker clustering". Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.';

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function run(cmd, args, { cwd, allowFail = false, input, timeout } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', input, timeout, maxBuffer: 64 * 1024 * 1024 });
  if (r.error && !allowFail) throw new HackError(`${cmd} could not run: ${r.error.message}`);
  if (r.status !== 0) {
    if (allowFail) return null;
    const detail = String(r.stderr || r.stdout || '').trim();
    throw new HackError(`${cmd} ${args.join(' ')} failed:\n${detail}`);
  }
  return String(r.stdout).trim();
}

export const git = (args, opts = {}) => run('git', args, opts);

// Walks up from `start` until it finds a hackathon.json (the marker of a kit repo).
export function findKitRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'hackathon.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function gitRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true });
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

// Local, per-clone state (agent id, inbox watermark). Lives inside .git so it is never committed.
export function statePath(root) {
  const common = git(['rev-parse', '--git-common-dir'], { cwd: root });
  return join(resolve(root, common), 'hack-state.json');
}

export function loadState(root) {
  return readJson(statePath(root), {});
}

export function saveState(root, state) {
  writeJson(statePath(root), state);
}

export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, allowFail: true });
}

export function slugify(text, max = 40) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function oneLine(text, max = 240) {
  const s = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function minutesSince(iso) {
  return (Date.now() - Date.parse(iso)) / 60000;
}
