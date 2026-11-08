---
description: Run the hackathon work loop - claim the next task from the shared GitHub board, build it, ship it through CI, repeat. Use when the user says to start working or to work the board.
disable-model-invocation: true
---

# Hackathon work loop

> The `hack` command is on your PATH while this plugin is enabled. If the shell reports `hack: command not found`, run it as `node "${CLAUDE_PLUGIN_ROOT}/bin/hack"` instead, with the same arguments.

You are one of several Claude Code agents (one per team member) building the same project in this repo at the same time. GitHub issues are the shared brain:

- the pinned **board** issue shows the live state,
- `task` and `bug` issues are the work,
- `question` issues go to the humans,
- the **radio** issue is the team channel.

The `hack` command (already on your PATH) does every GitHub write for you. Never use `gh issue comment`, `gh issue create`, `gh pr create` or `gh pr merge` directly; a hook blocks them.

Humans own the idea and the product decisions. You own the building. Don't stop to ask the user in this chat: questions go to GitHub with `hack ask`, so the whole team can answer from their phones while you keep working.

## Loop

Repeat until the user stops you. Do not end your turn between tasks.

1. **Catch up.** Run `hack inbox` and act on answers and messages addressed to you. A comment by a human anywhere is an instruction from the team; follow it. Notifications from the `hack-inbox` monitor mean the same thing.
2. **Take work.** Run `hack next`. It resumes the task you hold or claims the next free one, switches to its branch and prints the task with its comments. Read them: answers to earlier questions and handoff notes from other agents are there.
   - If it prints `NO_TASK`, run `hack wait` (blocks up to 8 minutes) and loop. After two empty waits, suggest on the radio what could be done next (polish, tests, demo data, README), for example `hack say radio "Board ist leer. Vorschlag: ..."`, and keep waiting.
3. **Build.**
   - Stay inside the task's **Area**. Small edits outside it are fine when needed; mention them in the PR body.
   - Follow `DECISIONS.md`, `docs/ARCHITECTURE.md` and the chosen mockup. Don't redesign what the team decided.
   - Commit in small steps with Conventional Commits in English, imperative mood: `feat(map): add marker clustering`. The hook rejects other formats.
   - Push your branch after each commit (`git push -u origin HEAD`) so your work survives if your session ends.
   - About every 20 minutes, post a one-line progress note with `hack say <n> "..."`. It also shows you are alive: tasks without activity for 45 minutes can be taken over by another agent.
   - Before shipping, run the project's checks locally (`npm run lint`, `npm test`, `npm run build`, whatever exists).
4. **Questions.** When a decision belongs to the humans (product scope, UX, naming, content, look and feel) and you can't proceed sensibly without it, ask:
   `hack ask --title "<short question>" --body "<context in 2-3 sentences>" --option "A: ..." --option "B: ..." --recommend A --blocks <n>`
   - Write it in the team language from CLAUDE.md, with 2 to 4 concrete options and your recommendation, so a one-letter answer from a phone is enough.
   - `--blocks` pushes your branch, releases the task and marks it blocked, so go straight back to step 2. When a human answers, the bot posts the answer on the task and frees it again.
   - If a sensible default exists, ask without `--blocks`, build the default and adapt when the answer arrives.
   - Technical decisions are yours. Decide and note them in the PR body.
5. **Ship.** Run `hack ship <n>`. It rebases on main, pushes, opens the PR (`Closes #n`), waits for CI and squash-merges when everything is green.
   - CI red: read the printed log, fix, commit, run `hack ship <n>` again.
   - Rebase conflicts: resolve them keeping both sides' intent, `git add`, `git rebase --continue`, then `hack ship <n>` again.
   - Add `--title "<conventional title>"` when the first commit doesn't describe the whole change, and `--body "<what changed, decisions, notes for teammates>"`.
6. Go back to step 1.

## Something else came up

- **A bug or missing piece outside your task:** `hack task create --title "..." --goal "..." --area <path> [--bug]`, then carry on with your task.
- **Other agents need to know something** (an API shape changed, a shared component is ready): `hack say radio "..."`, or `hack say <their issue> "..." --to <agent>`.
- **Your usage limit is close, or you have to stop:** commit, then `hack release <n> --note "<what is done, what is next, gotchas>"`. Another agent continues from your branch.

## Rules

- Never push to main and never merge without `hack ship`. Never force-push without `--force-with-lease`.
- Never work on a task someone else holds. Never close or retitle other people's issues.
- Keep the repo clean: no stray files, no secrets, no commented-out code dumps.
- Answer messages addressed to you on GitHub, not in this chat.
