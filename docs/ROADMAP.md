# Roadmap

Update this file at the end of every session.

## Phase 0: platform check

- [x] Repo scaffold and `marketplace.json`
- [x] Throwaway `hello-canvas` plugin (canvas, one action, one skill)
- [x] SDK stub and test harness in `test/`
- [ ] Open points 1 to 5 in `docs/specs/platform-contract.md` answered (4 done; 1, 3, 5 need the manual test; 2 partly)
- [ ] Manual test in the Copilot app passed (checklist: `docs/prompts/00-manual-test.md`)

## Commit Constellations

- [x] Phase 1: static sky (code and tests done; app check pending)
- [x] Phase 2: life (twinkle, shooting stars, time slider) (code and tests done; app check pending)
- [x] Phase 3: agent actions, SSE, skill (code and tests done; app check pending)

## Build Horoscope

- [x] Phase 1: signs (code and tests done; app check pending)
- [x] Phase 2: wheel (code and tests done; app check pending)
- [x] Phase 3: agent reading, skill (code and tests done; app check pending)
- [ ] Phase 5 (optional): CI omen

## Standup Séance

- [x] Phase 1: lookup (local git, both ranges) (code and tests done; app check pending)
- [x] Phase 2: board (code and tests done; app check pending)
- [x] Phase 3: agent standup, skill (code and tests done; app check pending)
- [ ] Phase 4 (optional): GitHub search source

## Not started

- Git Weather Channel: needs a spec
- Dependency Tarot: needs a spec

## Decisions

| Date | Decision |
|---|---|
| 2026-11-21 | Keep canvas path `com.github.copilot/extensions/<id>/`; fall back to a plugin-root `extensions/` dir if manual test fails. Stub is a resolve hook in `test/stub/`. |
| 2026-11-21 | Phases 1-3 of all three plugins built in one go on branch `claude/project-thread-v37617` (Phase 0 manual test still pending, so every platform assumption is isolated and labelled `PLATFORM ASSUMPTIONS` at the top of each `extension.mjs`). |
| 2026-11-21 | Build Horoscope does not message the agent on open (the skill drives it); only the Refresh button does. Resolves open question 2. |
| 2026-11-21 | Build Horoscope extra thresholds (spec silent): Mars > 2 lazy commits, Neptune > 25 TODO files. On trunk only Moon, Venus, Pluto show. |
| 2026-11-21 | Standup Seance: Monday rule adopted as specced; settings stored in `$COPILOT_HOME/extensions/standup-seance/settings.json`; optional Phase 4 (GitHub search) and Build Horoscope Phase 5 (CI omen) skipped. |
| 2026-11-26 | Commit Constellations: probe several folders for the repo and show tried folders plus git stderr in the empty state (workspacePath alone was not the repo). Build Horoscope and Standup Seance got the same probe (v0.1.1); the helper is copied into each `extension.mjs` because plugins install separately and cannot share a module. |
| 2026-11-26 | Build Horoscope lists local branches plus remote-only ones (shown as `origin/x`, deduped, no `origin/HEAD`); compatibility looks at the 40 newest branches to bound git calls. v0.1.2. |
| 2026-11-26 | All plugins renamed with an `mb-` prefix (plugin names, plugin and extension folders, v0.2.0). Canvas ids, skill names and the Standup Seance settings path are unchanged so skills, prompts and saved settings keep working. |
| 2026-11-26 | Marketplace renamed from `git-sideshow` to `mb-git-sideshow` to match the repo; installs read `<plugin>@mb-git-sideshow`. |
| 2026-11-26 | Skills renamed with an `mb-` prefix (`mb-read-commit-sky`, `mb-cast-build-horoscope`, `mb-hold-standup-seance`, `mb-say-hello`); canvas prompts say "Use the mb-<skill> skill". Plugins 0.3.0. Skill descriptions are unchanged, so trigger phrases still match. |
| 2026-11-27 | Release 0.4.0: marketplace and all plugins bumped. History squashed to a single commit. |
