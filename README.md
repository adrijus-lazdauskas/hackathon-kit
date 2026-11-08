# hackathon-kit

Ein Claude-Code-Plugin für Hackathon-Teams. Jedes Teammitglied lässt seinen eigenen Claude Code laufen, und alle Agents bauen gemeinsam an einem GitHub-Repo. GitHub ist dabei das gemeinsame Gedächtnis: Issues sind die Aufgaben, ein angepinntes Board zeigt live den Stand, Fragen an euch kommen als Push aufs Handy. Ihr kümmert euch um die Idee und die Entscheidungen, die Agents um die Handarbeit.

## Was es macht

- **Mockups zuerst:** `/hack:kickoff` macht aus eurer Idee ein einseitiges Briefing und 2–3 klickbare Design-Varianten auf GitHub Pages. Ihr wählt per Kommentar.
- **Aufgaben fürs Team:** `/hack:plan` zerlegt die Idee in kleine Tasks mit eigenem Bereich (Ordner), damit sich die Agents nicht in die Quere kommen.
- **Live-Fortschritt:** Ein angepinntes Board-Issue aktualisiert sich bei jeder Änderung: wer woran arbeitet, was blockiert ist, was fertig ist. Dazu eine Vorschau der App nach jedem Merge.
- **Fragen ohne Stillstand:** Braucht ein Agent eine Produktentscheidung, legt er ein Frage-Issue mit Optionen an und erwähnt euch. Ihr bekommt eine Push in der GitHub-App, antwortet mit einem Buchstaben, und der Agent arbeitet so lange an etwas anderem weiter.
- **Agents reden miteinander:** über ein Team-Funk-Issue und Kommentare an den Tasks.
- **Sauberes Repo:** Conventional Commits werden erzwungen, nie direkt auf `main`, jeder Task wird ein PR, der bei grünem CI automatisch per Squash gemergt wird.
- **Übergabe:** Agents pushen ihren Stand laufend. Fällt einer aus (Kontingent leer, Laptop zu), übernimmt ein anderer nach 45 Minuten Inaktivität von dessen Branch.
- **Tester-Agent:** `/hack:test` spielt echte Nutzer durch, erst auf Papier, dann in der laufenden App, und legt jeden Fund als Bug-Task an.

## Einmal vorher, jede Person

1. Claude Code aktuell halten (`claude update`) und Node 18 oder neuer installieren.
2. GitHub-CLI installieren (`brew install gh` oder https://cli.github.com) und einloggen:

   ```bash
   gh auth login
   ```

3. In der GitHub-App auf dem Handy Push-Benachrichtigungen für Erwähnungen (@mentions) einschalten.
4. Das Plugin in Claude Code installieren:

   ```text
   /plugin marketplace add adrijus-lazdauskas/hackathon-kit
   /plugin install hack@hackathon-kit
   ```

## Am Hackathon-Tag

1. **Eine Person** legt das Projekt-Repo an (öffentlich, sonst gibt es keine Pages-Vorschau), lädt die anderen als Collaborators ein, klont es, öffnet es in Claude Code und führt `/hack:init` aus. Das legt Labels, Board, Team-Funk, Workflows, `CLAUDE.md` und die Claude-Einstellungen an und pusht alles.
2. **Alle anderen** klonen das Repo und öffnen es in Claude Code. Beim ersten Öffnen dem Ordner vertrauen, dann wird das Plugin automatisch vorgeschlagen.
3. **Ideenphase (nur Menschen).** Danach führt eine Person `/hack:kickoff` aus, und ihr wählt eine Design-Richtung über das Frage-Issue.
4. `/hack:plan` erstellt die Tasks. Plan im Chat absegnen.
5. **Alle** starten Claude Code im Auto-Modus und dann die Arbeitsschleife:

   ```bash
   claude --permission-mode auto
   ```

   ```text
   /hack:work
   ```

   Ohne Auto-Modus fragt Claude bei vielen Befehlen nach, und die Schleife bleibt stehen. Alternativ in einer laufenden Session mit Shift+Tab in den Auto-Modus wechseln.
6. Zwischendurch `/hack:test` für einen Testlauf und `/hack:status` für einen Überblick. Das Board-Issue zeigt den Stand jederzeit im Browser und in der App.

## Wie es funktioniert

| Teil | Wo | Was |
| --- | --- | --- |
| Board | angepinntes Issue `board` | wird vom Workflow `hack-bot` nach jeder Änderung neu geschrieben |
| Tasks | Issues `task` / `bug` | mit Abschnitten Ziel, Abnahmekriterien, Bereich, Hängt ab von |
| Sperre | Kommentar + Label `in-progress` | `hack next` beansprucht atomar, der frühere Kommentar gewinnt |
| Fragen | Issues `question` | der erste Kommentar eines Menschen gilt als Antwort, der Bot trägt sie in den Task ein und gibt ihn frei |
| Funk | angepinntes Issue `radio` | `hack say radio "..."` |
| Ausliefern | `hack ship` | rebase → PR mit `Closes #n` → CI → Squash-Merge |
| Regeln | Plugin-Hooks | Conventional Commits, kein Push auf `main`, kein Force-Push, GitHub-Schreibzugriffe nur über `hack` |
| Vorschau | Workflow `preview` | baut die App und legt `mockups/` daneben, auf GitHub Pages |

Das Kommando `hack` liegt im Plugin und ist für Claude automatisch im PATH. `hack help` zeigt alle Befehle.

## Grenzen der ersten Version

- Das Kontingent wird noch nicht aktiv gemessen. Läuft es leer, bleibt der Task 45 Minuten gesperrt, dann übernimmt ihn ein anderer Agent. Eine Warnung vor dem Limit kommt in v2.
- GitHub benachrichtigt dich nicht über deine eigenen Aktionen. Stellt dein Agent eine Frage, bekommen nur die anderen eine Push.
- Die Pages-Vorschau gibt es nur für öffentliche Repos (bei privaten nur mit bezahltem GitHub-Plan).
- Die Agents reden asynchron miteinander. Eine Nachricht kommt innerhalb von etwa einer Minute an, nicht sofort.

## Update

```text
/plugin marketplace update hackathon-kit
```

Danach `/hack:init` im Projekt erneut ausführen, wenn sich Workflows geändert haben (bestehende `ci.yml` und `preview.yml` bleiben unangetastet, außer mit `--force`).
