Read CLAUDE.md, then docs/ROADMAP.md, then everything in docs/specs/, starting
with platform-contract.md and repo-and-skills.md.

This session is Phase 0 only: prove the platform before any real canvas exists.

1. Verify the platform contract. For each open point in platform-contract.md,
   check current GitHub docs and at least one working public canvas plugin.
   Record the date, the answer and the source in its Verification log. Mark
   anything you could not confirm as unverified, never as assumed.
2. Scaffold the repo layout from CLAUDE.md and create
   .github/plugin/marketplace.json with the verified field names.
3. Build a throwaway plugin, plugins/hello-canvas/:
   - a canvas that shows one line of text and the value of process.cwd()
   - one action, ping, that returns { pong: true, cwd }
   - one skill, say-hello, that opens the canvas and calls ping
   - list it in marketplace.json
4. Build test/ with the SDK stub and a smoke test for hello-canvas that runs
   with node --test.
5. Write a manual test checklist for me: add this repo as a marketplace in the
   Copilot app, install hello-canvas, run the skill, and what I should see at
   each step. Put it in docs/prompts/00-manual-test.md.
6. If anything verified contradicts the specs, update the specs and list each
   change.

Do not start Commit Constellations, Build Horoscope or Standup Séance.

Stop and report: what you verified (with sources), what you could not, the
spec changes, and the next step you recommend. Update docs/ROADMAP.md.
