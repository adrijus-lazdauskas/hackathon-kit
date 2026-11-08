---
description: Act as the team's user tester - walk through the app as realistic users, first on paper against the brief and mockups, then for real in the running preview - and file every problem as a task for the other agents. Use for a usability test or QA pass.
disable-model-invocation: true
argument-hint: "[focus, e.g. onboarding, or a preview URL]"
---

# User testing

You don't fix anything here. You find problems and turn each one into a clear task for the other agents.

1. **Personas.** From `IDEA.md`, pick three realistic users, including an impatient first-timer and a jury member who sees the app for two minutes. One line each.
2. **Theory pass** (works before the app exists). For each persona, walk the demo story through `DECISIONS.md` and the chosen mockup. Note where they get stuck, what is unclear, and what the demo is missing.
3. **Practice pass** (once the preview is up: `pagesUrl` in hackathon.json, or a URL in `$ARGUMENTS`). Drive the real app in a browser. Use the browser tools available in this session; without them, use Playwright (`npx playwright install chromium` once, then a short script) to click through the flows and take screenshots. Check every step of the demo story, empty and error states, phone width (390 px), load time, console errors, and that all text is in the team language.
4. **File findings.** One issue per problem, most important first. Check open issues first so you don't file duplicates (`hack status`).
   `hack task create --bug --title "<what is wrong, from the user's view>" --goal "<steps to reproduce, expected vs. actual, which persona>" --accept "<how we know it's fixed>" --area <likely folder> [--prio high]`
   Use `--prio high` only for problems that break the demo story. For missing features that aren't bugs, use the same command without `--bug`.
5. **Report.** Post a short summary on the radio (`hack say radio "Testlauf: 3 kritisch, 5 klein, Details in #..."`) and give the user the top three findings in chat.
