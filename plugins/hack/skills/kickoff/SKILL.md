---
description: Turn the team's hackathon idea into a one-page brief and 2-3 clickable mockups so design decisions are made early. Use at the start of a hackathon, after the team pitched the idea.
disable-model-invocation: true
argument-hint: "[the idea in a few words]"
---

# Kickoff: idea → brief → mockups → decision

The idea belongs to the humans. Your job is to make it concrete fast and let them decide.

1. **Brief.** Use the idea from `$ARGUMENTS` or the conversation. If it's thin, ask one round of at most four questions: who the user is, the one thing the demo must show, the hackathon's theme and judging criteria, any required tech. Then write `IDEA.md` in the team language (see CLAUDE.md): problem, target user, the demo story in five steps, core features (must and nice to have), what will impress the jury, constraints. One page at most.
2. **Mockups.** Build 2 to 3 clearly different design directions as self-contained HTML files: `mockups/a.html`, `mockups/b.html`, `mockups/c.html`.
   - Inline CSS and JS, no build step, realistic sample content in the team language.
   - Show the main screen and the key steps of the demo story, clickable with simple view switching.
   - Works at phone and desktop width.
   - The variants differ in layout and visual style, not just in color.
   - Add `mockups/index.html` that links every variant with a one-line description.
3. **Ship them.** On a branch `docs/kickoff`, commit (`docs: add idea brief and mockups`), then run `hack ship` without an issue number. After the merge, the preview workflow publishes them under `<pagesUrl>mockups/` (`pagesUrl` is in hackathon.json) within one or two minutes.
4. **Let the team decide.** Ask on GitHub, so everyone gets a push:
   `hack ask --title "Welche Design-Richtung nehmen wir?" --body "<one line per variant with its preview link>" --option "A: ..." --option "B: ..." --option "C: ..." --recommend <your pick>`
   Tell the user in chat that the question is on GitHub, and that a letter plus any wishes is enough ("B, aber mit der Navigation von A").
5. **Record the decision.** When the answer is in (`hack inbox`, or the user tells you), write `DECISIONS.md`: the chosen direction and requested tweaks, the product decisions so far, open questions. Keep the other variants in `mockups/` for reference. Ship it (`docs: record design decision`) and suggest `/hack:plan` as the next step.
