---
name: cast-build-horoscope
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
5. Deliver by calling `deliver_reading` with `text` and `nextStep` (and `branch` if you passed one to `read_signs`).
   Reply in chat with one line only.

Rules:
- The joke is the voice, not the facts. Numbers must be the real ones.
- On the default branch the sign is The North Star; skip Mercury and Saturn.
- If nothing crossed a threshold, say the stars are aligned and suggest shipping.
