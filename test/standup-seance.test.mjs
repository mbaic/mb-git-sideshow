import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRepo, commit, git, loadExtension } from "./lib/fixture.mjs";

const settingsDir = mkdtempSync(join(tmpdir(), "seance-settings-"));
process.env.STANDUP_SEANCE_SETTINGS = join(settingsDir, "settings.json");

// Wednesday 2026-03-18 12:00 local. Dates are built in local time so the test is TZ-independent.
const NOW = new Date(2026, 2, 18, 12, 0);
const at = (day, h, m = 0) => new Date(2026, 2, day, h, m).toISOString();
const NOREPLY = "12345+test@users.noreply.github.com";

const repo = makeRepo();
// Commits are created in committer-date order, like real history: git's --since walk stops at the
// first commit older than the cut-off, so an out-of-order fixture would hide commits.
commit(repo, { message: "base", date: at(1, 9), files: { "base.txt": "b\n" } });
commit(repo, { message: "six days ago", date: at(12, 9) });
commit(repo, { message: "yesterday edge", date: at(17, 0, 5) });
commit(repo, { message: "ten days old, rebased yesterday", date: at(8, 10), committerDate: at(17, 11) });
commit(repo, { message: "by colleague", date: at(17, 11), name: "Col", email: "col@example.com" });
commit(repo, { message: "via github ui", date: at(17, 13), email: NOREPLY });
git(repo, ["branch", "side", "HEAD"]);
commit(repo, { message: "rebased copy", date: at(17, 10), committerDate: at(18, 9) });
commit(repo, { message: "today", date: at(18, 9) });
git(repo, ["checkout", "-q", "side"]);
commit(repo, { message: "unmerged branch work", date: at(17, 15), committerDate: at(17, 15) });
commit(repo, { message: "rebased copy", date: at(17, 10), committerDate: at(18, 9) }); // second hash, same author date + subject
git(repo, ["checkout", "-q", "main"]);

process.env.STUB_WORKSPACE = repo;
const ext = await loadExtension("plugins/standup-seance/com.github.copilot/extensions/standup-seance/extension.mjs");
ext.mod.clock.now = () => NOW;
const canvas = ext.canvases.find((c) => c.id === "standup-seance");
const act = (name, input = {}) => canvas.actions.find((a) => a.name === name).handler({ input, instanceId: "t" });
const subjects = (r) => r.commits.map((c) => c.subject).sort();

test("yesterday: exactly the four expected commits", async () => {
  const r = await ext.mod.lookup("yesterday", { now: NOW, extraEmails: [NOREPLY] });
  assert.deepEqual(subjects(r), ["rebased copy", "unmerged branch work", "via github ui", "yesterday edge"]);
});

test("yesterday without the noreply email misses the web-UI commit (why the setting exists)", async () => {
  const r = await ext.mod.lookup("yesterday", { now: NOW, extraEmails: [] });
  assert.ok(!subjects(r).includes("via github ui"));
  assert.equal(r.commits.length, 3);
});

test("last 7 days: exactly the six expected commits", async () => {
  const r = await ext.mod.lookup("week", { now: NOW, extraEmails: [NOREPLY] });
  assert.deepEqual(subjects(r), ["rebased copy", "six days ago", "today", "unmerged branch work", "via github ui", "yesterday edge"]);
});

test("monday widens yesterday to friday through sunday", () => {
  const monday = new Date(2026, 2, 16, 9, 0);
  const w = ext.mod.windowFor("yesterday", monday);
  assert.equal(w.start.getDay(), 5);
  assert.equal(w.end.getTime(), new Date(2026, 2, 16).getTime());
  assert.equal(ext.mod.windowFor("yesterday", NOW).start.getDate(), 17);
  assert.throws(() => ext.mod.windowFor("fortnight"), /Unknown range/);
});

test("flags: revert, witching hour, brave soul use the commit's own timestamp", () => {
  const f = ext.mod.flagsFor;
  assert.deepEqual(f({ date: "2026-03-17T02:30:00+05:00", subject: "Revert \"x\"" }), ["a restless spirit", "witching hour"]);
  assert.deepEqual(f({ date: "2026-03-20T15:00:00-08:00", subject: "ship" }), ["a brave soul"]); // Friday
  assert.deepEqual(f({ date: "2026-03-19T15:00:00-08:00", subject: "ship" }), []);
});

test("headline is cleaned for the board; speech is clipped", () => {
  assert.equal(ext.mod.cleanHeadline("  Ship it!! café é "), "SHIP IT CAFE E");
  assert.equal(ext.mod.cleanHeadline("x".repeat(80)).length, 40);
  const s = ext.mod.cleanSpeech({ headline: "!!!", done: ["a", "", "b".repeat(500)], next: "nope" });
  assert.equal(s.headline, "THE SPIRITS HAVE SPOKEN");
  assert.equal(s.done.length, 2);
  assert.equal(s.done[1].length, 200);
  assert.deepEqual(s.next, []);
});

test("email validation is strict", () => {
  assert.ok(ext.mod.isEmail(NOREPLY));
  for (const bad of ["a b@x.com", "a@b", "--author=x@y.z", "x@y.z\nfoo", "<a@b.co>", 5, ""]) assert.equal(ext.mod.isEmail(bad), false, String(bad));
});

test("prompt carries subjects only, never emails or hashes, and names the skill", async () => {
  const r = await ext.mod.lookup("week", { now: NOW, extraEmails: [NOREPLY] });
  const p = ext.mod.seancePrompt(r);
  assert.match(p, /^Use the hold-standup-seance skill\./);
  assert.ok(p.includes("six days ago"));
  assert.ok(!p.includes("@") && !r.commits.some((c) => p.includes(c.hash)));
});

test("server: token, settings round trip, summon prompts the agent, speak is sanitised", async () => {
  const { url } = await canvas.open({ instanceId: "s1" });
  const base = new URL(url);
  const at2 = (p) => `${base.origin}${p}${base.search}`;
  assert.equal((await fetch(`${base.origin}/state`)).status, 403);
  assert.ok(!/innerHTML/.test(await (await fetch(at2("/"))).text()));

  assert.deepEqual(await (await fetch(at2("/settings"))).json(), { emails: [] });
  const bad = await fetch(at2("/settings"), { method: "POST", body: JSON.stringify({ emails: ["--author=evil"] }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(at2("/settings"), { method: "POST", body: JSON.stringify({ emails: [NOREPLY, NOREPLY] }) });
  assert.deepEqual(await ok.json(), { emails: [NOREPLY] });
  assert.deepEqual(JSON.parse(readFileSync(process.env.STANDUP_SEANCE_SETTINGS, "utf8")), { emails: [NOREPLY] });

  assert.equal((await fetch(at2("/summon"), { method: "POST", body: JSON.stringify({ range: "bogus" }) })).status, 400);
  assert.equal((await fetch(at2("/summon"), { method: "POST", body: "x".repeat(5000) })).status, 413);
  const before = ext.session.sent.length;
  const res = await fetch(at2("/summon"), { method: "POST", body: JSON.stringify({ range: "week" }) });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.commits.length >= 3);
  assert.equal(ext.session.sent.length, before + 1);

  const ctrl = new AbortController();
  const events = await fetch(at2("/events"), { signal: ctrl.signal });
  const reader = events.body.getReader();
  await reader.read();
  const next = reader.read();
  await act("speak", { headline: "Hello <b>World</b>", done: ["x"], next: [], blockers: [] });
  const chunk = new TextDecoder().decode((await next).value);
  assert.match(chunk, /"headline":"HELLO BWORLDB"/);
  ctrl.abort();
  assert.equal((await (await fetch(at2("/state"))).json()).speech.headline, "HELLO BWORLDB");

  await canvas.onClose({ instanceId: "s1" });
  await assert.rejects(fetch(at2("/state")));
});

test("no commits: summon sends nothing to the agent", async () => {
  const empty = makeRepo();
  commit(empty, { message: "old", date: at(1, 9) });
  ext.session.workspacePath = empty;
  const { url } = await canvas.open({ instanceId: "s3" });
  const base = new URL(url);
  const before = ext.session.sent.length;
  const r = await (await fetch(`${base.origin}/summon${base.search}`, { method: "POST", body: JSON.stringify({ range: "yesterday" }) })).json();
  assert.deepEqual(r.commits, []);
  assert.equal(ext.session.sent.length, before);
  await canvas.onClose({ instanceId: "s3" });
  ext.session.workspacePath = repo;
});

test("non-git folder is a friendly error", async () => {
  ext.session.workspacePath = mkdtempSync(join(tmpdir(), "nogit-"));
  const r = await act("read_whispers", { range: "yesterday" });
  assert.match(r.error, /not a git repository|No email/);
  ext.session.workspacePath = repo;
});

test("page script has no template literals", async () => {
  const { url } = await canvas.open({ instanceId: "s2" });
  const html = await (await fetch(url)).text();
  const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
  assert.ok(!script.includes("`") && !script.includes("${"));
  await canvas.onClose({ instanceId: "s2" });
});
