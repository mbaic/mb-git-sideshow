# Commit Constellations: implementation spec

A GitHub Copilot app canvas extension that renders the current repository's git history as a night sky. Just for fun; scoped to one file.

## 1. Goal and non-goals

**Goal.** Open the canvas in any repo and see commits as stars, authors as named constellations, and reverts as shooting stars. The agent can refresh the sky, spotlight an author, and narrate what it sees.

**Non-goals.** No GitHub API calls, no auth, no persistence, no build step, no npm dependencies, no branch or file-level views, no marketplace packaging in v0.1.

## 2. Platform contract

See [platform-contract.md](platform-contract.md). Build nothing here until its open points are verified.

## 3. Architecture

One file, three parts:

1. **Git reader** (Node): runs `git log`, parses it, derives constellations.
2. **Loopback server** (Node `http`, port 0 on `127.0.0.1`), one per canvas instance.
3. **Page** (inline HTML string): a 2D `<canvas>` renderer plus a small DOM overlay.

Agent-driven changes reach the page over Server-Sent Events. The page never talks to anything except its own loopback server.

**Pitfall.** The page lives inside a JS string in the module. Use `String.raw` and keep template literals out of the client script, otherwise `${}` and backslashes get interpreted by the module.

## 4. Data

### 4.1 Git command

```
git log -n<limit> --pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s --shortstat
```

- `%x1e` separates records and `%x1f` separates fields, so subjects with any punctuation parse safely.
- Use `execFile` (no shell), `cwd: process.cwd()`, `maxBuffer` 64 MB, `windowsHide: true`.
- `limit` defaults to 1500, capped at 5000.
- Insertions and deletions come from the `--shortstat` line; merge commits have none and count as size 0.

### 4.2 Model sent to the page

```
sky = {
  repo, generatedAt, truncated, reverts, highlight,
  authors: [{ name, constellation, epithet, commits }],   // top 12 by commit count
  commits: [{ h, d, s, i, x, r, c }]                      // newest first
}
```

`h` short hash (10 chars), `d` ISO author date with offset, `s` subject, `i`/`x` insertions/deletions, `r` is-revert (subject matches `/^revert\b/i`), `c` index into `authors` or `-1` for everyone else.

On failure return `{ repo, error, commits: [], authors: [] }` with a friendly message for "git not on PATH" and "not a repository".

### 4.3 Constellation name

First word of the author name, capitalised, slotted into one of eight patterns chosen by a stable hash (FNV-1a) of the full name: `X Major`, `X Minor`, `Corona X`, `X Borealis`, `Canis X`, `X Australis`, `Ursa X`, `Nebula X`.

### 4.4 Epithet (first match wins)

Hour and weekday are read from the author's own timestamp string, not converted to the viewer's zone.

| Rule | Epithet |
|---|---|
| Reverts >= max(2, 5% of commits) | the Time Traveller |
| More than 35% of commits between 22:00 and 04:00 | the Midnight Committer |
| More than 12% on Friday after 15:00 | the Friday Deployer |
| More than 30% at weekends | the Weekend Warrior |
| Deletions > 1.2 x insertions and > 200 lines | the Great Deleter |
| Mean commit size > 400 lines | the Monolith Builder |
| Median commit size <= 4 lines, at least 5 commits | the Typo Hunter |
| Mean subject length < 12 characters | of Few Words |
| Otherwise, by hash | the Steady Hand / the Quiet Maintainer / the Reliable Orbit |

## 5. Rendering rules

- **Background.** Vertical gradient from near-black to deep blue, about 220 fixed dust pixels from a seeded generator.
- **Constellation placement.** Sunflower (golden-angle) layout so the busiest author sits in the centre. Region radius scales with `1 / sqrt(authorCount)`.
- **Star position.** Deterministic from the commit hash (two 5-hex-digit slices give angle and distance), so the sky is identical on every open.
- **Star size.** `0.6 + min(3.2, log10(1 + insertions + deletions) * 0.9)` px.
- **Star colour.** Blue-white for pure additions, shifting to warm orange as the deletion share rises.
- **Figure lines.** Each constellation joins its seven largest commits with a nearest-neighbour chain starting at the leftmost. Those seven also get a soft halo.
- **Field stars.** Commits by authors outside the top 12 scatter dimly across the whole sky.
- **Labels.** Constellation name in spaced capitals under the cluster; epithet and author name in italics beneath.
- **Twinkle.** Slow sine on alpha with a per-star phase.
- **Shooting stars.** Every few seconds one visible revert streaks diagonally with its subject trailing as text.
- **Reduced motion.** With `prefers-reduced-motion`, no twinkle and no shooting stars.
- **Sizing.** Handle resize and `devicePixelRatio`.

## 6. Interactions

| Control | Behaviour |
|---|---|
| Hover a star | Tooltip: subject, author, date, +/-, short hash |
| Click a star | Pins a card with an "Ask Copilot about this commit" button, which calls `session.send` |
| Time slider | Shows the sky up to that commit; label shows the date |
| Play history | Animates the slider from the first commit to the last |
| Refresh | Re-reads git and redraws |

Sending a prompt is always a deliberate button press, never a side effect of clicking a star.

## 7. Agent actions

| Action | Input | Returns |
|---|---|---|
| `refresh` | `maxCommits?` (1 to 5000) | Sky report |
| `highlight_author` | `author` (substring; empty clears) | `{ highlight }`; page dims everything else |
| `sky_report` | none | Repo, star count, shooting stars, date range, constellations with epithets |

## 8. Local endpoints

| Route | Purpose |
|---|---|
| `GET /` | The page |
| `GET /data` | Sky JSON |
| `GET /events` | SSE: `{ type: "refresh" }`, `{ type: "highlight", author }` |
| `POST /refresh` | Re-read git, broadcast refresh |
| `POST /ask` | Body `{ hash }`; validates `/^[0-9a-f]{7,40}$/`, then `session.send` |

**Security.** Bind to `127.0.0.1` only. Generate a random token per instance, put it in the URL returned by `open`, and reject any request without it, so other local pages cannot read commit data off the port. Render all git text with `textContent` or canvas `fillText`, never as HTML. Cap POST bodies at 4 KB.

## 9. Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Platform check | Minimal canvas that opens a "hello" page | It opens in the Copilot app and one action round-trips |
| 1. Static sky | Git reader, layout, stars, figures, labels, hover | A real repo renders and is identical across reloads |
| 2. Life | Twinkle, shooting stars, time slider, play | History plays start to end without frame drops at 1500 commits |
| 3. Agent | Three actions, SSE, "Ask Copilot" card | Asking the agent to spotlight an author updates the open canvas |

## 10. Acceptance criteria

1. Opens in a repo with no configuration and no network access.
2. A non-git folder shows a friendly empty state, not an error page.
3. 1500 commits animate smoothly; 5000 still load.
4. A request to the server without the token gets 403.
5. Commit subjects containing HTML or quotes display literally.
6. Closing the canvas frees the port.

## 11. Testing without the Copilot app

Stub the SDK so the module runs under plain Node: a local `node_modules/@github/copilot-sdk` whose `createCanvas` returns its argument and whose `joinSession` captures the canvases and returns `{ send, log }` fakes. A harness can then call `open`, fetch `/data`, invoke each action handler, and screenshot the URL with headless Chrome or Edge.

Unit-test the pure parts: log parsing, constellation naming, each epithet rule.

## 12. Open questions

1. Does `process.cwd()` point at the workspace when the extension is installed at user scope? If not, find the session's workspace path in the SDK.
2. Does the host canvas webview allow `EventSource` to loopback? If not, fall back to polling `/data`.
3. Should author identities be merged by email (`%ae`) so one person with two names is one constellation? Left out of v0.1.
