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

# After Phase 0 passes: per-plugin checks

Install each plugin from the `git-sideshow` marketplace (Customize → Plugins → Install), open a session in a git repo with some history, then:

## commit-constellations
1. Ask "show me the commit sky". See: side panel with stars, constellations, labels; the agent narrates in about 80 words.
2. Hover a star: tooltip. Click one: card with "Ask Copilot about this commit"; press it: the agent explains the commit.
3. Press Play history; drag the slider. Smooth on a repo with ~1500 commits?
4. Say "highlight <author>": the sky dims everything else **without reload** (this proves SSE or the polling fallback; note which took over: a delay of about 4 s means polling).
5. Open it in a folder that is not a repo: friendly empty message.

## build-horoscope
1. Ask "cast my build horoscope" on a feature branch. See: wheel with the sign lit, planets, rule-based reading; then the agent's reading replaces it (shows "Reading by Copilot").
2. Switch branch in the picker: wheel redraws, sign changes. On the default branch the sign is The North Star.
3. Press "Ask the stars again": the agent writes a new reading.
4. Check the numbers (behind/ahead, stashes, dirty files) against `git status` and `git rev-list --left-right --count main...HEAD`.

## standup-seance
1. Ask "hold a standup seance". See: board, candles, raw whispers list, then the planchette spells the headline and the parchment appears with Done / Next / Blockers.
2. Press Copy and paste somewhere: the update comes out as plain text.
3. Switch to "Last 7 days" and press Summon.
4. If commits you made through the GitHub web UI are missing: open "Extra email addresses", add your `...@users.noreply.github.com` address, Save, Summon again.
5. Settings should survive closing the canvas (file under `~/.copilot/extensions/standup-seance/settings.json`).

Report anything that differs, especially: panel never opens, "canvas not found", wrong folder (workspace), no live update, agent chats instead of calling `speak` / `deliver_reading`.
