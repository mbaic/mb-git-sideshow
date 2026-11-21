---
name: read-commit-sky
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
