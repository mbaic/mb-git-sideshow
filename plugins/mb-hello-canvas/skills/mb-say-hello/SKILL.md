---
name: mb-say-hello
description: Open the hello-canvas canvas and ping it. Use when the user asks to say hello, test hello-canvas, or check that the mb-git-sideshow plugin platform works.
---

# Say hello

1. Open the canvas: `open_canvas` with canvasId `hello-canvas`.
2. Call `invoke_canvas_action` with actionName `ping` (use the instanceId returned by step 1).
3. Reply in one line with the `pong`, `cwd` and `workspacePath` values from the result.

Rules:
- Report the values exactly as returned. If the call fails, quote the error and stop.
