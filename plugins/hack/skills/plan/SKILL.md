---
description: Break the decided hackathon idea into small, parallel GitHub tasks for the agents. Use after the kickoff, when the team is ready to start building.
disable-model-invocation: true
---

# Plan: decided idea → tasks on the board

Read `IDEA.md`, `DECISIONS.md` and the chosen mockup in `mockups/`. The `team` list in `hackathon.json` tells you how many agents will work in parallel.

1. **Stack.** Unless the team already decided, propose a stack in one short paragraph. Default for web apps: Vite + React + TypeScript, plain CSS or Tailwind, no backend unless the demo needs one (static data or localStorage beats a database in a hackathon). The build must work under a sub-path for the GitHub Pages preview (Vite: `base: './'`), unless the team picked another host. Ask the user to confirm in chat (one question), then continue.
2. **Architecture.** Choose the folder layout and module boundaries so that tasks touch different folders. Write `docs/ARCHITECTURE.md` in English, short: stack, folder layout, data model, and the shared contracts (types, API shapes, component props) that parallel tasks rely on.
3. **Tasks.** Write a temporary `plan.json` (never commit it):
   ```json
   {
     "tasks": [
       {
         "key": "scaffold",
         "title": "Projekt-Grundgerüst steht",
         "goal": "...",
         "acceptance": ["..."],
         "area": ["package.json", "src/main.tsx", "src/types/"],
         "dependsOn": [],
         "prio": "high"
       }
     ]
   }
   ```
   - The first task is the **scaffold**: project setup, folder layout, the shared types and contracts from ARCHITECTURE.md, a placeholder for every feature screen, working `lint` and `build` scripts (CI runs them), and a build that works in the Pages preview. Every other task depends on it. Keep it small, so parallel work starts within about 30 minutes.
   - Each task is 20 to 45 minutes of agent work, with a clear goal, 2 to 5 checkable acceptance criteria and an **area** (the folders or files it owns). Tasks that can run at the same time must not share an area. Shared files (router, global styles, package.json) belong to the scaffold or to one explicit task.
   - Order by the demo story. What the jury sees first gets `"prio": "high"`, nice-to-haves get `"prio": "low"`.
   - First wave: about 3 to 5 tasks per team member. Add low-priority tasks at the end for demo data, a polish pass, a README with screenshots, and pitch notes.
   - Titles, goals and criteria in the team language. Titles are short and describe the outcome ("Karte zeigt alle Standorte").
   - `dependsOn` lists keys of earlier tasks.
4. **Review.** Show the plan to the user as a compact table (key, title, area, depends on, prio) and ask for a go in chat. Apply their changes.
5. **Publish.** Ship ARCHITECTURE.md from a branch (`docs: add architecture`). Then run `hack task import plan.json` and delete `plan.json`. Tell the user that everyone can now start `/hack:work`, and that the board issue shows the live state.
