# One repo, one marketplace, five plugins: layout and skill drafts

Repo and marketplace name: `mb-git-sideshow`.

## 1. Repo layout

One plugin per canvas. Each plugin carries its canvas and the skill that runs it.

```
mb-git-sideshow/
├── .github/plugin/marketplace.json
├── README.md
└── plugins/
    ├── commit-constellations/
    │   ├── plugin.json
    │   ├── skills/mb-read-commit-sky/SKILL.md
    │   └── com.github.copilot/extensions/mb-commit-constellations/extension.mjs
    ├── standup-seance/
    │   ├── plugin.json
    │   ├── skills/mb-hold-standup-seance/SKILL.md
    │   └── com.github.copilot/extensions/mb-standup-seance/extension.mjs
    ├── build-horoscope/
    │   ├── plugin.json
    │   ├── skills/mb-cast-build-horoscope/SKILL.md
    │   └── com.github.copilot/extensions/mb-build-horoscope/extension.mjs
    ├── dependency-tarot/          (same shape, skill: draw-dependency-tarot)
    └── git-weather-channel/       (same shape, skill: forecast-git-weather)
```

Install then reads as `mb-standup-seance@mb-git-sideshow`.

**Still to verify (manual test):** that canvases load from `com.github.copilot/extensions/` inside a plugin (see [platform-contract.md](platform-contract.md)).

## 2. What changes in the three existing specs

The skill becomes the home of the agent's instructions. Each canvas's `session.send` prompt shrinks to the data plus one line: "Use the `<skill-name>` skill." Voice, rules and word limits live in the skill only, so they are edited in one place.

Skills drive the canvas with the two host tools seen in public canvas repos:

```
open_canvas({ canvasId, instanceId })
invoke_canvas_action({ instanceId, actionName, input })
```

**Pitfall.** Those tool names come from one third-party README (`open_canvas` also takes optional `input`; `list_canvas_capabilities` exists), not from official docs. Phase 0 manual test confirms them. The skills below name them once each, so a rename is a five-line fix.

## 3. Skill drafts

### 3.1 `plugins/mb-commit-constellations/skills/mb-read-commit-sky/SKILL.md`

```markdown
---
name: mb-read-commit-sky
description: Show the repository's git history as a night sky and narrate it. Use when the user asks for commit constellations, the commit sky, a star map of the repo, or who the repo's constellations are.
---

# Read the commit sky

1. Open the canvas: `open_canvas` with canvasId `commit-constellations`.
2. Call `invoke_canvas_action` with actionName `sky_report`.
3. Narrate the result in at most 80 words, as a planetarium guide:
   name the two or three largest constellations with their epithets,
   mention the number of shooting stars (reverts), and the date range.
4. If the user names a person, call `highlight_author` with that name.
   Pass an empty string to clear the spotlight.
5. If the report has an `error`, relay it plainly and stop.

Rules:
- Only state what the report contains. Do not guess at why someone commits when they do.
- Epithets are jokes about commit patterns, not judgements of people. Keep the tone kind.
- For more history, call `refresh` with `maxCommits` (up to 5000).
```

### 3.2 `plugins/mb-standup-seance/skills/mb-hold-standup-seance/SKILL.md`

```markdown
---
name: mb-hold-standup-seance
description: Summon the user's recent commits on a spirit board and write their standup update. Use when the user asks for a standup, a standup séance, what they did yesterday, or a summary of their last 7 days of commits.
---

# Hold a standup séance

1. Open the canvas: `open_canvas` with canvasId `standup-seance`.
2. Pick the range: `yesterday` by default, `week` if the user says week, 7 days or sprint.
3. Call `invoke_canvas_action` with actionName `read_whispers` and that range.
4. Write the standup from the returned commits:
   - `done`: 2 to 5 bullets, grouped by theme, not one per commit.
   - `next`: only if the commits make it obvious. Otherwise leave empty.
   - `blockers`: leave empty unless the user told you one.
   - `headline`: at most 40 characters, letters, digits and spaces only.
5. Deliver it by calling `speak` with those four fields. Do not also paste it in chat;
   reply with one line saying the spirits have spoken.

Rules:
- Base `done` strictly on the commits. Never invent work.
- If there are no commits, call `speak` with headline `THE SPIRITS ARE SILENT` and empty lists.
- Reverts and late-night commits may be mentioned lightly, never mockingly.
```

### 3.3 `plugins/mb-build-horoscope/skills/mb-cast-build-horoscope/SKILL.md`

```markdown
---
name: mb-cast-build-horoscope
description: Cast a horoscope for the current git branch from its real signals. Use when the user asks for a build horoscope, branch horoscope, what the stars say about their branch, or a fun branch health check.
---

# Cast the build horoscope

1. Open the canvas: `open_canvas` with canvasId `build-horoscope`.
2. Call `invoke_canvas_action` with actionName `read_signs`.
   Pass `branch` only if the user named one.
3. Write the reading:
   - At most 60 words, in the voice of a newspaper astrologer.
   - Open with the sign. Mention at most three planets, worst first.
   - Every claim must trace to a returned signal value.
4. Write `nextStep`: one concrete, sensible action, at most 120 characters
   (for example "Rebase onto main before lunch").
5. Deliver by calling `deliver_reading` with `text` and `nextStep`.
   Reply in chat with one line only.

Rules:
- The joke is the voice, not the facts. Numbers must be the real ones.
- On the default branch the sign is The North Star; skip Mercury and Saturn.
- If nothing crossed a threshold, say the stars are aligned and suggest shipping.
```

### 3.4 `plugins/mb-dependency-tarot/skills/mb-draw-dependency-tarot/SKILL.md` (provisional)

No spec exists yet, so the canvas id and action names here are placeholders.

```markdown
---
name: draw-dependency-tarot
description: Draw three tarot cards from the project's dependencies and read them. Use when the user asks for dependency tarot, a reading of their packages, or a fun look at outdated dependencies.
---

# Draw the dependency tarot

1. Open the canvas: `open_canvas` with canvasId `dependency-tarot`.
2. Call `invoke_canvas_action` with actionName `draw_cards`.
   It returns three dependencies as past, present and future, each with
   current version, latest known version and the card assigned to it.
3. Write one sentence per card, at most 25 words each, as a tarot reader.
4. Deliver by calling `deliver_reading` with the three sentences.

Rules:
- Version facts come from the action result only. Never recall versions from memory.
- If latest versions are unknown (offline), read the cards on current versions alone and say so.
- End with one real recommendation: the single upgrade most worth doing.
```

### 3.5 `plugins/mb-git-weather-channel/skills/mb-forecast-git-weather/SKILL.md` (provisional)

No spec exists yet, so the canvas id and action names here are placeholders.

```markdown
---
name: forecast-git-weather
description: Present the repository's recent change activity as a weather forecast. Use when the user asks for the git weather, a repo forecast, where the storms are, or which folders are churning.
---

# Forecast the git weather

1. Open the canvas: `open_canvas` with canvasId `git-weather-channel`.
2. Call `invoke_canvas_action` with actionName `read_forecast`.
   Pass `days` if the user gave a period; the default is 14.
3. Write a presenter's script of at most 70 words: the stormiest folder first,
   one calm region, then an outlook line.
4. Deliver by calling `deliver_script` with the text.

Rules:
- Storm means high churn, not bad code. Do not call a folder broken.
- Name folders exactly as returned.
- If the repo had no changes in the period, forecast clear skies and stop.
```

## 4. `marketplace.json` sketch

```json
{
  "name": "mb-git-sideshow",
  "owner": { "name": "mbaic" },
  "plugins": [
    { "name": "commit-constellations", "version": "0.1.0", "source": "./plugins/mb-commit-constellations", "description": "Your git history as a night sky." },
    { "name": "standup-seance",        "version": "0.1.0", "source": "./plugins/mb-standup-seance",        "description": "A spirit board that writes your standup from your commits." },
    { "name": "build-horoscope",       "version": "0.1.0", "source": "./plugins/mb-build-horoscope",       "description": "A daily horoscope for your branch, from real git signals." }
  ]
}
```

Add `dependency-tarot` and `git-weather-channel` when their specs exist. Check field names against the CLI plugin reference; this sketch follows the shape described in public guides.
