# CLAUDE.md

## What this repo is

`git-sideshow` is one GitHub repo that is also one GitHub Copilot plugin marketplace. It holds just-for-fun canvas plugins for the GitHub Copilot app. Each plugin ships exactly one canvas extension and one skill that drives it.

| Plugin | Spec | Status |
|---|---|---|
| commit-constellations | `docs/specs/commit-constellations.md` | Specced |
| build-horoscope | `docs/specs/build-horoscope.md` | Specced |
| standup-seance | `docs/specs/standup-seance.md` | Specced |
| git-weather-channel | none yet | Do not build |
| dependency-tarot | none yet | Do not build |

Progress lives in `docs/ROADMAP.md`. Read it at the start of every session and update it at the end.

## Sources of truth

- **Behaviour:** the specs in `docs/specs/`.
- **Platform APIs:** the real platform. `docs/specs/platform-contract.md` records what has been verified. If the platform disagrees with a spec, the platform wins: update the spec in the same change and say so in your report.
- Canvas extensions and Agent Plugins 1.0 are new. Do not rely on memory for their APIs. Check current GitHub docs or a working public plugin, and log what you checked in the contract's Verification log.

## Layout

```
.github/plugin/marketplace.json        marketplace manifest
plugins/<plugin>/plugin.json           Agent Plugins 1.0 manifest
plugins/<plugin>/skills/<skill>/SKILL.md
plugins/<plugin>/com.github.copilot/extensions/<plugin>/extension.mjs
docs/specs/                            specs and the platform contract
docs/prompts/                          session start prompts
docs/reference/                        prototype code, reference only
test/                                  SDK stub, fixture builders, smoke tests
```

## Rules

- One file per canvas: `extension.mjs`. Node built-ins only. No npm dependencies, no build step, no bundler.
- Keep it simple. Do not add features, abstractions, config or tooling the specs do not ask for.
- Run git with `execFile` and argument arrays. Never a shell, never string-built commands.
- Loopback server on `127.0.0.1` only, per-instance token in the URL, reject requests without it.
- Render all repo-derived text with `textContent` or canvas `fillText`. Never `innerHTML`.
- Keep the agent's voice and rules in the plugin's `SKILL.md`. The canvas prompt carries data plus "use the `<skill>` skill".
- `docs/reference/` is an untested prototype. Borrow patterns from it, do not copy it wholesale.
- Do not touch plugins outside the current task.

## Working method

- One phase per session. Stop at the end of the phase and report.
- Before writing code for a phase, restate the phase's "done when" line from the spec.
- Tests: unit-test the pure logic (parsing, naming, rules). Build git fixture repos in a temp folder with `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`. Smoke-test each canvas against the SDK stub. Run tests with `node --test`.
- You cannot see the Copilot app unless you are running inside it. When a check needs the app, write a short manual test checklist: exact steps and what the user should see.
- End-of-phase report: what was built, what was verified and how, what could not be verified, spec changes, next recommended step.

## Commits

- Small commits, imperative subject, scoped by plugin: `build-horoscope: add signal reader`.
- Bump the plugin's version in both `plugin.json` and `marketplace.json` when its behaviour changes.
