---
description: Set up the hackathon kit in the current GitHub repo (labels, board, team radio, workflows, CLAUDE.md, Claude settings). One person runs it once per hackathon.
disable-model-invocation: true
argument-hint: "[--team login1,login2,...]"
---

# Set up the hackathon kit

> The `hack` command is on your PATH while this plugin is enabled. If the shell reports `hack: command not found`, run it as `node "${CLAUDE_PLUGIN_ROOT}/bin/hack"` instead, with the same arguments.

1. Run `hack doctor`. If gh is missing or not logged in, stop and tell the user the exact command (`gh auth login`). If this folder is not a clone of a GitHub repo, ask the user which repo to use, or offer to create one (`gh repo create <name> --public --clone`, then continue inside it). Don't continue until the repo exists.
2. The teammates' GitHub logins get @mentioned on every question. Take them from the arguments (`$ARGUMENTS`); repo collaborators are added automatically. If neither gives the whole team, ask the user once for the missing logins.
3. Run `hack init $ARGUMENTS` (plus `--team ...` if you asked) from the repo root and show the user the result.
4. If teammates aren't collaborators yet, remind the user to invite them with write access (repo Settings → Collaborators).
5. End with the team checklist that `hack init` printed, short and in the team's language.
