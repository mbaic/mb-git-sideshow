# Standup Séance: implementation spec

A GitHub Copilot app canvas extension. A ouija board summons your recent commits and spells out your standup update. Just for fun; scoped to one file.

## 1. Goal and non-goals

**Goal.** Press "Summon", pick **Yesterday** or **Last 7 days**, and get a standup update built from your own commits, delivered by a planchette gliding over a spirit board.

**Non-goals.** No issue, PR or calendar data. No persistence beyond one small settings file. No npm dependencies, no build step. No posting to Teams or Slack.

## 2. Finding "my commits" (proven)

No single source returns every commit you made everywhere. Two sources cover it between them:

| | A. Local git (v0.1, default) | B. GitHub search (v0.2, optional) |
|---|---|---|
| Scope | The workspace repo | Every repo on GitHub you can see |
| Branches | All local and fetched branches | Default branch only |
| Unpushed work | Included | Not included |
| Needs | `git` on PATH | `gh` CLI, signed in |
| Offline | Yes | No |
| Status | Proven end to end on a fixture repo | Query shape accepted by the API; not tested against a real account |

### 2.1 Source A: the two-step query

The obvious query is wrong in both directions. `git log --since/--until` filters on **committer** date and only walks the current branch, so on the fixture it returned 2 commits for "yesterday": one false positive (authored 10 days ago, rebased yesterday) and only 1 of the 4 real ones.

**Step 1, coarse prefilter in git** (uses `--fixed-strings` so emails match literally; Node re-checks the exact email; git stops walking at the first commit older than `--since`, so wildly out-of-order committer dates could hide commits):

```
git log --all --no-merges --author=<EMAIL_1> --author=<EMAIL_2> --since=<windowStartIso> --pretty=format:%h%x1f%aI%x1f%s
```

- `--all` picks up unmerged branches.
- Multiple `--author` flags are OR-ed. Keep the literal angle brackets around each email so it matches the whole address.
- `--since` only, no `--until`. A commit's committer date is never earlier than its author date in normal use, so this is a safe superset.
- Pass explicit ISO timestamps with offset, computed in Node. Do not use git's "yesterday" words.

**Step 2, exact filter in Node:**

1. Keep commits whose **author** date falls inside `[windowStart, windowEnd)`.
2. Drop duplicates by `authorDate + subject`. A rebased or cherry-picked commit exists under two hashes.

Fixture result for "yesterday": exactly the 4 expected commits (unmerged branch, rebased copy counted once, noreply email, 00:05 edge case). "Last 7 days": exactly 6.

### 2.2 Identity

- Default email: `git config user.email`.
- Extra emails: user-supplied list, needed because commits made through the GitHub web UI or squash merges often carry the `…@users.noreply.github.com` address. Without it those commits are silently missed.
- Store the list in a small JSON file at `$COPILOT_HOME/extensions/standup-seance/settings.json` (a plugin install folder may be replaced on update, so not beside the extension). Never send emails to the agent or any remote service.

### 2.3 Source B: GitHub search (v0.2)

```
gh api -X GET search/commits -f q="author:@me author-date:>=YYYY-MM-DD" -f per_page=100
```

- Run only when `gh auth status` succeeds; otherwise hide the toggle.
- Merge with Source A results and dedupe on `authorDate + subject`.
- Label results clearly: "pushed, default branch only".
- Open question: confirm `author:@me` resolves in the commit search API; if not, resolve the login once with `gh api user`.

### 2.4 The two ranges

| Option | Window (local time zone) |
|---|---|
| Yesterday | Previous calendar day, 00:00 to 00:00. On Monday it widens to Friday 00:00 through Monday 00:00, so weekend work is included. |
| Last 7 days | 00:00 six days ago through now, including today. Grouped by day. |

Assumption to confirm: the Monday rule. The alternative is strict "previous calendar day", which on Monday shows only Sunday.

## 3. Platform contract

See [platform-contract.md](platform-contract.md).

## 4. How the séance works

1. User picks a range and presses **Summon**.
2. Server runs the lookup and returns the commit list. The page shows it at once as "raw whispers", so the canvas is useful even if the agent never answers.
3. Server calls `session.send` with the commit subjects and asks the agent to write a standup and deliver it through the `speak` action.
4. The agent calls `speak`. The server pushes the text to the page over SSE.
5. The planchette spells the **headline** letter by letter, then the full update fades in on a parchment panel with a **Copy** button.

**Pitfall.** Spelling the whole update letter by letter takes minutes. Only the headline (40 characters max) is spelled.

### 4.1 Prompt sent to the agent

Include: range label, commit subjects grouped by day (and by repo in v0.2), and these instructions:

- Write a standup with three parts: Done, Next, Blockers.
- Base Done strictly on the commits; mark Next and Blockers as guesses or leave them empty.
- Also write a headline of at most 40 characters using only letters, digits and spaces.
- Deliver it by calling the `speak` action. Do not answer in chat.

Send subjects only: no diffs, no emails.

## 5. Agent actions

| Action | Input | Effect |
|---|---|---|
| `speak` | `headline` (max 40), `done[]`, `next[]`, `blockers[]` | Board spells the headline, panel shows the update |
| `summon` | `range`: `yesterday` or `week` | Same as pressing Summon |
| `read_whispers` | `range` | Returns the commit list so the agent can answer questions |

## 6. Board and theatrics

- **Board.** Two arcs of letters A to Z, a row of digits, YES and NO in the top corners, GOODBYE at the bottom. Drawn in SVG or on a 2D canvas.
- **Planchette.** Eases between letter positions, pauses on each, and drifts slightly while idle. Rests on GOODBYE when done.
- **Candles.** One per commit, up to 13. They flicker.
- **No commits.** Planchette slides to NO. Text: "The spirits are silent. Did you work yesterday?"
- **Reverts.** Flagged as "a restless spirit".
- **Commits between 00:00 and 04:00.** Flagged as "witching hour".
- **Friday commits after 15:00.** Flagged as "a brave soul".
- **Reduced motion.** With `prefers-reduced-motion`, skip the spelling and show the text directly.

## 7. Local endpoints

| Route | Purpose |
|---|---|
| `GET /` | The page |
| `POST /summon` | Body `{ range }`; returns commits, then triggers `session.send` |
| `GET /events` | SSE: `{ type: "speak", … }`, `{ type: "summon", range }` |
| `GET /settings`, `POST /settings` | Read and save extra emails and the GitHub toggle |

Security is the same as the constellations spec: bind to `127.0.0.1`, per-instance token in the URL, reject requests without it, render all text with `textContent`, cap POST bodies. Validate each email with a strict pattern before it reaches the git argument list, and always use `execFile`, never a shell.

## 8. Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Platform check | Hello canvas, one action round trip | Opens in the Copilot app |
| 1. Lookup | Source A, both ranges, settings for extra emails | Fixture test in section 9 passes |
| 2. Board | Board, planchette, candles, raw whispers | Summon shows commits and spells a fixed test headline |
| 3. Agent | Prompt, `speak`, parchment, Copy | Agent-written standup arrives and is spelled |
| 4. GitHub (optional) | Source B and merge | Commits from a second repo appear, labelled |

## 9. Acceptance test for the lookup

Build a fixture repo with these commits and assert "yesterday" returns exactly the four marked ones:

| Commit | Expected |
|---|---|
| Authored yesterday 00:05 | Included |
| Authored yesterday, rebased today, also present on a second branch | Included once |
| Authored yesterday with the noreply email | Included |
| Authored yesterday on an unmerged branch | Included |
| Authored 10 days ago, rebased yesterday | Excluded |
| Authored yesterday by a colleague | Excluded |
| Authored today | Excluded from Yesterday, included in Last 7 days |
| Authored 6 days ago | Included in Last 7 days only |

Set dates with `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`.

## 10. Open questions

1. Monday rule for "Yesterday" (section 2.4).
2. Is one workspace repo enough for v0.1, or do you need several local repos? If several, add a list of root folders to scan before reaching for Source B.
3. Does the agent reliably call `speak` instead of answering in chat? If not, add a "Paste the reply" fallback.
