// Commit Constellations: a GitHub Copilot app canvas.
// Renders the workspace repository's git history as a night sky: commits are stars,
// authors are constellations, reverts are shooting stars.
//
// PLATFORM ASSUMPTIONS (unverified until the manual test, see docs/specs/platform-contract.md):
//   1. Workspace folder: session.workspacePath, falling back to process.cwd()  -> workspaceDir()
//   2. EventSource to the loopback server works in the canvas webview; the page
//      falls back to polling /data when it errors                              -> PAGE (watch())
// Everything else here is plain Node.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { basename } from "node:path";
import { promisify } from "node:util";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const run = promisify(execFile);
const DEFAULT_COMMITS = 1500;
const MAX_COMMITS = 5000;
const MAX_CONSTELLATIONS = 12;

let session = null; // set after joinSession; handlers use it lazily

function workspaceDir() {
    return session?.workspacePath || process.cwd();
}
let sky = null; // cached result of the last git read
let highlight = ""; // author filter set by the agent
const servers = new Map(); // instanceId -> { server, url, token, clients }

// ---------------------------------------------------------------- git -> sky

export function hash32(text) {
    // FNV-1a: stable, tiny, good enough to pick names deterministically.
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function constellationName(author) {
    const word = (author.split(/[\s._@-]+/).find((w) => /\p{L}/u.test(w)) || "Anon")
        .replace(/[^\p{L}\p{N}]/gu, "");
    const root = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    const patterns = [
        (r) => `${r} Major`, (r) => `${r} Minor`, (r) => `Corona ${r}`,
        (r) => `${r} Borealis`, (r) => `Canis ${r}`, (r) => `${r} Australis`,
        (r) => `Ursa ${r}`, (r) => `Nebula ${r}`,
    ];
    return patterns[hash32(author) % patterns.length](root);
}

export function epithet(author, commits) {
    const n = commits.length;
    const share = (test) => commits.filter(test).length / n;
    const sizes = commits.map((c) => c.i + c.x).sort((a, b) => a - b);
    const median = sizes[Math.floor(n / 2)];
    const mean = sizes.reduce((a, b) => a + b, 0) / n;
    const ins = commits.reduce((a, c) => a + c.i, 0);
    const del = commits.reduce((a, c) => a + c.x, 0);
    const reverts = commits.filter((c) => c.r).length;
    const subjectLength = commits.reduce((a, c) => a + c.s.length, 0) / n;
    // Hour and weekday are read from the author's own local timestamp.
    const hour = (c) => Number(c.d.slice(11, 13));
    const weekday = (c) =>
        new Date(Date.UTC(+c.d.slice(0, 4), +c.d.slice(5, 7) - 1, +c.d.slice(8, 10))).getUTCDay();

    if (reverts >= Math.max(2, n * 0.05)) return "the Time Traveller";
    if (share((c) => hour(c) >= 22 || hour(c) < 4) > 0.35) return "the Midnight Committer";
    if (share((c) => weekday(c) === 5 && hour(c) >= 15) > 0.12) return "the Friday Deployer";
    if (share((c) => weekday(c) === 0 || weekday(c) === 6) > 0.3) return "the Weekend Warrior";
    if (del > ins * 1.2 && del > 200) return "the Great Deleter";
    if (mean > 400) return "the Monolith Builder";
    if (median <= 4 && n >= 5) return "the Typo Hunter";
    if (subjectLength < 12) return "of Few Words";
    return ["the Steady Hand", "the Quiet Maintainer", "the Reliable Orbit"][hash32(author) % 3];
}

export function parseLog(stdout) {
    return stdout.split("\x1e").slice(1).map((record) => {
        const [head, ...rest] = record.split("\n");
        const [h, a, d, s = ""] = head.split("\x1f");
        const stat = rest.join(" ");
        const num = (re) => Number((stat.match(re) || [0, 0])[1]);
        return {
            h: h.slice(0, 10), a, d, s,
            i: num(/(\d+) insertion/), x: num(/(\d+) deletion/),
            r: /^revert\b/i.test(s), c: -1,
        };
    });
}

export function buildAuthors(commits) {
    const byAuthor = new Map();
    for (const commit of commits) {
        if (!byAuthor.has(commit.a)) byAuthor.set(commit.a, []);
        byAuthor.get(commit.a).push(commit);
    }
    return [...byAuthor.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, MAX_CONSTELLATIONS)
        .map(([name, list], index) => {
            for (const commit of list) commit.c = index;
            return { name, constellation: constellationName(name), epithet: epithet(name, list), commits: list.length };
        });
}

export async function loadSky(maxCommits = DEFAULT_COMMITS) {
    const limit = Math.min(MAX_COMMITS, Math.max(1, Math.floor(maxCommits)));
    const cwd = workspaceDir();
    let stdout;
    try {
        ({ stdout } = await run(
            "git",
            ["log", `-n${limit}`, "--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s", "--shortstat"],
            { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        ));
    } catch (error) {
        const reason = error.code === "ENOENT" ? "git was not found on PATH" : "this folder is not a git repository (or has no commits)";
        sky = { repo: basename(cwd), error: `No stars tonight: ${reason}.`, commits: [], authors: [] };
        return sky;
    }

    const commits = parseLog(stdout);

    const authors = buildAuthors(commits);

    sky = {
        repo: basename(cwd),
        generatedAt: new Date().toISOString(),
        truncated: commits.length === limit,
        reverts: commits.filter((c) => c.r).length,
        commits: commits.map(({ a, ...rest }) => rest), // author name lives in authors[c]
        authors,
        highlight,
    };
    return sky;
}

export function skyReport(data) {
    return {
        repo: data.repo,
        error: data.error,
        stars: data.commits.length,
        shootingStars: data.reverts ?? 0,
        from: data.commits.at(-1)?.d,
        to: data.commits[0]?.d,
        constellations: data.authors,
    };
}

// ------------------------------------------------------------- local server

function broadcast(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const entry of servers.values()) for (const client of entry.clients) client.write(line);
}

function sendJson(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}

async function readJson(request) {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) throw Object.assign(new Error("Request body too large."), { status: 413 });
    }
    try { return JSON.parse(body || "{}"); } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}

async function route(request, response, entry) {
    const url = new URL(request.url, "http://127.0.0.1");
    // The token keeps other local pages from reading commit data off the port.
    if (url.searchParams.get("t") !== entry.token) return sendJson(response, 403, { error: "Forbidden." });

    if (url.pathname === "/" && request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return response.end(PAGE);
    }
    if (url.pathname === "/data" && request.method === "GET") {
        return sendJson(response, 200, { ...(sky ?? (await loadSky())), highlight });
    }
    if (url.pathname === "/events" && request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        response.write(": connected\n\n");
        entry.clients.add(response);
        request.on("close", () => entry.clients.delete(response));
        return;
    }
    if (url.pathname === "/refresh" && request.method === "POST") {
        await loadSky();
        broadcast({ type: "refresh" });
        return sendJson(response, 200, { ok: true });
    }
    if (url.pathname === "/ask" && request.method === "POST") {
        const { hash } = await readJson(request);
        if (!/^[0-9a-f]{7,40}$/.test(hash ?? "")) return sendJson(response, 400, { error: "Invalid commit hash." });
        await session.send({
            prompt: `Explain commit ${hash} in this repository: what changed, why it likely changed, and anything risky about it. Use git show to read it.`,
        });
        return sendJson(response, 202, { ok: true });
    }
    sendJson(response, 404, { error: "Not found." });
}

async function startServer() {
    const entry = { token: randomUUID(), clients: new Set(), server: null, url: null };
    entry.server = createServer((request, response) => {
        route(request, response, entry).catch((error) => {
            void session?.log(`Commit Constellations error: ${error.message}`, { level: "error" });
            if (!response.headersSent) sendJson(response, error.status ?? 500, { error: error.message });
            else response.end();
        });
    });
    await new Promise((resolve, reject) => {
        entry.server.once("error", reject);
        entry.server.listen(0, "127.0.0.1", resolve);
    });
    entry.url = `http://127.0.0.1:${entry.server.address().port}/?t=${entry.token}`;
    return entry;
}

// ------------------------------------------------------------------- canvas

const canvas = createCanvas({
    id: "commit-constellations",
    displayName: "Commit Constellations",
    description:
        "Shows the current repository's git history as a night sky: commits are stars, authors are constellations, reverts are shooting stars.",
    actions: [
        {
            name: "refresh",
            description: "Re-read git history and redraw the sky.",
            inputSchema: {
                type: "object",
                properties: {
                    maxCommits: { type: "integer", minimum: 1, maximum: MAX_COMMITS, description: `Newest commits to load (default ${DEFAULT_COMMITS}).` },
                },
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const data = await loadSky(ctx.input?.maxCommits ?? DEFAULT_COMMITS);
                broadcast({ type: "refresh" });
                return skyReport(data);
            },
        },
        {
            name: "highlight_author",
            description: "Spotlight one author's constellation and dim the rest. Pass an empty string to clear.",
            inputSchema: {
                type: "object",
                properties: { author: { type: "string", description: "Author name or part of it." } },
                required: ["author"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                highlight = ctx.input.author.trim();
                broadcast({ type: "highlight", author: highlight });
                return { highlight };
            },
        },
        {
            name: "sky_report",
            description: "Return the constellations, their epithets and star counts so the agent can narrate the sky.",
            handler: async () => skyReport(sky ?? (await loadSky())),
        },
    ],
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startServer();
            servers.set(ctx.instanceId, entry);
        }
        return { title: "Commit Constellations", status: basename(workspaceDir()), url: entry.url };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        for (const client of entry.clients) client.end();
        await new Promise((resolve) => entry.server.close(resolve));
    },
});

// ----------------------------------------------------------------- the page
// String.raw keeps backslashes intact. The client script deliberately avoids
// template literals so nothing in it is interpolated by this module.

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Commit Constellations</title>
<style>
  html, body { margin: 0; height: 100%; background: #05070f; color: #dfe6ff; overflow: hidden;
    font: 13px/1.4 "Segoe UI", system-ui, -apple-system, sans-serif; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
  header { position: fixed; top: 12px; left: 16px; right: 16px; display: flex; align-items: baseline; gap: 12px; pointer-events: none; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; }
  #stats { color: #8f9bc4; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button { pointer-events: auto; font: inherit; color: #dfe6ff; background: rgba(120,140,220,.14);
    border: 1px solid rgba(150,170,255,.3); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  button:hover { background: rgba(120,140,220,.28); }
  button:focus-visible, input:focus-visible { outline: 2px solid #9db4ff; outline-offset: 2px; }
  footer { position: fixed; left: 16px; right: 16px; bottom: 12px; display: flex; align-items: center; gap: 10px; }
  input[type=range] { flex: 1; accent-color: #9db4ff; }
  #when { color: #8f9bc4; min-width: 86px; text-align: right; font-variant-numeric: tabular-nums; }
  #tip { position: fixed; display: none; max-width: 320px; padding: 8px 10px; border-radius: 8px; pointer-events: none;
    background: rgba(12,16,34,.94); border: 1px solid rgba(150,170,255,.3); }
  #tip b { display: block; font-weight: 600; }
  #tip span { color: #8f9bc4; }
  #card { position: fixed; left: 16px; bottom: 48px; display: none; max-width: 420px; padding: 10px 12px; border-radius: 8px;
    background: rgba(12,16,34,.94); border: 1px solid rgba(150,170,255,.3); }
  #card p { margin: 0 0 8px; }
  #empty { position: fixed; inset: 0; display: none; place-items: center; text-align: center; color: #8f9bc4; padding: 24px; }
</style>
</head>
<body>
<canvas id="sky" aria-label="Night sky of commits"></canvas>
<header>
  <h1 id="repo">Commit Constellations</h1>
  <div id="stats"></div>
  <button id="refresh" type="button">Refresh</button>
</header>
<div id="empty"></div>
<div id="tip"><b></b><span></span></div>
<div id="card"><p></p><button id="ask" type="button">Ask Copilot about this commit</button> <button id="unpin" type="button">Close</button></div>
<footer>
  <button id="play" type="button">Play history</button>
  <input id="time" type="range" min="0" max="0" value="0" aria-label="Show the sky up to this point in history">
  <div id="when"></div>
</footer>
<script>
(function () {
  "use strict";
  var q = location.search;
  var cv = document.getElementById("sky"), g = cv.getContext("2d");
  var el = function (id) { return document.getElementById(id); };
  var W = 0, H = 0, stars = [], authors = [], dust = [], shooting = [], reverts = [];
  var visible = 0, playing = false, highlight = "", hover = null, pinned = null, frame = 0;
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function unit(hex) { return parseInt(hex, 16) / 1048576; } // 5 hex digits -> 0..1

  function load() {
    fetch("/data" + q).then(function (r) { return r.json(); }).then(function (sky) {
      highlight = sky.highlight || "";
      authors = sky.authors.map(function (a) { return { name: a.name, title: a.constellation, epithet: a.epithet, commits: a.commits, chain: [] }; });
      // git log is newest first; the slider wants oldest first.
      stars = sky.commits.map(function (c) {
        var size = c.i + c.x;
        return { h: c.h, s: c.s, d: c.d, t: Date.parse(c.d), i: c.i, x: c.x, c: c.c, r: c.r,
          u1: unit(c.h.slice(0, 5)), u2: unit(c.h.slice(5, 10)), size: size,
          rad: 0.6 + Math.min(3.2, Math.log10(1 + size) * 0.9), warm: c.x / (size + 1) };
      }).sort(function (a, b) { return a.t - b.t; });
      stars.forEach(function (s, n) { s.n = n; });
      reverts = stars.filter(function (s) { return s.r; });
      el("repo").textContent = sky.repo || "Commit Constellations";
      el("stats").textContent = sky.error ? "" : stars.length + (sky.truncated ? "+" : "") + " stars  ·  " +
        authors.length + " constellations  ·  " + reverts.length + " shooting stars";
      el("empty").style.display = sky.error || !stars.length ? "grid" : "none";
      el("empty").textContent = sky.error || "No commits yet. A very dark sky.";
      el("time").max = stars.length; el("time").value = stars.length; visible = stars.length;
      pin(null); layout(); showWhen();
    }).catch(function () {
      el("empty").style.display = "grid"; el("empty").textContent = "The observatory is closed (could not load data).";
    });
  }

  function layout() {
    var dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var x0 = 70, x1 = W - 70, y0 = 80, y1 = H - 110, S = Math.min(x1 - x0, y1 - y0), k = Math.max(1, authors.length);
    var reach = Math.max(40, S * 0.42 / Math.sqrt(k));
    authors.forEach(function (a, n) {
      // Sunflower layout: the busiest author sits in the middle of the sky.
      var r = Math.sqrt(n / k) * 0.46, ang = n * 2.399963 + 0.6;
      a.x = (x0 + x1) / 2 + Math.cos(ang) * r * (x1 - x0);
      a.y = (y0 + y1) / 2 + Math.sin(ang) * r * (y1 - y0);
      a.reach = reach;
    });
    stars.forEach(function (s) {
      var a = authors[s.c];
      if (a) {
        var ang = s.u1 * Math.PI * 2, dist = Math.sqrt(s.u2) * a.reach;
        s.x = a.x + Math.cos(ang) * dist; s.y = a.y + Math.sin(ang) * dist * 0.8;
      } else { s.x = s.u1 * W; s.y = 50 + s.u2 * (H - 120); } // everyone else: field stars
    });
    // Each constellation's figure joins its seven biggest commits, nearest neighbour first.
    authors.forEach(function (a, n) {
      var top = stars.filter(function (s) { return s.c === n; }).sort(function (p, r) { return r.size - p.size; }).slice(0, 7);
      top.sort(function (p, r) { return p.x - r.x; });
      var chain = top.splice(0, 1);
      while (top.length) {
        var last = chain[chain.length - 1], best = 0;
        for (var j = 1; j < top.length; j++) if (gap(last, top[j]) < gap(last, top[best])) best = j;
        chain.push(top.splice(best, 1)[0]);
      }
      chain.forEach(function (s) { s.major = true; });
      a.chain = chain;
    });
    var seed = 7; dust = [];
    for (var d = 0; d < 220; d++) {
      seed = (seed * 16807) % 2147483647; var dx = seed / 2147483647;
      seed = (seed * 16807) % 2147483647; var dy = seed / 2147483647;
      dust.push({ x: dx * W, y: dy * H, a: 0.12 + (d % 5) * 0.05 });
    }
  }

  function gap(a, b) { return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y); }
  function lit(s) { return !highlight || (authors[s.c] && authors[s.c].name.toLowerCase().indexOf(highlight.toLowerCase()) >= 0); }
  function colour(s, alpha) {
    var w = s.warm; // 0 = pure additions (blue-white), 1 = pure deletions (orange)
    return "rgba(" + Math.round(175 + 80 * w) + "," + Math.round(205 - 20 * w) + "," + Math.round(255 - 120 * w) + "," + alpha + ")";
  }

  function draw() {
    frame++;
    if (playing) {
      visible = Math.min(stars.length, visible + Math.max(1, stars.length / 500));
      el("time").value = Math.floor(visible); showWhen();
      if (visible >= stars.length) { playing = false; el("play").textContent = "Play history"; }
    }
    var sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#04060d"); sky.addColorStop(1, "#0b1030");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    dust.forEach(function (d) { g.fillStyle = "rgba(200,210,255," + d.a + ")"; g.fillRect(d.x, d.y, 1, 1); });

    authors.forEach(function (a) {
      var on = !highlight || a.name.toLowerCase().indexOf(highlight.toLowerCase()) >= 0, seen = 0;
      g.strokeStyle = "rgba(150,170,255," + (on ? 0.32 : 0.06) + ")"; g.lineWidth = 1; g.beginPath();
      for (var j = 0; j < a.chain.length; j++) {
        if (a.chain[j].n < visible) seen++;
        if (j && a.chain[j].n < visible && a.chain[j - 1].n < visible) { g.moveTo(a.chain[j - 1].x, a.chain[j - 1].y); g.lineTo(a.chain[j].x, a.chain[j].y); }
      }
      g.stroke();
      if (!seen) return;
      g.textAlign = "center"; g.fillStyle = "rgba(223,230,255," + (on ? 0.85 : 0.15) + ")";
      g.font = "600 11px 'Segoe UI', system-ui, sans-serif";
      g.fillText(a.title.toUpperCase().split("").join(" "), a.x, a.y + a.reach * 0.8 + 18);
      g.fillStyle = "rgba(143,155,196," + (on ? 0.9 : 0.12) + ")"; g.font = "italic 11px 'Segoe UI', system-ui, sans-serif";
      g.fillText(a.epithet + "  ·  " + a.name, a.x, a.y + a.reach * 0.8 + 33);
    });

    for (var n = 0; n < stars.length && n < visible; n++) {
      var s = stars[n], on = lit(s);
      var twinkle = calm ? 1 : 0.78 + 0.22 * Math.sin(frame * 0.03 + s.u1 * 40);
      var alpha = (s.c < 0 ? 0.45 : 0.95) * twinkle * (on ? 1 : 0.12);
      if (s.major && on) {
        var halo = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.rad * 5);
        halo.addColorStop(0, colour(s, 0.35 * twinkle)); halo.addColorStop(1, colour(s, 0));
        g.fillStyle = halo; g.beginPath(); g.arc(s.x, s.y, s.rad * 5, 0, 6.2832); g.fill();
      }
      g.fillStyle = colour(s, alpha); g.beginPath(); g.arc(s.x, s.y, s.rad, 0, 6.2832); g.fill();
    }
    var ring = pinned || hover;
    if (ring) { g.strokeStyle = "rgba(255,255,255,.8)"; g.lineWidth = 1; g.beginPath(); g.arc(ring.x, ring.y, ring.rad + 5, 0, 6.2832); g.stroke(); }

    // Shooting stars: one revert streaks past every few seconds.
    var live = reverts.filter(function (s) { return s.n < visible; });
    if (!calm && live.length && frame % 240 === 60) {
      var pick = live[Math.floor(Math.random() * live.length)];
      shooting.push({ x: Math.random() * W * 0.6, y: 40 + Math.random() * H * 0.25, vx: 6 + Math.random() * 3, vy: 2 + Math.random() * 1.5, life: 90, text: pick.s });
    }
    shooting = shooting.filter(function (m) { return m.life > 0; });
    shooting.forEach(function (m) {
      m.x += m.vx; m.y += m.vy; m.life--;
      var fade = Math.min(1, m.life / 30), tail = g.createLinearGradient(m.x - m.vx * 14, m.y - m.vy * 14, m.x, m.y);
      tail.addColorStop(0, "rgba(255,255,255,0)"); tail.addColorStop(1, "rgba(255,240,210," + fade + ")");
      g.strokeStyle = tail; g.lineWidth = 2; g.beginPath(); g.moveTo(m.x - m.vx * 14, m.y - m.vy * 14); g.lineTo(m.x, m.y); g.stroke();
      g.textAlign = "left"; g.font = "11px 'Segoe UI', system-ui, sans-serif"; g.fillStyle = "rgba(255,220,180," + fade * 0.9 + ")";
      g.fillText(m.text.length > 60 ? m.text.slice(0, 57) + "..." : m.text, m.x + 10, m.y + 4);
    });
    requestAnimationFrame(draw);
  }

  function showWhen() {
    var last = stars[Math.min(stars.length, Math.floor(visible)) - 1];
    el("when").textContent = last ? last.d.slice(0, 10) : "";
  }
  function nearest(x, y) {
    var best = null, bestGap = 196; // 14px radius
    for (var n = 0; n < stars.length && n < visible; n++) {
      var dx = stars[n].x - x, dy = stars[n].y - y, d = dx * dx + dy * dy;
      if (d < bestGap) { bestGap = d; best = stars[n]; }
    }
    return best;
  }
  function describe(s) {
    var who = authors[s.c] ? authors[s.c].name : "a field star";
    return who + "  ·  " + s.d.slice(0, 10) + "  ·  +" + s.i + " / -" + s.x + "  ·  " + s.h;
  }
  function pin(s) {
    pinned = s; el("card").style.display = s ? "block" : "none";
    if (s) el("card").querySelector("p").textContent = s.s + "  (" + describe(s) + ")";
  }

  cv.addEventListener("mousemove", function (e) {
    hover = nearest(e.clientX, e.clientY);
    var tip = el("tip"); tip.style.display = hover ? "block" : "none"; cv.style.cursor = hover ? "pointer" : "default";
    if (!hover) return;
    tip.querySelector("b").textContent = hover.s; tip.querySelector("span").textContent = describe(hover);
    tip.style.left = Math.min(W - 340, e.clientX + 14) + "px"; tip.style.top = Math.min(H - 90, e.clientY + 14) + "px";
  });
  cv.addEventListener("mouseleave", function () { hover = null; el("tip").style.display = "none"; });
  cv.addEventListener("click", function (e) { pin(nearest(e.clientX, e.clientY)); });
  el("unpin").addEventListener("click", function () { pin(null); });
  el("ask").addEventListener("click", function () {
    if (!pinned) return;
    fetch("/ask" + q, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: pinned.h }) });
    pin(null);
  });
  el("refresh").addEventListener("click", function () { fetch("/refresh" + q, { method: "POST" }); });
  el("time").addEventListener("input", function () { playing = false; el("play").textContent = "Play history"; visible = Number(this.value); showWhen(); });
  el("play").addEventListener("click", function () {
    playing = !playing; if (playing && visible >= stars.length) visible = 0;
    this.textContent = playing ? "Pause" : "Play history";
  });
  window.addEventListener("resize", layout);

  // Live updates: SSE first; if the webview refuses EventSource, poll /data instead.
  var stamp = "", poller = null;
  function poll() {
    fetch("/data" + q).then(function (r) { return r.json(); }).then(function (sky) {
      var next = (sky.generatedAt || "") + "|" + (sky.highlight || "");
      if (stamp && next !== stamp) {
        if ((sky.generatedAt || "") !== stamp.split("|")[0]) load(); else highlight = sky.highlight || "";
      }
      stamp = next;
    }).catch(function () {});
  }
  function watch() {
    if (typeof EventSource === "undefined") { poller = setInterval(poll, 4000); poll(); return; }
    var events = new EventSource("/events" + q);
    events.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === "refresh") load();
      if (msg.type === "highlight") highlight = msg.author || "";
    };
    events.onerror = function () {
      if (!poller) { poller = setInterval(poll, 4000); poll(); }
    };
  }
  watch();

  load(); requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;

session = await joinSession({ canvases: [canvas] });
