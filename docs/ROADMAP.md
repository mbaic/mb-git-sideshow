# Roadmap

Update this file at the end of every session.

## Phase 0: platform check

- [x] Repo scaffold and `marketplace.json`
- [x] Throwaway `hello-canvas` plugin (canvas, one action, one skill)
- [x] SDK stub and test harness in `test/`
- [ ] Open points 1 to 5 in `docs/specs/platform-contract.md` answered (4 done; 1, 3, 5 need the manual test; 2 partly)
- [ ] Manual test in the Copilot app passed

## Commit Constellations

- [ ] Phase 1: static sky
- [ ] Phase 2: life (twinkle, shooting stars, time slider)
- [ ] Phase 3: agent actions, SSE, skill

## Build Horoscope

- [ ] Phase 1: signs
- [ ] Phase 2: wheel
- [ ] Phase 3: agent reading, skill
- [ ] Phase 5 (optional): CI omen

## Standup Séance

- [ ] Phase 1: lookup (local git, both ranges)
- [ ] Phase 2: board
- [ ] Phase 3: agent standup, skill
- [ ] Phase 4 (optional): GitHub search source

## Not started

- Git Weather Channel: needs a spec
- Dependency Tarot: needs a spec

## Decisions

| Date | Decision |
|---|---|
| 2026-11-21 | Keep canvas path `com.github.copilot/extensions/<id>/`; fall back to a plugin-root `extensions/` dir if manual test fails. Stub is a resolve hook in `test/stub/`. |
