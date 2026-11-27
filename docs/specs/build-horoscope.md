# Build Horoscope: implementation spec

A GitHub Copilot app canvas extension. It reads your branch's real signs (how far behind it is, how old, how messy) and delivers a daily horoscope on a star-chart wheel. Just for fun; scoped to one file.

## 1. Goal and non-goals

**Goal.** Open the canvas on any branch and get a zodiac sign, a chart of "planets" driven by real git signals, and a short reading written by the agent. A rule-based reading appears instantly, so the canvas works even if the agent never answers.

**Non-goals.** No CI or test-result integration in v0.1 (see 9). No persistence. No npm dependencies, no build step. No advice that pretends to be serious.

## 2. Platform contract

See [platform-contract.md](platform-contract.md).

## 3. Signals (all commands run on a fixture repo)

Resolve the default branch first: `git symbolic-ref -q --short refs/remotes/origin/HEAD`, falling back to local `main`, then `master`. Call it `<base>`.

| Signal | Command | Planet | Reads as |
|---|---|---|---|
| Commits behind base | `git rev-list --left-right --count <base>...HEAD` (first number) | Mercury | Retrograde when > 20 behind |
| Commits ahead of base | Same command (second number) | Jupiter | Expansion; "overreaching" when > 40 |
| Days since last sync | Committer date of `git merge-base <base> HEAD` | Saturn | Discipline; stern when > 14 days |
| Branch age | `git log --reverse --format=%aI <base>..HEAD`, first line | The Sun | Also decides the zodiac sign |
| Days since last commit | `git log -1 --format=%aI` | The Moon | New moon when > 7 days idle |
| Uncommitted files | `git status --porcelain`, line count | Venus | Attachment issues when > 10 |
| Stashes | `git stash list`, line count | Pluto | Buried secrets when > 3 |
| TODO / FIXME files | `git grep -c -I -E "TODO\|FIXME"`, line count | Neptune | Illusions and unfinished business |
| Lazy commit subjects on branch | `git log --format=%s <base>..HEAD`, count matching `^(wip\|fix\|tmp\|asdf\|\.)$` case-insensitive | Mars | Haste |
| Lucky file | `git log --name-only --format= <base>..HEAD`, most frequent path | none | Shown as "lucky file" |

**Pitfalls.**

- `--left-right --count` with `<base>...HEAD` prints **behind first, ahead second**. Easy to swap.
- `git grep` exits with code 1 when nothing matches. Treat that as zero, not as an error.
- On the default branch itself, `<base>..HEAD` is empty. Use the "trunk" reading (section 4.3) instead of showing zeros.
- A detached HEAD has no branch name. Show "a wandering star" and still compute what you can.
- Use `execFile` with argument arrays, never a shell. Cap `maxBuffer`.

## 4. The horoscope

### 4.1 Zodiac sign

Twelve developer signs, assigned by the **birth month** of the branch (first own commit). Deterministic, so a branch keeps its sign for life.

| Month | Sign | Trait |
|---|---|---|
| Jan | The Null Pointer | Points at nothing, with confidence |
| Feb | The Rubber Duck | Listens well, says little |
| Mar | The Hotfix | Fast, brave, rarely tested |
| Apr | The Yak | Started somewhere else entirely |
| May | The Linter | Has opinions about your whitespace |
| Jun | The Race Condition | Works on alternate Tuesdays |
| Jul | The Monolith | Large, loyal, hard to move |
| Aug | The Fork | Went its own way |
| Sep | The Cache | Remembers things that are no longer true |
| Oct | The Deadlock | Waiting for someone else to go first |
| Nov | The Merge | Brings people together, with conflicts |
| Dec | The Legacy | Nobody knows why it works |

### 4.2 Instant reading (rule-based)

One sentence per planet that crossed its threshold, most severe first, capped at three. Example templates:

- Mercury: "Mercury is in retrograde and so is your branch: {behind} commits behind {base}."
- Saturn: "Saturn notes you last synced {days} days ago and is not angry, only disappointed."
- Pluto: "{stashes} stashes lie buried. Pluto remembers every one."
- Nothing crossed: "The stars are aligned. Suspicious. Check again after lunch."

Plus three fixed lines: **Lucky file**, **Lucky number** (ahead count), and **Avoid today** (picked by the worst signal, for example "force-pushing" when behind, "starting something new" when stashes are high).

### 4.3 Trunk reading

On the default branch: sign is "The North Star", no Mercury or Saturn, and the reading uses commits in the last 7 days, dirty files and stashes only.

### 4.4 Agent reading

On Refresh (not on open: the skill drives the first reading, so opening costs no agent turn), the server calls `session.send` with the signal values, the sign and these instructions:

- Write a horoscope of at most 60 words in the voice of a newspaper astrologer.
- Every claim must trace back to a supplied signal. Do not invent facts about the repo.
- End with one concrete, sensible next step (for example "rebase before lunch").
- Deliver it by calling the `deliver_reading` action. Do not answer in chat.

Send numbers and branch names only: no file contents, no diffs.

## 5. Canvas layout

- **Wheel.** A star chart with twelve segments, the branch's sign lit. Planets sit on concentric orbits; each planet's angle maps its signal from 0 to its threshold and beyond, so a troubled planet visibly strays into the red arc.
- **Reading panel.** Sign name and trait, the reading, lucky file, lucky number, avoid today.
- **Retrograde.** Mercury orbits backwards when over threshold.
- **Controls.** Refresh, and a branch picker listing local branches so you can read a colleague's branch for fun.
- **Compatibility.** "Most compatible branch": the local branch with the smallest ahead + behind distance from the current one. "Least compatible": the largest.
- **Reduced motion.** With `prefers-reduced-motion`, planets are static.

## 6. Agent actions

| Action | Input | Effect |
|---|---|---|
| `deliver_reading` | `text` (max 400 chars), `nextStep` (max 120) | Replaces the instant reading in the panel |
| `read_signs` | `branch?` | Returns sign and all signal values |
| `refresh` | `branch?` | Recomputes and redraws |

## 7. Local endpoints

| Route | Purpose |
|---|---|
| `GET /` | The page |
| `GET /signs?branch=` | Signals, sign, instant reading, compatibility |
| `GET /events` | SSE: `{ type: "reading", … }`, `{ type: "refresh" }` |
| `POST /refresh` | Recompute, then trigger `session.send` |

Security as in the earlier specs: bind to `127.0.0.1`, per-instance token, `textContent` only, capped POST bodies. Validate the `branch` parameter against the output of `git for-each-ref refs/heads` before using it in any git command.

## 8. Packaging

See [repo-and-skills.md](repo-and-skills.md) for the plugin layout and [platform-contract.md](platform-contract.md) for the Agent Plugins 1.0 details still to verify.

## 9. Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Platform check | Hello canvas plus one action | Opens in the Copilot app |
| 1. Signs | Signal reader, sign, instant reading, JSON endpoint | Fixture test in section 10 passes |
| 2. Wheel | Chart, planets, panel, branch picker | Switching branch redraws correctly |
| 3. Agent | Prompt, `deliver_reading`, SSE | Agent reading replaces the instant one |
| 4. Plugin | Section 8 layout, marketplace entry | Installs from the marketplace on a clean machine |
| 5. CI omen (optional) | `gh run list --branch <b> --limit 5 --json conclusion` as an "Eclipse" planet | Shown only when `gh` is signed in |

## 10. Acceptance test for the signal reader

Fixture: `main` with 8 commits; `feature` forked 3 commits back with 2 own commits, one stash, one untracked file.

| Signal | Expected |
|---|---|
| Behind / ahead | 3 / 2 |
| Stashes | 1 |
| Uncommitted files | 1 |
| TODO files | 0, with no error raised |
| Default branch with no remote | Falls back to `main` |

## 11. Open questions

1. Are the thresholds in section 3 right for your repos? They are guesses tuned for short-lived feature branches.
2. Should the reading run automatically on open, or only when you press a button? Automatic costs one agent turn per open.
