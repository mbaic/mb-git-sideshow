# Phase 0 manual test (GitHub Copilot app)

Goal: answer open points 1, 2, 3 and 5 in `docs/specs/platform-contract.md`. Branch to test: the PR branch (add it as `mbaic/mb-git-sideshow#<branch>` if the app accepts a ref, otherwise merge first).

1. **Add the marketplace.** Customize → Plugins → icon next to the marketplace dropdown → enter `mbaic/mb-git-sideshow`.
   See: marketplace `git-sideshow` appears, with `hello-canvas` listed. If it does not, marketplace.json field names are wrong: note the error.
2. **Install.** Click Install on `hello-canvas`.
   See: it shows as installed. (CLI alternative: `copilot plugin marketplace add mbaic/mb-git-sideshow`, `copilot plugin install hello-canvas@git-sideshow`.)
3. **Canvas discovered (point 1).** Start a new session in some repo, open the canvas catalog / ask "which canvases are available?".
   See: "Hello Canvas". If it is missing, the plugin path `com.github.copilot/extensions/` is not loaded. Try moving the folder to `plugins/hello-canvas/extensions/hello-canvas/` and reinstall.
4. **Run the skill (point 2).** Type "say hello" (skill `say-hello`).
   See: a side panel opens with "Hello from hello-canvas", `cwd` and `workspacePath`; the agent replies with one line `pong true`, cwd, workspacePath. Note the exact tool names the agent shows it called (expect `open_canvas`, `invoke_canvas_action`).
5. **Workspace folder (point 3).** Compare `cwd` and `workspacePath` with the repo folder of that session.
   Record which one equals the repo folder (if neither does, say what they show).
6. **Close.** Close the panel. See: no errors. Reopen via "say hello": a working panel again.
7. **SSE (point 5, optional).** Not exercised by hello-canvas; leave unverified until Phase 1 of a real canvas.

Report back: pass/fail per step, the cwd and workspacePath values, and tool names seen.
