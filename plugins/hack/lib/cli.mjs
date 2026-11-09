// The `hack` command: everything an agent (or a human) needs to work the shared board.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as model from '../templates/github/hack/hack-bot.mjs';
import {
  CONVENTIONAL,
  CONVENTIONAL_HINT,
  HackError,
  currentBranch,
  findKitRoot,
  git,
  gitRoot,
  loadState,
  minutesSince,
  oneLine,
  readJson,
  run,
  saveState,
  sleep,
  slugify,
  writeJson,
} from './util.mjs';
import * as usage from './usage.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(KIT_ROOT, 'templates');
const MARKETPLACE_REPO = process.env.HACK_MARKETPLACE_REPO || 'adrijus-lazdauskas/hackathon-kit';
const IGNORED_CHECKS = new Set(['hack-bot', 'preview']);
const { gh, ghJson, LABEL } = model;

const LABELS = [
  [LABEL.task, '1f6feb', 'Work item for the agents'],
  [LABEL.bug, 'd73a4a', 'Something is broken'],
  [LABEL.question, 'd876e3', 'Question for the humans'],
  [LABEL.blocked, 'b60205', 'Waits for an answer from the humans'],
  [LABEL.progress, 'fbca04', 'Claimed by an agent'],
  [LABEL.radio, '0e8a16', 'Team channel for agents and humans'],
  [LABEL.board, '5319e7', 'Live status board'],
  [LABEL.high, 'e99695', 'Do this first'],
  [LABEL.low, 'c5def5', 'Nice to have'],
];

const TEMPLATE_FILES = [
  // [template, target, mode] - "kit" files are always refreshed, "seed" files only written when missing.
  ['github/workflows/hack-bot.yml', '.github/workflows/hack-bot.yml', 'kit'],
  ['github/hack/hack-bot.mjs', '.github/hack/hack-bot.mjs', 'kit'],
  ['github/hack/statusline.mjs', '.github/hack/statusline.mjs', 'kit'],
  ['github/workflows/ci.yml', '.github/workflows/ci.yml', 'seed'],
  ['github/workflows/preview.yml', '.github/workflows/preview.yml', 'seed'],
  ['github/ISSUE_TEMPLATE/task.yml', '.github/ISSUE_TEMPLATE/task.yml', 'seed'],
  ['github/ISSUE_TEMPLATE/bug.yml', '.github/ISSUE_TEMPLATE/bug.yml', 'seed'],
  ['gitattributes', '.gitattributes', 'seed'],
];

const ALLOW_RULES = [
  'Bash(hack)', 'Bash(hack *)',
  'Bash(git status)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(git switch *)', 'Bash(git checkout *)',
  'Bash(git fetch *)', 'Bash(git pull *)', 'Bash(git rebase *)', 'Bash(git push *)',
  'Bash(git stash *)', 'Bash(git branch *)', 'Bash(git restore *)',
  'Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(node *)',
  'Bash(gh issue view *)', 'Bash(gh issue list *)', 'Bash(gh pr view *)', 'Bash(gh pr checks *)',
  'Bash(gh pr diff *)', 'Bash(gh run view *)', 'Bash(gh run list *)',
];

const LANGUAGE_NAMES = { de: 'German', en: 'English' };
const STATUSLINE_COMMAND = 'node .github/hack/statusline.mjs';

// ---------- small helpers ----------

const out = (...lines) => console.log(lines.join('\n'));

function parseArgs(argv, { booleans = [], repeat = [] } = {}) {
  const res = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      res._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      let [k, v] = a.slice(2).split(/=(.*)/s, 2);
      if (v === undefined) {
        if (booleans.includes(k)) v = true;
        else {
          v = argv[++i];
          if (v === undefined) throw new HackError(`--${k} needs a value`);
        }
      }
      if (repeat.includes(k)) (res[k] ||= []).push(v);
      else res[k] = v;
    } else {
      res._.push(a);
    }
  }
  return res;
}

function num(x) {
  const n = Number(String(x || '').replace(/^#/, ''));
  if (!Number.isInteger(n) || n <= 0) throw new HackError(`"${x}" is not an issue number`);
  return n;
}

let ctx = null;
function kit() {
  if (ctx) return ctx;
  const root = findKitRoot();
  if (!root) throw new HackError('This is not a hackathon kit repo (no hackathon.json found). Run `hack init` in the repo root first.');
  process.chdir(root);
  const cfg = readJson(join(root, 'hackathon.json'), {});
  ctx = { root, cfg, main: cfg.mainBranch || 'main', state: loadState(root) };
  return ctx;
}

function saveCtxState() {
  if (ctx) saveState(ctx.root, ctx.state);
}

// GitHub logins with access to the repo; withInvites adds people who were invited but have not accepted yet.
function collaboratorLogins(repo, { withInvites = false } = {}) {
  const lines = [gh(['api', `repos/${repo}/collaborators`, '--jq', '.[].login'], { allowFail: true })];
  if (withInvites) lines.push(gh(['api', `repos/${repo}/invitations`, '--jq', '.[].invitee.login'], { allowFail: true }));
  return [
    ...new Set(
      lines
        .join('\n')
        .split('\n')
        .map((t) => t.trim())
        .filter((t) => t && !t.endsWith('[bot]')),
    ),
  ];
}

function repoName() {
  const c = kit();
  if (!c.state.repo) {
    c.state.repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
    saveCtxState();
  }
  return c.state.repo;
}

function login() {
  const c = ctx || { state: {} };
  if (!c.state.login) {
    c.state.login = gh(['api', 'user', '--jq', '.login']).trim();
    if (ctx) saveCtxState();
  }
  return c.state.login;
}

const agentId = () => process.env.HACK_AGENT || login();
const staleMinutes = (cfg) => Number(process.env.HACK_STALE_MINUTES || cfg.staleMinutes || 45);

function isDirty() {
  return Boolean(git(['status', '--porcelain']));
}

function issueView(n) {
  const i = ghJson(['issue', 'view', String(n), '--json', 'number,title,state,labels,assignees,body,url']);
  return { ...i, labels: i.labels.map((l) => l.name), assignees: i.assignees.map((a) => a.login) };
}

function editIssue(n, { addLabels = [], removeLabels = [], addAssignees = [], removeAssignees = [] }) {
  const cur = issueView(n);
  const args = ['issue', 'edit', String(n)];
  for (const l of addLabels) if (!cur.labels.includes(l)) args.push('--add-label', l);
  for (const l of removeLabels) if (cur.labels.includes(l)) args.push('--remove-label', l);
  for (const a of addAssignees) args.push('--add-assignee', a);
  for (const a of removeAssignees) {
    const who = a === '@me' ? login() : a;
    if (cur.assignees.includes(who)) args.push('--remove-assignee', who);
  }
  if (args.length > 3) gh(args);
}

function comment(n, body) {
  gh(['issue', 'comment', String(n), '--body-file', '-'], { input: body });
}

function remoteTaskBranches() {
  const raw = git(['for-each-ref', '--format=%(refname:short)|%(committerdate:iso-strict)', 'refs/remotes/origin'], {
    allowFail: true,
  });
  return (raw || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, date] = line.split('|');
      const m = ref.match(/\/(\d+)-[^/]*$/);
      return m ? { ref, date, number: Number(m[1]) } : null;
    })
    .filter(Boolean);
}

function findTaskBranch(n) {
  return remoteTaskBranches().find((b) => b.number === n) || null;
}

function lastActivityMinutes(issue) {
  const branch = findTaskBranch(issue.number);
  const times = [minutesSince(issue.updatedAt)];
  if (branch) times.push(minutesSince(branch.date));
  return Math.min(...times);
}

function aheadOfMain() {
  const { main } = kit();
  return Number(git(['rev-list', '--count', `origin/${main}..HEAD`], { allowFail: true }) || 0);
}

function pushCurrent() {
  git(['push', '--force-with-lease', '-u', 'origin', 'HEAD']);
  return currentBranch();
}

function stripMarkers(text) {
  return String(text || '').replace(/<!--[\s\S]*?-->\n?/g, '').trim();
}

// ---------- claims ----------

function claim(n, { takeover = false } = {}) {
  const me = agentId();
  const repo = repoName();
  const fresh = issueView(n);
  if (fresh.state !== 'OPEN') return false;
  const busy = fresh.labels.includes(LABEL.progress) || fresh.assignees.length > 0;
  if (busy && !takeover) return false;
  const kind = takeover ? 'takeover' : 'claim';
  const text = takeover
    ? `🔁 **${me}** übernimmt diesen Task, weil er länger inaktiv war.`
    : `🔒 **${me}** arbeitet jetzt an diesem Task.`;
  const mine = ghJson(['api', `repos/${repo}/issues/${n}/comments`, '-f', `body=<!-- hack:${kind} agent=${me} -->\n${text}`]);
  sleep(2000);
  const since = new Date(Date.parse(mine.created_at) - 120000).toISOString();
  const recent = ghJson(['api', `repos/${repo}/issues/${n}/comments?since=${since}&per_page=100`]) || [];
  const lastRelease = Math.max(0, ...recent.filter((c) => model.parseMarker(c.body, 'release')).map((c) => c.id));
  const rivals = recent
    .filter((c) => c.id > lastRelease && model.parseMarker(c.body, kind))
    .sort((a, b) => a.id - b.id);
  if (rivals[0]?.id === mine.id) {
    editIssue(n, {
      addLabels: [LABEL.progress],
      addAssignees: ['@me'],
      removeAssignees: fresh.assignees.filter((a) => a !== login()),
    });
    return true;
  }
  gh(['api', '-X', 'DELETE', `repos/${repo}/issues/comments/${mine.id}`], { allowFail: true });
  return false;
}

function releaseIssue(n, { note, blocked = false, branch } = {}) {
  const me = agentId();
  const lines = [`<!-- hack:release agent=${me} -->`, `↩️ **${me}** gibt den Task frei.`];
  if (note) lines.push('', `**Übergabe:** ${note}`);
  if (branch) lines.push('', `Bisheriger Stand liegt auf Branch \`${branch}\`.`);
  comment(n, lines.join('\n'));
  editIssue(n, {
    removeLabels: [LABEL.progress],
    removeAssignees: ['@me'],
    addLabels: blocked ? [LABEL.blocked] : [],
  });
}

function issueComments(n) {
  const pages = ghJson(['api', '--paginate', '--slurp', `repos/${repoName()}/issues/${n}/comments?per_page=100`]) || [];
  return pages.flat();
}

// The agent that currently holds task n according to its claim/takeover/release markers.
function holderOf(n) {
  let holder = null;
  for (const c of issueComments(n)) {
    const taken = model.parseMarker(c.body, 'claim') || model.parseMarker(c.body, 'takeover');
    const released = model.parseMarker(c.body, 'release');
    if (taken) holder = taken.agent;
    else if (released && released.agent === holder) holder = null;
  }
  return holder;
}

function heldTasks() {
  const me = agentId();
  const myLogin = login();
  return model
    .listIssues()
    .filter((i) => i.state === 'OPEN' && i.labels.includes(LABEL.progress) && i.assignees.includes(myLogin))
    .filter((i) => holderOf(i.number) === me)
    .map((i) => i.number);
}

function holds(n) {
  const i = issueView(n);
  return i.state === 'OPEN' && i.labels.includes(LABEL.progress) && holderOf(n) === agentId();
}

// Pushes the current branch if it belongs to task n and has commits, then returns to main.
function parkTaskBranch(n) {
  const { main } = kit();
  const branch = currentBranch();
  let pushed = null;
  if (branch && new RegExp(`(^|/)${n}-`).test(branch)) {
    if (isDirty()) throw new HackError(`Uncommitted changes on ${branch}. Commit them first (conventional message, e.g. "feat(x): wip ..."), then retry.`);
    if (aheadOfMain() > 0) pushed = pushCurrent();
    git(['switch', main]);
    git(['merge', '--ff-only', `origin/${main}`], { allowFail: true });
  } else {
    const remote = findTaskBranch(n);
    if (remote) pushed = remote.ref.replace(/^origin\//, '');
  }
  return pushed;
}

// ---------- inbox ----------

function collectInbox(sinceIso) {
  const repo = repoName();
  const { cfg } = kit();
  const me = agentId();
  const myLogin = login();
  const pages = ghJson(['api', '--paginate', '--slurp', `repos/${repo}/issues/comments?since=${sinceIso}&per_page=100`]) || [];
  const comments = pages.flat();
  const issues = model.listIssues();
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const since = Date.parse(sinceIso);
  const items = [];
  const held = new Set(
    issues
      .filter((i) => i.state === 'OPEN' && i.labels.includes(LABEL.progress) && i.assignees.includes(myLogin))
      .filter((i) => holderOf(i.number) === me)
      .map((i) => i.number),
  );

  for (const c of comments) {
    if (Date.parse(c.created_at) <= since) continue;
    const n = Number(String(c.issue_url).split('/').pop());
    const issue = byNumber.get(n);
    if (!issue) continue;
    const anyMarker = String(c.body).match(/<!-- hack:(\w+)\b([^>]*?)-->/);
    const kind = anyMarker?.[1];
    const meta = anyMarker ? model.parseMarker(c.body, kind) : {};
    if (meta?.agent === me) continue;
    if (['claim', 'bot'].includes(kind)) continue;
    const who = meta?.agent || `@${c.user.login}`;
    let body = stripMarkers(c.body).replace(/^\S*\s*\*\*[^*\n]+\*\*(?: → \S+)?:\s*/, '');
    if (kind === 'answer') body = body.split('\n').filter((l) => l.startsWith('>')).map((l) => l.slice(1).trim()).join(' ');
    const text = oneLine(body, 280);
    const human = !anyMarker && c.user.type !== 'Bot';
    const askedByMe = model.parseMarker(issue.body, 'question')?.agent === me;
    const heldByMe = held.has(n);

    if (kind === 'takeover') {
      items.push(`⚠️ #${n} wurde von ${who} übernommen. Falls das deiner war: nicht weiter daran arbeiten, nicht shippen, hack next.`);
    } else if (kind === 'answer') {
      const q = byNumber.get(Number(meta.q));
      if (model.parseMarker(q?.body, 'question')?.agent !== me) items.push(`💡 #${n} hat eine Antwort (Frage #${meta.q}): ${text}`);
    }
    else if (issue.labels.includes(LABEL.question) && human && askedByMe) items.push(`💡 Antwort auf deine Frage #${n} von ${who}: ${text}`);
    else if (kind === 'say' && meta.to && meta.to === me) items.push(`📨 ${who} an dich (#${n}): ${text}`);
    else if (n === cfg.radio) items.push(`📻 ${who}: ${text}`);
    else if (heldByMe) items.push(`💬 #${n} ${who}: ${text}`);
    else if (human) items.push(`👤 ${who} in #${n}: ${text}`);
    else if (kind === 'release' && /Übergabe/.test(c.body)) items.push(`↩️ #${n} wurde von ${who} freigegeben: ${text}`);
  }

  for (const i of issues) {
    if (Date.parse(i.createdAt) <= since || i.state !== 'OPEN') continue;
    if (i.labels.includes(LABEL.bug)) items.push(`🐞 Neuer Bug #${i.number}: ${i.title}`);
  }
  return items;
}

// ---------- commands ----------

const HELP = `hack - hackathon kit CLI (one Claude Code agent per team member, coordinated through GitHub issues)

Setup
  hack init [--team a,b,c] [--force]    Set up this GitHub repo: labels, board, radio, workflows, CLAUDE.md, settings
  hack doctor                           Check gh login, git remote and kit files

Work loop
  hack next [--another]                 Claim the next free task (or resume yours) and switch to its branch
  hack show <n>                         Print a task with its comments
  hack sync                             Fetch and rebase the current branch onto origin/main
  hack ship [<n>] [--title "feat: ..."] [--body "..."]
                                        Rebase, push, open PR (Closes #n), wait for CI, squash-merge when green
  hack release <n> [--note "..."] [--blocked]
                                        Hand a task back (pushes your branch first)

Talking
  hack ask --title "..." [--body "..."] [--option "A: ..."]... [--recommend A] [--blocks <n>]
                                        Ask the humans; blocked tasks are released so you can take another one
  hack say <n|radio> "message" [--to <agent>]
                                        Comment as this agent on an issue or the team radio
  hack inbox [--peek]                   New answers, messages and bugs since you last looked
  hack wait [--timeout 480]             Block until a task frees up or something arrives (seconds)

Usage limit
  hack usage                            Show the 5-hour and weekly usage limits the status line recorded
  hack pause [--max 540]                After handing off: wait until the usage limit resets (repeat until it says so)

Board
  hack status [--publish]               Print the board (and refresh the pinned board issue)
  hack task create --title "..." [--goal "..."] [--accept "..."]... [--area path]... [--depends n]... [--bug] [--prio high|low]
  hack task import <plan.json>          Create many tasks at once (keys in dependsOn are resolved)

Conventions: Conventional Commits for commits and PR titles (${CONVENTIONAL_HINT})
`;

function cmdHelp() {
  out(HELP);
}

function cmdDoctor() {
  const lines = [];
  const ok = (good, text) => lines.push(`${good ? '✔' : '✘'} ${text}`);
  const info = (text) => lines.push(`• ${text}`);
  ok(Number(process.versions.node.split('.')[0]) >= 18, `node ${process.versions.node} (needs 18+)`);
  const shebang = readFileSync(join(KIT_ROOT, 'bin/hack'), 'utf8').split('\n')[0];
  ok(
    !shebang.endsWith('\r'),
    shebang.endsWith('\r')
      ? 'plugin files have Windows line endings, so the bare `hack` command fails: use node "<plugin>/bin/hack" or reinstall the plugin'
      : 'plugin line endings',
  );
  const gitv = run('git', ['--version'], { allowFail: true });
  ok(Boolean(gitv), gitv || 'git missing: https://git-scm.com');
  if (gitv) {
    const name = git(['config', 'user.name'], { allowFail: true });
    const email = git(['config', 'user.email'], { allowFail: true });
    ok(
      Boolean(name && email),
      name && email ? `git identity ${name} <${email}>` : 'git identity missing: git config --global user.name "..." and user.email "..."',
    );
  }
  const ghv = run('gh', ['--version'], { allowFail: true });
  ok(Boolean(ghv), ghv ? ghv.split('\n')[0] : 'gh CLI missing: https://cli.github.com');
  // gh prints its status to stderr in older versions, so read both streams.
  const st = ghv ? spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }) : null;
  const auth = st && st.status === 0;
  ok(auth, auth ? `gh logged in as ${login()}` : 'gh not logged in: run `gh auth login`');
  const scopes = auth ? `${st.stdout}${st.stderr}`.match(/Token scopes:(.*)/) : null;
  if (scopes) {
    const hasWorkflow = /workflow/.test(scopes[1]);
    ok(hasWorkflow, hasWorkflow ? 'gh token can push workflow files' : 'gh token lacks the workflow scope: run `gh auth refresh -s workflow`');
  }
  const root = gitRoot();
  if (!root) info('not inside a git repo (fine until you clone the hackathon repo)');
  const kitRoot = findKitRoot();
  if (root) ok(Boolean(kitRoot), kitRoot ? 'hackathon.json found' : 'no hackathon.json yet: run `hack init`');
  if (kitRoot && auth) {
    const c = kit();
    ok(Boolean(c.cfg.board), `board issue #${c.cfg.board || '?'}, radio #${c.cfg.radio || '?'}`);
    ok(existsSync(join(c.root, '.github/workflows/hack-bot.yml')), '.github/workflows/hack-bot.yml present');
    ok(existsSync(join(c.root, '.claude/settings.json')), '.claude/settings.json present');
  }
  out(...lines);
}

function upsertClaudeMd(root, vars) {
  const path = join(root, 'CLAUDE.md');
  let section = readFileSync(join(TEMPLATES, 'CLAUDE.section.md'), 'utf8');
  for (const [k, v] of Object.entries(vars)) section = section.replaceAll(`{{${k}}}`, String(v));
  section = section.trim();
  if (!existsSync(path)) {
    writeFileSync(path, `# ${vars.NAME}\n\n${section}\n`);
    return;
  }
  const cur = readFileSync(path, 'utf8');
  const re = /<!-- hack:start -->[\s\S]*?<!-- hack:end -->/;
  writeFileSync(path, re.test(cur) ? cur.replace(re, section) : `${cur.trimEnd()}\n\n${section}\n`);
}

function mergeSettings(root, cfg) {
  const path = join(root, '.claude/settings.json');
  const s = readJson(path, {});
  s.extraKnownMarketplaces = {
    ...(s.extraKnownMarketplaces || {}),
    'hackathon-kit': { source: { source: 'github', repo: MARKETPLACE_REPO } },
  };
  s.enabledPlugins = { ...(s.enabledPlugins || {}), 'hack@hackathon-kit': true };
  s.permissions ||= {};
  s.permissions.allow = [...new Set([...(s.permissions.allow || []), ...ALLOW_RULES])];
  s.permissions.deny = [...new Set([...(s.permissions.deny || []), 'Read(./.env)', 'Read(./.env.*)'])];
  s.permissions.defaultMode ||= 'acceptEdits';
  if (!cfg.allowAiAttribution) s.attribution = { commit: '', pr: '' };
  // Records the usage limits for the kit's hooks; shows the user's own status line too.
  if (!s.statusLine || String(s.statusLine.command || '').includes('.github/hack/statusline')) {
    s.statusLine = { type: 'command', command: STATUSLINE_COMMAND };
  }
  writeJson(path, s);
}

function findOrCreateMetaIssue(issues, label, title, body) {
  const found = issues.find((i) => i.state === 'OPEN' && i.labels.includes(label));
  if (found) return found.number;
  const url = gh(['issue', 'create', '--title', title, '--label', label, '--body-file', '-'], { input: body })
    .trim()
    .split('\n')
    .pop();
  return Number(url.match(/\/issues\/(\d+)/)[1]);
}

function cmdInit(argv) {
  const args = parseArgs(argv, { booleans: ['force', 'no-push'] });
  const root = gitRoot();
  if (!root) throw new HackError('Run hack init inside a clone of the hackathon GitHub repo.');
  process.chdir(root);
  const info = ghJson(['repo', 'view', '--json', 'nameWithOwner,name,owner,visibility,defaultBranchRef,url']);
  if (!info) throw new HackError('gh cannot see a GitHub repo for this folder. Is `origin` a GitHub remote?');
  const repo = info.nameWithOwner;
  const hasHead = git(['rev-parse', '--verify', 'HEAD'], { allowFail: true }) !== null;
  const localBranch = git(['symbolic-ref', '--short', 'HEAD'], { allowFail: true }) || 'main';
  const main = info.defaultBranchRef?.name || localBranch;
  const me = gh(['api', 'user', '--jq', '.login']).trim();

  const old = readJson(join(root, 'hackathon.json'), {});
  const team = new Set([me, ...(old.team || [])]);
  for (const t of String(args.team || '').split(',')) if (t.trim()) team.add(t.trim().replace(/^@/, ''));
  for (const t of collaboratorLogins(repo, { withInvites: true })) team.add(t);

  out(`Setting up the hackathon kit for ${repo} …`);
  for (const [name, color, description] of LABELS) {
    gh(['label', 'create', name, '--color', color, '--description', description, '--force']);
  }
  out('✔ labels');

  const issues = model.listIssues();
  const board = findOrCreateMetaIssue(issues, LABEL.board, '📊 Hackathon-Board', '<!-- hack:board -->\nWird gleich vom hack-bot gefüllt.');
  const radio = findOrCreateMetaIssue(
    issues,
    LABEL.radio,
    '📻 Team-Funk',
    '<!-- hack:radio -->\nHier reden Agents und Menschen miteinander. Agents schreiben mit `hack say radio "..."`, Menschen einfach als Kommentar.',
  );
  gh(['issue', 'pin', String(board)], { allowFail: true });
  gh(['issue', 'pin', String(radio)], { allowFail: true });
  out(`✔ board #${board}, radio #${radio} (pinned)`);

  const isPublic = info.visibility === 'PUBLIC';
  const pagesUrl = `https://${info.owner.login.toLowerCase()}.github.io/${info.name}/`;
  const cfg = {
    version: 1,
    language: 'de',
    timezone: 'Europe/Berlin',
    staleMinutes: 45,
    usage: { warnAt: 80, handoffAt: 92, releaseIfResetInMin: 15 },
    allowAiAttribution: false,
    previewDir: '',
    ...old,
    team: [...team],
    board,
    radio,
    mainBranch: main,
    pagesUrl,
  };

  const written = ['hackathon.json', 'CLAUDE.md', '.claude/settings.json'];
  writeJson(join(root, 'hackathon.json'), cfg);
  for (const [tpl, target, mode] of TEMPLATE_FILES) {
    const dest = join(root, target);
    if (mode === 'seed' && existsSync(dest) && !args.force) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(TEMPLATES, tpl), 'utf8'));
    written.push(target);
  }
  upsertClaudeMd(root, {
    NAME: info.name,
    BOARD: board,
    RADIO: radio,
    MAIN: main,
    PAGES_URL: pagesUrl,
    LANGUAGE_NAME: LANGUAGE_NAMES[cfg.language] || cfg.language,
  });
  mergeSettings(root, cfg);
  out('✔ files: hackathon.json, CLAUDE.md, .claude/settings.json, .github/');

  const settingsOk =
    gh(['repo', 'edit', repo, '--enable-issues', '--enable-squash-merge', '--enable-merge-commit=false',
      '--enable-rebase-merge=false', '--delete-branch-on-merge'], { allowFail: true }) !== null;
  gh(['api', '-X', 'PATCH', `repos/${repo}`, '-f', 'squash_merge_commit_title=PR_TITLE', '-f', 'squash_merge_commit_message=BLANK'], {
    allowFail: true,
  });
  out(settingsOk ? '✔ repo: squash merge only, branches deleted after merge' : '⚠ could not change repo merge settings (need admin rights)');

  if (isPublic) {
    const pages =
      gh(['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow'], { allowFail: true }) ??
      gh(['api', '-X', 'PUT', `repos/${repo}/pages`, '-f', 'build_type=workflow'], { allowFail: true });
    out(pages !== null ? `✔ GitHub Pages preview: ${pagesUrl}` : '⚠ could not enable GitHub Pages (enable it under Settings → Pages → Source: GitHub Actions)');
  } else {
    out('⚠ private repo: GitHub Pages preview needs a paid plan, skipped');
  }

  // -f: many people ignore .claude/ globally, but the team settings must be in the repo.
  git(['add', '-f', '--', ...written]);
  const staged = git(['diff', '--cached', '--name-only']);
  if (staged) {
    const message = old.board ? 'chore: update hackathon kit' : 'chore: set up hackathon kit';
    git(['commit', '-m', message, ...(hasHead ? ['--', ...written] : [])]);
    out(`✔ committed "${message}"`);
  }
  if (!args['no-push']) {
    if (!hasHead || localBranch === main) {
      if (hasHead) git(['pull', '--rebase', 'origin', main], { allowFail: true });
      git(['push', '-u', 'origin', `HEAD:${main}`]);
      out(`✔ pushed to ${main}`);
    } else {
      out(`⚠ you are on ${localBranch}, not ${main}: the kit commit is on ${localBranch}. Merge it into ${main} via a PR.`);
    }
  }

  model.publishBoard(model.listIssues(), cfg);
  out(
    '',
    `Done. Board: ${info.url}/issues/${board}`,
    '',
    'Next steps for the team:',
    `  1. Everyone clones ${info.url}, opens it in Claude Code, trusts the folder and installs the plugin when asked`,
    `     (or: /plugin marketplace add ${MARKETPLACE_REPO}  then  /plugin install hack@hackathon-kit).`,
    '  2. Everyone turns on push notifications for @mentions in the GitHub mobile app.',
    '  3. Pitch the idea, then /hack:kickoff (mockups) → /hack:plan (tasks) → everyone runs /hack:work.',
  );
}

function cmdSync() {
  const { main } = kit();
  git(['fetch', 'origin', '--prune', '--quiet']);
  const branch = currentBranch();
  if (isDirty()) throw new HackError('Uncommitted changes. Commit them (conventional message) or stash them, then run hack sync again.');
  if (branch === main) {
    git(['merge', '--ff-only', `origin/${main}`]);
    out(`✔ ${main} is up to date with origin/${main}.`);
    return;
  }
  const res = run('git', ['rebase', `origin/${main}`], { allowFail: true });
  if (res === null) {
    throw new HackError(
      `Rebase onto origin/${main} hit conflicts. Fix the files listed by \`git status\`, \`git add\` them, run \`git rebase --continue\`, then \`hack sync\` again (or \`git rebase --abort\` to undo).`,
    );
  }
  out(`✔ rebased ${branch} onto origin/${main}.`);
}

function cmdStatus(argv) {
  const args = parseArgs(argv, { booleans: ['publish'] });
  const { cfg } = kit();
  const issues = model.listIssues();
  if (args.publish) model.publishBoard(issues, cfg);
  const prs = ghJson(['pr', 'list', '--state', 'open', '--json', 'number,title,isDraft']) || [];
  const c = model.classify(issues);
  out(model.renderBoard(c, prs, cfg));
  const mine = c.inProgress.filter((i) => i.assignees.includes(login()));
  if (mine.length) out(`You (${agentId()}) hold: ${mine.map((i) => `#${i.number}`).join(', ')}`);
}

function printTask(n) {
  const issue = issueView(n);
  const comments = ghJson(['api', `repos/${repoName()}/issues/${n}/comments?per_page=100`]) || [];
  out(`▶ #${issue.number} ${issue.title}`, issue.url, '', stripMarkers(issue.body) || '(no description)');
  const relevant = comments.filter((c) => !/<!-- hack:(claim|takeover|bot)\b/.test(c.body)).slice(-12);
  if (relevant.length) {
    out('', '— Comments (oldest first) —');
    for (const c of relevant) {
      const meta = String(c.body).match(/<!-- hack:\w+[^>]*agent=(\S+)/);
      out(`• ${meta ? meta[1] : `@${c.user.login}`}: ${stripMarkers(c.body)}`);
    }
  }
}

function cmdShow(argv) {
  kit();
  printTask(num(argv[0]));
}

function startTask(t, { resume = false, takeover = false } = {}) {
  const { main } = kit();
  const remote = findTaskBranch(t.number);
  const prefix = t.labels.includes(LABEL.bug) ? 'fix' : 'feat';
  const local = remote ? remote.ref.replace(/^origin\//, '') : `${prefix}/${t.number}-${slugify(t.title) || 'task'}`;
  const cur = currentBranch();
  let branchNote = '';
  if (cur !== local) {
    if (isDirty()) {
      branchNote = `⚠ Still on ${cur} because of uncommitted changes. Commit them, then: git switch ${local}`;
    } else if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${local}`], { allowFail: true })) {
      git(['switch', local]);
      branchNote = `Branch: ${local} (existing local branch, run hack sync to update it)`;
    } else if (remote) {
      git(['switch', '-c', local, '--track', remote.ref]);
      branchNote = `Branch: ${local} (continues the earlier work on ${remote.ref})`;
    } else {
      git(['switch', '-c', local, `origin/${main}`]);
      branchNote = `Branch: ${local} (fresh from origin/${main})`;
    }
  } else {
    branchNote = `Branch: ${local}`;
  }
  out(resume ? '↻ Resuming your task' : takeover ? '🔁 Took over a stale task' : '🔒 Claimed', branchNote, '');
  printTask(t.number);
  out(
    '',
    '— Next —',
    `Build it inside the Area, commit with conventional messages, push often (git push -u origin HEAD), post progress with hack say ${t.number} "...".`,
    `Product/design question? hack ask --title "..." --option "A: ..." --option "B: ..." --recommend A --blocks ${t.number}`,
    `Done? hack ship ${t.number}`,
  );
}

function cmdNext(argv) {
  const args = parseArgs(argv, { booleans: ['another', 'dry'] });
  const { cfg } = kit();
  const me = agentId();
  git(['fetch', 'origin', '--prune', '--quiet']);
  const issues = model.listIssues();
  const c = model.classify(issues);
  // Tasks a human assigned to themselves (no in-progress label) are theirs, never stale.
  for (const i of c.inProgress) i.holder = i.labels.includes(LABEL.progress) ? holderOf(i.number) : null;
  const mine = c.inProgress.filter((i) => i.holder === me);
  if (mine.length && !args.another) {
    out(`You already hold #${mine[0].number}. Finish it (hack ship ${mine[0].number}) or hand it off (hack release ${mine[0].number} --note "...").`);
    startTask(mine[0], { resume: true });
    return;
  }
  if (isDirty() && !args.dry) throw new HackError('Uncommitted changes. Commit or stash them before taking a new task.');

  const busy = c.inProgress.flatMap((i) => model.areas(i));
  const overlaps = (i) => model.areas(i).some((a) => busy.some((b) => a.startsWith(b) || b.startsWith(a)));
  const ready = [...c.ready.filter((i) => !overlaps(i)), ...c.ready.filter(overlaps)];
  const stale = c.inProgress.filter((i) => i.holder && i.holder !== me && lastActivityMinutes(i) > staleMinutes(cfg));

  if (args.dry) {
    out(`Ready: ${ready.map((i) => `#${i.number}`).join(', ') || '-'}`, `Stale: ${stale.map((i) => `#${i.number}`).join(', ') || '-'}`);
    return;
  }
  for (const t of ready) {
    if (claim(t.number)) {
      if (overlaps(t)) out(`⚠ #${t.number} touches files another agent is working on. Keep changes small and sync often.`);
      startTask(t);
      return;
    }
  }
  for (const t of stale) {
    if (claim(t.number, { takeover: true })) {
      startTask(t, { takeover: true });
      return;
    }
  }
  out(
    'NO_TASK: nothing free right now.',
    `In progress: ${c.inProgress.length} · blocked: ${c.blocked.length} · waiting on other tasks: ${c.waiting.length} · open questions: ${c.questions.length}`,
    'Options: `hack wait` (blocks until something frees up), review open PRs, or ask the humans on the radio what to do next.',
  );
}

function cmdRelease(argv) {
  const args = parseArgs(argv, { booleans: ['blocked'] });
  kit();
  const n = num(args._[0]);
  const branch = parkTaskBranch(n);
  releaseIssue(n, { note: args.note, blocked: Boolean(args.blocked), branch });
  out(`✔ released #${n}${branch ? ` (work is on ${branch})` : ''}. Take another one with hack next.`);
}

function cmdAsk(argv) {
  const args = parseArgs(argv, { repeat: ['option', 'blocks'] });
  const { cfg } = kit();
  const me = agentId();
  const title = args.title || args._.join(' ');
  if (!title) throw new HackError('hack ask needs --title "..."');
  const body = args.body || (args['body-file'] ? readFileSync(args['body-file'], 'utf8') : '');
  const options = args.option || [];
  const recommend = args.recommend ? String(args.recommend).toUpperCase() : '';
  const blocks = (args.blocks || []).flatMap((b) => String(b).split(',')).filter(Boolean).map(num);

  const lines = [
    `<!-- hack:question agent=${me}${blocks.length ? ` blocks=${blocks.join(',')}` : ''} -->`,
    `**Frage von ${me}**${blocks.length ? ` · hält ${blocks.map((n) => `#${n}`).join(', ')} auf` : ''}`,
    '',
  ];
  if (body) lines.push(body.trim(), '');
  let firstKey = '';
  if (options.length) {
    lines.push('**Optionen**', '');
    for (const o of options) {
      const m = String(o).match(/^\s*([A-Za-z0-9]{1,3})\s*[:)–-]\s*(.+)$/s);
      const key = m ? m[1].toUpperCase() : '';
      firstKey ||= key;
      const star = recommend && key === recommend ? ' ⭐ Vorschlag' : '';
      lines.push(`- **${key || '•'}** – ${m ? m[2].trim() : o}${star}`);
    }
    lines.push('');
  } else if (recommend) {
    lines.push(`⭐ Vorschlag: ${args.recommend}`, '');
  }
  lines.push(
    firstKey
      ? `👉 Antwortet mit einem Kommentar, ein Buchstabe reicht (z. B. „${firstKey}“). Eigene Worte gehen auch.`
      : '👉 Antwortet einfach mit einem Kommentar.',
  );
  // Live collaborators too, so a teammate who accepted the invitation after `hack init` gets the push.
  const team = new Set([...(cfg.team || []), ...collaboratorLogins(repoName())]);
  const mentions = [...team].map((t) => `@${t}`).join(' ');
  if (mentions) lines.push('', `cc ${mentions}`);

  const url = gh(['issue', 'create', '--title', `❓ ${title}`, '--label', LABEL.question, '--body-file', '-'], {
    input: lines.join('\n'),
  })
    .trim()
    .split('\n')
    .pop();
  const q = Number(url.match(/\/issues\/(\d+)/)[1]);

  // Order matters: the question exists before the task is blocked, so the bot keeps it blocked.
  for (const n of blocks) {
    if (holds(n)) {
      const branch = parkTaskBranch(n);
      releaseIssue(n, { note: `Wartet auf Antwort zu #${q}.`, blocked: true, branch });
    } else {
      editIssue(n, { addLabels: [LABEL.blocked] });
    }
  }
  out(
    `✔ asked #${q}: ${url}`,
    blocks.length
      ? `#${blocks.join(', #')} is blocked until a human answers; the answer will be posted on the task and it becomes free again. Continue with hack next.`
      : 'Nothing is blocked; continue with your default choice and adapt when the answer arrives (hack inbox).',
  );
}

function cmdSay(argv) {
  const args = parseArgs(argv);
  const { cfg } = kit();
  const me = agentId();
  const target = args._[0];
  const message = args.message || args._.slice(1).join(' ');
  if (!target || !message) throw new HackError('Usage: hack say <issue|radio> "message" [--to <agent>]');
  const n = target === 'radio' ? cfg.radio : num(target);
  const to = args.to ? String(args.to).replace(/^@/, '') : '';
  comment(n, `<!-- hack:say agent=${me}${to ? ` to=${to}` : ''} -->\n**${me}**${to ? ` → ${to}` : ''}: ${message}`);
  out(`✔ posted on #${n}`);
}

function cmdInbox(argv) {
  const args = parseArgs(argv, { booleans: ['peek'] });
  const c = kit();
  const since = args.since || c.state.lastInbox || new Date(Date.now() - 2 * 3600000).toISOString();
  const now = new Date().toISOString();
  const items = collectInbox(since);
  out(items.length ? items.join('\n') : 'Inbox empty.');
  if (!args.peek) {
    c.state.lastInbox = now;
    saveCtxState();
  }
}

function cmdWait(argv) {
  const args = parseArgs(argv);
  const c = kit();
  const timeout = Number(args.timeout || 480) * 1000;
  const start = Date.now();
  const since = c.state.lastInbox || new Date(start - 600000).toISOString();
  for (;;) {
    const items = collectInbox(since);
    const ready = model.classify(model.listIssues()).ready;
    if (items.length || ready.length) {
      if (items.length) out('New in the inbox (run hack inbox to mark as read):', ...items);
      if (ready.length) out(`Free tasks: ${ready.map((i) => `#${i.number}`).join(', ')} → hack next`);
      return;
    }
    if (Date.now() - start > timeout) {
      out('Nothing new yet. Run hack wait again, or ask on the radio what to do next.');
      return;
    }
    sleep(30000);
  }
}

function cmdWatch() {
  const root = findKitRoot();
  if (!root) return; // not a kit repo: the monitor just ends
  kit();
  let since = new Date().toISOString();
  let failures = 0;
  for (;;) {
    sleep(Math.min(60000 * 2 ** failures, 600000));
    try {
      const now = new Date().toISOString();
      for (const item of collectInbox(since)) console.log(item);
      since = now;
      failures = 0;
    } catch {
      failures = Math.min(failures + 1, 3);
    }
  }
}

const HEADINGS = {
  de: { goal: 'Ziel', accept: 'Abnahmekriterien', area: 'Bereich', deps: 'Hängt ab von', none: 'keiner' },
  en: { goal: 'Goal', accept: 'Acceptance criteria', area: 'Area', deps: 'Depends on', none: 'none' },
};

function taskBody({ goal, body, acceptance = [], area = [], dependsOn = [], key }) {
  const h = HEADINGS[kit().cfg.language] || HEADINGS.en;
  const parts = [];
  if (body) parts.push(body.trim(), '');
  else {
    parts.push(`## ${h.goal}`, '', goal || '–', '');
    if (acceptance.length) parts.push(`## ${h.accept}`, '', ...acceptance.map((a) => `- [ ] ${a}`), '');
  }
  const existing = model.sections(body || '');
  if (!('area' in existing) && !('bereich' in existing)) {
    parts.push(`## ${h.area}`, '', area.length ? area.map((a) => `\`${a}\``).join(', ') : h.none, '');
  }
  if (!('depends on' in existing) && !('hängt ab von' in existing)) {
    parts.push(`## ${h.deps}`, '', dependsOn.length ? dependsOn.map((n) => `#${n}`).join(', ') : h.none, '');
  }
  if (key) parts.push(`<!-- hack:task key=${key} -->`);
  return parts.join('\n');
}

function createTask(t) {
  const labels = [t.bug ? LABEL.bug : LABEL.task];
  if (t.prio === 'high') labels.push(LABEL.high);
  if (t.prio === 'low') labels.push(LABEL.low);
  const url = gh(['issue', 'create', '--title', t.title, ...labels.flatMap((l) => ['--label', l]), '--body-file', '-'], {
    input: taskBody(t),
  })
    .trim()
    .split('\n')
    .pop();
  return Number(url.match(/\/issues\/(\d+)/)[1]);
}

function cmdTask(argv) {
  const sub = argv[0];
  kit();
  if (sub === 'create') {
    const args = parseArgs(argv.slice(1), { booleans: ['bug'], repeat: ['accept', 'area', 'depends'] });
    if (!args.title) throw new HackError('hack task create needs --title "..."');
    const n = createTask({
      title: args.title,
      goal: args.goal,
      body: args.body || (args['body-file'] ? readFileSync(args['body-file'], 'utf8') : ''),
      acceptance: args.accept || [],
      area: args.area || [],
      dependsOn: (args.depends || []).flatMap((d) => String(d).split(',')).filter(Boolean).map(num),
      prio: args.prio,
      bug: Boolean(args.bug),
    });
    out(`✔ created #${n}`);
    return;
  }
  if (sub === 'import') {
    const file = argv[1];
    if (!file) throw new HackError('Usage: hack task import <plan.json>');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const tasks = Array.isArray(data) ? data : data.tasks;
    const keys = new Map();
    for (const i of model.listIssues()) {
      const k = model.parseMarker(i.body, 'task')?.key;
      if (k) keys.set(k, i.number);
    }
    for (const t of tasks) {
      if (t.key && keys.has(t.key)) {
        out(`= ${t.key} already exists as #${keys.get(t.key)}`);
        continue;
      }
      const dependsOn = (t.dependsOn || []).map((d) => {
        if (typeof d === 'number' || /^#?\d+$/.test(String(d))) return num(d);
        if (!keys.has(d)) throw new HackError(`Task "${t.key || t.title}" depends on unknown key "${d}" (list dependencies before the tasks that need them).`);
        return keys.get(d);
      });
      const n = createTask({ ...t, dependsOn });
      if (t.key) keys.set(t.key, n);
      out(`✔ #${n} ${t.title}`);
    }
    model.publishBoard(model.listIssues(), kit().cfg);
    return;
  }
  throw new HackError('Usage: hack task create ... | hack task import <plan.json>');
}

function checkState(pr) {
  const v = ghJson(['pr', 'view', String(pr), '--json', 'state,statusCheckRollup,mergeable']);
  const checks = (v.statusCheckRollup || []).filter((ch) => !IGNORED_CHECKS.has(ch.workflowName));
  const isRun = (ch) => ch.__typename === 'CheckRun';
  const pending = checks.filter((ch) => (isRun(ch) ? ch.status !== 'COMPLETED' : ['PENDING', 'EXPECTED'].includes(ch.state)));
  const failed = checks.filter((ch) =>
    isRun(ch)
      ? ch.status === 'COMPLETED' && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(ch.conclusion)
      : ['FAILURE', 'ERROR'].includes(ch.state),
  );
  return { state: v.state, mergeable: v.mergeable, checks, pending, failed };
}

function waitForChecks(pr, timeoutMin = 20) {
  const start = Date.now();
  for (;;) {
    const s = checkState(pr);
    if (s.state === 'MERGED') return { result: 'merged' };
    if (s.failed.length) return { result: 'failed', failed: s.failed };
    if (s.checks.length && !s.pending.length) return { result: 'green' };
    if (!s.checks.length && Date.now() - start > 90000) return { result: 'none' };
    if (Date.now() - start > timeoutMin * 60000) return { result: 'timeout' };
    sleep(10000);
  }
}

function printFailures(failed) {
  out('✘ CI failed:', ...failed.map((f) => `  - ${f.name || f.context}: ${f.conclusion || f.state}`));
  const runIds = [...new Set(failed.map((f) => String(f.detailsUrl || '').match(/actions\/runs\/(\d+)/)?.[1]).filter(Boolean))];
  for (const id of runIds.slice(0, 2)) {
    const log = run('gh', ['run', 'view', id, '--log-failed'], { allowFail: true }) || '';
    const tail = log.split('\n').slice(-80).join('\n');
    if (tail) out('', `— failed log (run ${id}, last 80 lines) —`, tail);
  }
}

function cmdShip(argv) {
  const args = parseArgs(argv, { booleans: ['no-merge'] });
  const { main } = kit();
  const branch = currentBranch();
  if (!branch || branch === main || branch === 'HEAD') {
    throw new HackError(`You are on ${branch}. Ship from a task branch (hack next creates one).`);
  }
  const n = args._[0] ? num(args._[0]) : Number(branch.match(/(?:^|\/)(\d+)-/)?.[1]) || null;
  if (isDirty()) throw new HackError('Uncommitted changes. Commit them with a conventional message first.');
  if (n) {
    const holder = holderOf(n);
    if (holder && holder !== agentId()) {
      throw new HackError(`#${n} is held by ${holder} now (taken over). Don't ship it; tell them on the task with hack say ${n} "..." where your work is, then hack next.`);
    }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    git(['fetch', 'origin', '--prune', '--quiet']);
    const rebased = run('git', ['rebase', `origin/${main}`], { allowFail: true });
    if (rebased === null) {
      throw new HackError(
        `Rebase onto origin/${main} hit conflicts. Fix the files from \`git status\`, \`git add\` them, \`git rebase --continue\`, then run hack ship again.`,
      );
    }
    if (aheadOfMain() === 0) throw new HackError(`Nothing to ship: ${branch} has no commits beyond origin/${main}.`);
    pushCurrent();

    const subjects = git(['log', '--reverse', '--format=%s', `origin/${main}..HEAD`]).split('\n');
    const title = args.title || subjects[0];
    if (!CONVENTIONAL.test(title)) {
      throw new HackError(`PR title "${title}" is not a Conventional Commit. Pass --title "${CONVENTIONAL_HINT.split(',')[0]}".`);
    }
    let pr = ghJson(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url'])?.[0];
    if (!pr) {
      const body = [args.body || '', n ? `Closes #${n}` : '', '', `_Shipped by ${agentId()} with hack ship._`]
        .join('\n')
        .trim();
      const url = gh(['pr', 'create', '--base', main, '--head', branch, '--title', title, '--body-file', '-'], { input: body })
        .trim()
        .split('\n')
        .pop();
      pr = { number: Number(url.match(/\/pull\/(\d+)/)[1]), url };
      out(`✔ opened PR #${pr.number}: ${pr.url}`);
    } else if (args.title) {
      gh(['pr', 'edit', String(pr.number), '--title', title], { allowFail: true });
    }
    if (args['no-merge']) {
      out(`PR #${pr.number} is open; not merging (--no-merge).`);
      return;
    }

    out(`… waiting for CI on PR #${pr.number}`);
    const res = waitForChecks(pr.number);
    if (res.result === 'failed') {
      printFailures(res.failed);
      throw new HackError(`Fix the failure, commit, and run hack ship${n ? ` ${n}` : ''} again.`);
    }
    if (res.result === 'timeout') throw new HackError(`CI on PR #${pr.number} is still running after 20 minutes. Check it with gh pr checks ${pr.number}.`);
    if (res.result === 'none') out('⚠ no CI checks reported; merging anyway.');

    if (res.result !== 'merged') {
      const merged = run('gh', ['pr', 'merge', String(pr.number), '--squash', '--delete-branch'], { allowFail: true });
      if (merged === null) {
        const s = checkState(pr.number);
        if (s.state === 'MERGED') {
          // merged after all (e.g. local branch cleanup failed)
        } else if (s.mergeable === 'CONFLICTING' && attempt < 3) {
          out(`↻ ${main} moved and PR #${pr.number} conflicts; rebasing again (attempt ${attempt + 1}/3)`);
          continue;
        } else {
          throw new HackError(`Merging PR #${pr.number} failed. Check it with gh pr view ${pr.number}.`);
        }
      }
    }

    run('git', ['switch', main], { allowFail: true });
    run('git', ['pull', '--ff-only', 'origin', main], { allowFail: true });
    run('git', ['branch', '-D', branch], { allowFail: true });
    if (n) {
      comment(n, `<!-- hack:release agent=${agentId()} -->\n✅ Erledigt in #${pr.number}.`);
      editIssue(n, { removeLabels: [LABEL.progress] });
    }
    out(`✔ shipped: PR #${pr.number} squash-merged into ${main}${n ? `, #${n} closed` : ''}. Next: hack inbox, then hack next.`);
    return;
  }
}

function cmdUsage() {
  const { cfg } = kit();
  const u = usage.readUsage({ maxAgeMin: 24 * 60 });
  out(usage.describe(u, cfg.timezone));
  if (!u) {
    out('The kit status line records these values while Claude Code runs (claude.ai Pro/Max plans). Check that .claude/settings.json has the statusLine entry and that this folder is trusted.');
  }
}

function cmdPause(argv) {
  const args = parseArgs(argv);
  const c = kit();
  const tz = c.cfg.timezone || 'Europe/Berlin';
  const t = usage.thresholds(c.cfg);
  const u = usage.readUsage({ maxAgeMin: 24 * 60 });
  const over = (u?.windows || []).filter((w) => w.pct >= t.handoff);
  if (!over.length) {
    out(`No usage limit is close (${usage.describe(u, tz)}). Continue the work loop: hack inbox, then hack next.`);
    return;
  }
  const held = heldTasks();
  if (held.length) {
    throw new HackError(`You still hold ${held.map((n) => `#${n}`).join(', ')}. Ship it (hack ship <n>) or hand it off (hack release <n> --note "...") before pausing.`);
  }
  const weekly = over.find((w) => w.key === 'seven_day');
  if (weekly && usage.minutesUntil(weekly.resetsAt) > 12 * 60) {
    out(
      `⏹ The weekly limit is at ${Math.round(weekly.pct)}% and resets ${usage.fmtReset(weekly.resetsAt, tz)}. Waiting for it makes no sense.`,
      'Stop the work loop here and tell the user in chat; your teammates\' agents keep going.',
    );
    return;
  }
  const target = Math.max(...over.map((w) => w.resetsAt || 0));
  if (!target) {
    out('The reset time is unknown. Stop here; Claude Code continues by itself once the limit resets (if "Continue automatically at usage limit" is on).');
    return;
  }
  if (c.state.pausedUntil !== target) {
    comment(c.cfg.radio, `<!-- hack:say agent=${agentId()} -->\n**${agentId()}**: ⏸️ Kontingent fast aufgebraucht, pausiere bis ${usage.fmtReset(target, tz)}.`);
    c.state.pausedUntil = target;
    saveCtxState();
  }
  const waitMs = Math.min(target - Date.now() + 30000, Number(args.max || 540) * 1000);
  if (waitMs > 0) sleep(waitMs);
  if (Date.now() >= target) {
    out('✔ The usage limit has reset. Continue the work loop: hack inbox, then hack next.');
  } else {
    out(`⏸ Still paused: the limit resets ${usage.fmtReset(target, tz)} (in ${usage.fmtIn(target)}). Run hack pause again (Bash timeout 600000 ms).`);
  }
}

// StopFailure hook (error = rate_limit): if the subscription limit ran out and the reset is not
// close, save and push the work on held tasks and release them so teammates can continue.
function cmdLimitHit() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    // no input
  }
  if (input.cwd) process.chdir(input.cwd);
  if (!findKitRoot()) return;
  const { root, cfg } = kit();
  const tz = cfg.timezone || 'Europe/Berlin';
  const t = usage.thresholds(cfg);
  const w = usage.worstWindow(usage.readUsage({ maxAgeMin: 60 }));
  const text = `${input.last_assistant_message || ''} ${input.error_details || ''}`;
  const isQuota = (w && w.pct >= t.handoff) || /hit your|usage limit|session limit|weekly limit|opus limit|sonnet limit/i.test(text);
  if (!isQuota) return; // a short API rate limit, not the subscription limit
  const minutes = w ? usage.minutesUntil(w.resetsAt) : null;
  if (minutes !== null && minutes < t.releaseIfResetInMin) return; // resumes soon on its own

  const me = agentId();
  const held = heldTasks();
  if (!held.length) return;
  const reset = w ? usage.fmtReset(w.resetsAt, tz) : 'unbekannt';
  const branches = [];
  for (const n of held) {
    const branch = currentBranch();
    let pushed = null;
    if (branch && new RegExp(`(^|/)${n}-`).test(branch)) {
      if (isDirty()) {
        git(['add', '-A']);
        git(['commit', '-m', `chore(wip): save work on #${n} before usage limit pause`]);
      }
      if (aheadOfMain() > 0) pushed = pushCurrent();
    } else {
      const remote = findTaskBranch(n);
      if (remote) pushed = remote.ref.replace(/^origin\//, '');
    }
    releaseIssue(n, { note: `Kontingent von ${me} ist aufgebraucht (Reset ${reset}). Bitte auf dem Branch weitermachen.`, branch: pushed });
    if (pushed) branches.push(pushed);
  }
  comment(cfg.radio, `<!-- hack:say agent=${me} -->\n**${me}**: ⏸️ Kontingent aufgebraucht, pausiere bis ${reset}. Freigegeben: ${held.map((n) => `#${n}`).join(', ')}.`);
  const notices = usage.readNotices();
  (notices.released ||= {})[root] = { tasks: held, branches, at: Date.now(), acknowledged: false };
  usage.writeNotices(notices);
}

const COMMANDS = {
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
  doctor: cmdDoctor,
  init: cmdInit,
  sync: cmdSync,
  status: cmdStatus,
  show: cmdShow,
  next: cmdNext,
  release: cmdRelease,
  ask: cmdAsk,
  say: cmdSay,
  inbox: cmdInbox,
  wait: cmdWait,
  watch: cmdWatch,
  task: cmdTask,
  ship: cmdShip,
  usage: cmdUsage,
  pause: cmdPause,
  'limit-hit': cmdLimitHit,
};

export function main(argv) {
  const [cmd = 'help', ...rest] = argv;
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`Unknown command "${cmd}".\n`);
    cmdHelp();
    process.exit(2);
  }
  try {
    fn(rest);
  } catch (err) {
    if (err instanceof HackError || /^gh /.test(err.message)) {
      console.error(`✘ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
