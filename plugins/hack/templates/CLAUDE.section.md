<!-- hack:start -->
## Hackathon kit

Several Claude Code agents (one per team member) build this repo at the same time, coordinated through GitHub issues by the `hack` plugin. The humans own the idea and the product decisions; the agents build.

- **Board:** issue #{{BOARD}} (live state) · **Team radio:** issue #{{RADIO}} · **Preview:** {{PAGES_URL}} (app) and {{PAGES_URL}}mockups/
- **Start working:** `/hack:work`. One task at a time, always claimed with `hack next`. Never work on a task someone else holds.
- **Stay in your lane:** each task has an Area (the folders or files it owns). Keep changes there and mention anything outside it in the PR.
- **Ask, don't stall:** product, design and scope questions go to the humans with `hack ask` (2 to 4 options plus your recommendation). Then take another task; the answer frees the blocked one. Technical decisions are yours.
- **Commits and PR titles:** Conventional Commits in English, `type(scope): summary`, imperative, lowercase, no period, at most 72 characters. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
- **Never push to {{MAIN}}.** Ship with `hack ship <n>`: rebase, PR with `Closes #n`, CI, squash merge when green.
- **Push often** (`git push -u origin HEAD`) and post progress with `hack say <n> "..."`, so a teammate's agent can take over if your session ends.
- **Usage limit:** follow the `[hackathon kit] Usage` notes. From 92 % of the 5-hour or weekly limit, finish the current step, ship or `hack release <n> --note "..."`, then `hack pause` until the reset. Never let a held task sit while you wait.
- **Talk** with `hack say <issue|radio> "..."` and read with `hack inbox`. Don't use `gh issue comment`, `gh issue create`, `gh pr create` or `gh pr merge`; the kit's hook blocks them.
- **Language:** issues, questions and UI texts in {{LANGUAGE_NAME}}; code, comments, commits and PRs in English.
- **Shared docs:** `IDEA.md` (brief), `DECISIONS.md` (what the team decided), `docs/ARCHITECTURE.md` (stack, layout, contracts). Read them before building, and update DECISIONS.md when the team decides something new.
- **Preview:** GitHub Pages serves the build under a sub-path, so it must work there (Vite: `base: './'`). For client-side routing, use hash routing or ship a 404.html fallback.
<!-- hack:end -->
