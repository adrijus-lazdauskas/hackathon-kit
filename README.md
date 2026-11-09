# hackathon-kit

Ein Claude-Code-Plugin für Hackathon-Teams. Jedes Teammitglied lässt seinen eigenen Claude Code laufen, und alle Agents bauen gemeinsam an einem GitHub-Repo. GitHub ist dabei das gemeinsame Gedächtnis: Issues sind die Aufgaben, ein angepinntes Board zeigt live den Stand, Fragen an euch kommen als Push aufs Handy. Ihr kümmert euch um die Idee und die Entscheidungen, die Agents um die Handarbeit.

## Was es macht

- **Mockups zuerst:** `/hack:kickoff` macht aus eurer Idee ein einseitiges Briefing und 2–3 klickbare Design-Varianten auf GitHub Pages. Ihr wählt per Kommentar.
- **Aufgaben fürs Team:** `/hack:plan` zerlegt die Idee in kleine Tasks mit eigenem Bereich (Ordner), damit sich die Agents nicht in die Quere kommen.
- **Live-Fortschritt:** Ein angepinntes Board-Issue aktualisiert sich bei jeder Änderung: wer woran arbeitet, was blockiert ist, was fertig ist. Dazu eine Vorschau der App nach jedem Merge.
- **Fragen ohne Stillstand:** Braucht ein Agent eine Produktentscheidung, legt er ein Frage-Issue mit Optionen an und erwähnt euch. Ihr bekommt eine Push in der GitHub-App, antwortet mit einem Buchstaben, und der Agent arbeitet so lange an etwas anderem weiter.
- **Agents reden miteinander:** über ein Team-Funk-Issue und Kommentare an den Tasks.
- **Sauberes Repo:** Conventional Commits werden erzwungen, nie direkt auf `main`, jeder Task wird ein PR, der bei grünem CI automatisch per Squash gemergt wird.
- **Kontingent im Blick:** Ab 80 % des 5-Stunden- oder Wochenlimits bekommt der Agent eine Warnung. Ab 92 % schließt er seinen Schritt ab, liefert aus oder gibt den Task mit Übergabe-Notiz frei und wartet mit `hack pause` bis zum Reset. Danach macht er weiter. Reißt das Limit trotzdem, sichert ein Hook den Stand als WIP-Commit, pusht ihn und gibt den Task frei. Die Status-Zeile zeigt den Stand, z. B. `hack · Kontingent 5h 42% · 7d 12%`.
- **Übergabe:** Agents pushen ihren Stand laufend. Fällt einer ganz aus (Laptop zu), übernimmt ein anderer nach 45 Minuten Inaktivität von dessen Branch.
- **Tester-Agent:** `/hack:test` spielt echte Nutzer durch, erst auf Papier, dann in der laufenden App, und legt jeden Fund als Bug-Task an.

## Einmal vorher, jede Person

Am einfachsten startet jede Person Claude Code (`claude`) in einem beliebigen Ordner und fügt diesen Prompt ein. Claude prüft dann alles, installiert, was fehlt, und sagt dir, was du selbst machen musst:

```text
Bereite meinen Rechner für einen Hackathon mit dem Claude-Code-Plugin hackathon-kit vor (github.com/adrijus-lazdauskas/hackathon-kit). Prüf bei jedem Punkt erst, was schon da ist, und installier nur, was fehlt. Was ich selbst machen muss (Browser-Login, eigenes Terminal), sagst du mir mit dem genauen Befehl und wartest, bis ich fertig bin. Ändere nichts außerhalb dieser Liste.

1. Erkenne das Betriebssystem. Unter Windows installierst du mit winget, unter macOS mit Homebrew. Muss ich nach einer Installation ein neues Terminal öffnen, sag es mir.
2. Git muss installiert sein. Sind `git config --global user.name` oder `user.email` leer, frag mich nach Name und E-Mail meines GitHub-Accounts und setz sie.
3. Node.js 18 oder neuer (`node -v`), sonst die LTS-Version installieren.
4. GitHub-CLI `gh`, sonst installieren.
5. `gh auth status`: Bin ich nicht eingeloggt, soll ich in einem eigenen Terminal `gh auth login` ausführen (GitHub.com, dann HTTPS, dann „Authenticate Git with your GitHub credentials“: Yes, dann Login im Browser). Fehlt bei den Token-Scopes `workflow`, soll ich `gh auth refresh -s workflow` ausführen. Danach führst du `gh auth setup-git` aus.
6. `claude --version` muss mindestens 2.1.234 sein, sonst soll ich `claude update` ausführen.
7. Installier das Plugin mit `claude plugin marketplace add adrijus-lazdauskas/hackathon-kit` und `claude plugin install hack@hackathon-kit`. Wird das blockiert, gib mir die zwei Befehle, dann führe ich sie selbst aus.
8. Prüf alles mit `node "<Plugin-Ordner>/bin/hack" doctor`. Der Plugin-Ordner liegt unter `~/.claude/plugins/cache/hackathon-kit/hack/<Version>`. Behebe jede Zeile mit ✘. Die Zeile „not inside a git repo“ ist in Ordnung.
9. Unter Windows darf die Umgebungsvariable `CLAUDE_CODE_USE_POWERSHELL_TOOL` nicht gesetzt sein.
10. Zum Schluss eine kurze Liste: was erledigt ist und was ich noch selbst machen muss. Dazu gehört immer: in Claude Code unter `/config` „Continue automatically at usage limit“ einschalten, die GitHub-App aufs Handy laden, einloggen und Push-Benachrichtigungen erlauben, meinen GitHub-Login an die Person schicken, die das Repo anlegt, und die Einladung zum Repo annehmen.
```

Von Hand geht es so:

1. Claude Code aktuell halten (`claude update`) und Node 18 oder neuer installieren (unter Windows `winget install --id OpenJS.NodeJS.LTS -e`).
2. Git braucht deinen Namen und deine E-Mail (`git config --global user.name "..."` und `git config --global user.email "..."`).
3. GitHub-CLI installieren (`brew install gh`, unter Windows `winget install --id GitHub.cli -e`) und einloggen:

   ```bash
   gh auth login
   ```

   Dabei HTTPS wählen und „Authenticate Git with your GitHub credentials“ mit Yes beantworten.
4. In der GitHub-App auf dem Handy Push-Benachrichtigungen für Erwähnungen (@mentions) einschalten.
5. Automatisches Weitermachen nach dem Limit einschalten: im Terminal in `/config` die Einstellung „Continue automatically at usage limit“, in der Desktop-App die Checkbox „Auto-continue when limits reset“ auf der Limit-Karte (die erscheint erst, wenn das Limit einmal erreicht ist).
6. Das Plugin installieren, im Terminal:

   ```bash
   claude plugin marketplace add adrijus-lazdauskas/hackathon-kit
   ```

   ```bash
   claude plugin install hack@hackathon-kit
   ```

   Oder in einer laufenden Claude-Code-Session `/plugin marketplace add adrijus-lazdauskas/hackathon-kit` und dann `/plugin install hack@hackathon-kit`.
7. Prüfen: `hack doctor` (in Claude Code: „Führe hack doctor aus“) zeigt bei jedem fehlenden Teil ein ✘ mit dem Befehl, der es behebt.

**Windows:** Claude Code führt Befehle unter Windows in Git Bash aus, das Kit läuft dort genauso. Die Vorschau-Funktion `CLAUDE_CODE_USE_POWERSHELL_TOOL` nicht einschalten, sonst greifen die Regeln des Kits nicht. Umgebungsvariablen setzt du in PowerShell so: `$env:HACK_AGENT = "adrijus-2"; claude --permission-mode auto`.

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
| Kontingent | Status-Zeile + Hooks | Status-Zeile speichert die Limits, Hook warnt ab 80 % und lässt ab 92 % übergeben, `StopFailure`-Hook sichert und gibt frei |

Das Kommando `hack` liegt im Plugin und ist für Claude automatisch im PATH. `hack help` zeigt alle Befehle.

## Mehrere Agents pro Person

Ein Agent erkennt seine Tasks an seiner Kennung, standardmäßig dein GitHub-Login. Willst du zwei Agents gleichzeitig laufen lassen (zweiter Laptop, zweites Terminal), gib jedem eine eigene Kennung:

```bash
HACK_AGENT=adrijus-2 claude --permission-mode auto
```

## Testlauf vor dem Hackathon

Zwei Schalter verkürzen Wartezeiten. Sie gelten nur für den Agent, der mit ihnen gestartet wird:

- `HACK_STALE_MINUTES=10`: Ein liegengebliebener Task wird schon nach 10 statt nach 45 Minuten übernommen.
- `HACK_USAGE_HANDOFF_AT=35`: Die Übergabe kommt schon ab 35 % statt ab 92 %. Nimm einen Wert knapp über dem Stand in der Status-Zeile. Die Warnung (`HACK_USAGE_WARN_AT`) kommt nie später als die Übergabe.

```bash
HACK_STALE_MINUTES=10 claude --permission-mode auto
```

Unter Windows in PowerShell:

```powershell
$env:HACK_STALE_MINUTES = "10"; claude --permission-mode auto
```

## Grenzen der ersten Version

- Die Limit-Werte kommen aus der Status-Zeile von Claude Code (nur mit Pro-, Max- oder Ultra-Abo). Das Kit setzt dafür im Projekt eine eigene Status-Zeile, die deine persönliche weiter anzeigt. Läuft keine Status-Zeile (z. B. wenn die Desktop-App keine anzeigt), fehlt die Vorwarnung. Die Übergabe bei erreichtem Limit greift trotzdem.
- Ist das Wochenlimit aufgebraucht, wartet der Agent nicht tagelang, sondern hört auf und sagt Bescheid.
- GitHub benachrichtigt dich nicht über deine eigenen Aktionen. Stellt dein Agent eine Frage, bekommen nur die anderen eine Push.
- Die Pages-Vorschau gibt es nur für öffentliche Repos (bei privaten nur mit bezahltem GitHub-Plan).
- Die Agents reden asynchron miteinander. Eine Nachricht kommt innerhalb von etwa einer Minute an, nicht sofort.
- Unter Windows ist das Kit noch nicht in echt getestet, nur mit einem nachgestellten Windows-Klon.

## Update

```bash
claude plugin marketplace update hackathon-kit
```

```bash
claude plugin update hack@hackathon-kit
```

Danach Claude Code neu starten und `/hack:init` im Projekt erneut ausführen, wenn sich Workflows geändert haben (bestehende `ci.yml` und `preview.yml` bleiben unangetastet, außer mit `--force`).
