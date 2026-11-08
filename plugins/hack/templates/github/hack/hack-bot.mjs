// Hackathon kit bot.
// In GitHub Actions it relays human answers to blocked tasks, unblocks them and
// re-renders the pinned board issue. The `hack` CLI imports the same model code,
// so the board in the terminal and on GitHub always agree.
// Needs only node and the gh CLI (both preinstalled on GitHub runners).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MARK = '<!-- hack:';
export const LABEL = {
  task: 'task',
  bug: 'bug',
  question: 'question',
  blocked: 'blocked',
  progress: 'in-progress',
  radio: 'radio',
  board: 'board',
  high: 'prio-high',
  low: 'prio-low',
};

export function gh(args, { input, allowFail = false } = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (allowFail) return null;
    const detail = String(err.stderr || err.message || '').trim();
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${detail}`);
  }
}

export function ghJson(args, opts) {
  const out = gh(args, opts);
  if (out == null) return null;
  return out.trim() ? JSON.parse(out) : null;
}

export function listIssues() {
  const raw = ghJson([
    'issue', 'list', '--state', 'all', '--limit', '500',
    '--json', 'number,title,state,labels,assignees,body,createdAt,updatedAt,closedAt,url',
  ]) || [];
  return raw.map((i) => ({
    ...i,
    labels: i.labels.map((l) => l.name),
    assignees: i.assignees.map((a) => a.login),
  }));
}

// Splits an issue body into its "## Heading" sections (also "###", which issue forms use).
export function sections(body = '') {
  const out = {};
  let current = null;
  for (const line of String(body).split(/\r?\n/)) {
    const m = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (m) {
      current = m[1].toLowerCase();
      out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]));
}

export function dependsOn(issue) {
  const sec = sections(issue.body);
  const s = sec['depends on'] || sec['hängt ab von'] || '';
  return [...s.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

export function areas(issue) {
  const sec = sections(issue.body);
  const s = sec.area || sec.bereich || '';
  return s
    .split(/[\n,]+/)
    .map((x) => x.replace(/^[-*\s]+/, '').replace(/`/g, '').trim())
    .filter((x) => x && !/^_?no response_?$/i.test(x) && !/^(none|keine?r?|-|–|n\/a)$/i.test(x));
}

// Reads `<!-- hack:<kind> key=value ... -->` markers that the kit writes into issues and comments.
export function parseMarker(text, kind) {
  const m = String(text || '').match(new RegExp(`<!-- hack:${kind}\\b([^>]*?)-->`));
  if (!m) return null;
  const attrs = {};
  for (const [, k, v] of m[1].matchAll(/([\w-]+)=(\S+)/g)) attrs[k] = v;
  return attrs;
}

export function questionBlocks(q) {
  const meta = parseMarker(q.body, 'question') || {};
  return String(meta.blocks || '')
    .split(',')
    .map(Number)
    .filter(Boolean);
}

export function priority(i) {
  if (i.labels.includes(LABEL.high)) return 0;
  if (i.labels.includes(LABEL.low)) return 3;
  if (i.labels.includes(LABEL.bug)) return 1;
  return 2;
}

export function classify(issues) {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const res = {
    inProgress: [],
    blocked: [],
    waiting: [],
    ready: [],
    done: [],
    bugsOpen: [],
    questions: issues.filter((i) => i.state === 'OPEN' && i.labels.includes(LABEL.question)),
  };
  for (const i of issues) {
    if (!i.labels.includes(LABEL.task) && !i.labels.includes(LABEL.bug)) continue;
    if (i.state !== 'OPEN') {
      res.done.push(i);
      continue;
    }
    if (i.labels.includes(LABEL.bug)) res.bugsOpen.push(i);
    i.openDeps = dependsOn(i).filter((n) => byNumber.get(n)?.state === 'OPEN');
    if (i.labels.includes(LABEL.progress) || i.assignees.length) res.inProgress.push(i);
    else if (i.labels.includes(LABEL.blocked)) res.blocked.push(i);
    else if (i.openDeps.length) res.waiting.push(i);
    else res.ready.push(i);
  }
  res.ready.sort((a, b) => priority(a) - priority(b) || a.number - b.number);
  res.done.sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  return res;
}

export function renderBoard(c, prs = [], cfg = {}) {
  const tz = cfg.timezone || 'Europe/Berlin';
  const time = (d) =>
    new Date(d).toLocaleTimeString('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const open = c.inProgress.length + c.blocked.length + c.waiting.length + c.ready.length;
  const total = open + c.done.length;
  const pct = total ? Math.round((c.done.length / total) * 100) : 0;
  const filled = Math.round(pct / 10);
  const ref = (i) => `#${i.number} ${String(i.title).replace(/\|/g, '/')}`;
  const tag = (i) => (i.labels.includes(LABEL.bug) ? ' 🐞' : '') + (i.labels.includes(LABEL.high) ? ' ⚡' : '');
  const blockedBy = new Map();
  for (const q of c.questions) for (const n of questionBlocks(q)) blockedBy.set(n, q.number);

  const out = [
    '<!-- hack:board -->',
    '# 📊 Hackathon-Board',
    '',
    `**Fortschritt:** ${'▓'.repeat(filled)}${'░'.repeat(10 - filled)} ${c.done.length}/${total} Tasks fertig (${pct} %)`,
    `_Stand ${time(Date.now())} · aktualisiert sich bei jeder Änderung von selbst_`,
    '',
  ];

  if (c.questions.length) {
    out.push('## ❓ Fragen an euch', '');
    for (const q of c.questions) {
      const blocks = questionBlocks(q);
      out.push(`- ${ref(q)}${blocks.length ? ` → hält ${blocks.map((n) => `#${n}`).join(', ')} auf` : ''}`);
    }
    out.push('', '_Antwort einfach als Kommentar im Frage-Issue, ein Buchstabe reicht._', '');
  }

  out.push('## 🔨 In Arbeit', '');
  if (c.inProgress.length) {
    out.push('| Task | Wer | Letzte Aktivität |', '| --- | --- | --- |');
    for (const i of c.inProgress) {
      out.push(`| ${ref(i)}${tag(i)} | ${i.assignees.map((a) => `@${a}`).join(', ') || '–'} | ${time(i.updatedAt)} |`);
    }
  } else {
    out.push('_Gerade arbeitet niemand an einem Task._');
  }
  out.push('');

  out.push('## 📋 Bereit', '');
  if (c.ready.length) {
    c.ready.slice(0, 15).forEach((i, idx) => out.push(`${idx + 1}. ${ref(i)}${tag(i)}`));
    if (c.ready.length > 15) out.push(`_… und ${c.ready.length - 15} weitere_`);
  } else {
    out.push('_Nichts frei._');
  }
  out.push('');

  if (c.blocked.length) {
    out.push('## ⛔ Blockiert', '');
    for (const i of c.blocked) {
      const q = blockedBy.get(i.number);
      out.push(`- ${ref(i)}${q ? ` (wartet auf Antwort zu #${q})` : ''}`);
    }
    out.push('');
  }

  if (c.waiting.length) {
    out.push('## ⏳ Wartet auf andere Tasks', '');
    for (const i of c.waiting) out.push(`- ${ref(i)} (braucht ${i.openDeps.map((n) => `#${n}`).join(', ')})`);
    out.push('');
  }

  if (prs.length) {
    out.push('## 🔀 Offene Pull Requests', '');
    for (const p of prs) out.push(`- ${ref(p)}${p.isDraft ? ' (Entwurf)' : ''}`);
    out.push('');
  }

  out.push('## ✅ Fertig', '');
  if (c.done.length) {
    for (const i of c.done.slice(0, 12)) out.push(`- ${ref(i)} · ${time(i.closedAt)}`);
    if (c.done.length > 12) out.push(`_… und ${c.done.length - 12} weitere_`);
  } else {
    out.push('_Noch nichts._');
  }
  if (cfg.pagesUrl) out.push('', `🌐 Vorschau: ${cfg.pagesUrl} · Mockups: ${cfg.pagesUrl}mockups/`);
  out.push('');
  return out.join('\n');
}

export function publishBoard(issues, cfg = {}) {
  const board = issues.find((i) => i.state === 'OPEN' && i.labels.includes(LABEL.board));
  if (!board) return null;
  const prs = ghJson(['pr', 'list', '--state', 'open', '--json', 'number,title,isDraft']) || [];
  const body = renderBoard(classify(issues), prs, cfg);
  gh(['issue', 'edit', String(board.number), '--body-file', '-'], { input: body });
  return board.number;
}

function quote(text) {
  return String(text)
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n');
}

// A human comment on an open question counts as the answer. Agent comments carry a hack marker.
export function relayAnswers(repo, issues) {
  const questions = issues.filter((i) => i.state === 'OPEN' && i.labels.includes(LABEL.question));
  for (const q of questions) {
    const comments = ghJson(['api', `repos/${repo}/issues/${q.number}/comments?per_page=100`]) || [];
    const answer = comments.find((c) => !c.body.includes(MARK) && c.user.type !== 'Bot');
    if (!answer) continue;
    const blocks = questionBlocks(q);
    for (const n of blocks) {
      gh(['issue', 'comment', String(n), '--body',
        `<!-- hack:answer q=${q.number} -->\n💡 **Antwort auf #${q.number}** von @${answer.user.login}:\n\n${quote(answer.body)}`]);
    }
    const freed = blocks.length ? ` ${blocks.map((n) => `#${n}`).join(', ')} ist wieder frei.` : '';
    gh(['issue', 'comment', String(q.number), '--body', `<!-- hack:bot -->\n✅ Danke, die Antwort ist angekommen.${freed}`]);
    gh(['issue', 'close', String(q.number), '--reason', 'completed']);
    q.state = 'CLOSED';
  }

  // Unblock tasks whose questions are all closed. Tasks that a human blocked by hand
  // (no question points at them) stay blocked.
  const referenced = new Set();
  const stillBlocked = new Set();
  for (const q of issues.filter((i) => i.labels.includes(LABEL.question))) {
    for (const n of questionBlocks(q)) {
      referenced.add(n);
      if (q.state === 'OPEN') stillBlocked.add(n);
    }
  }
  for (const t of issues) {
    if (t.state !== 'OPEN' || !t.labels.includes(LABEL.blocked)) continue;
    if (referenced.has(t.number) && !stillBlocked.has(t.number)) {
      gh(['issue', 'edit', String(t.number), '--remove-label', LABEL.blocked]);
      t.labels = t.labels.filter((l) => l !== LABEL.blocked);
    }
  }
}

function main() {
  const repo = process.env.GH_REPO;
  if (!repo) throw new Error('GH_REPO is not set');
  const cfg = existsSync('hackathon.json') ? JSON.parse(readFileSync('hackathon.json', 'utf8')) : {};
  relayAnswers(repo, listIssues());
  const board = publishBoard(listIssues(), cfg);
  console.log(board ? `Board #${board} updated.` : 'No board issue found.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
