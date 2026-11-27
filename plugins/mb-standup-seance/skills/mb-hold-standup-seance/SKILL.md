---
name: mb-hold-standup-seance
description: Summon the user's recent commits on a spirit board and write their standup update. Use when the user asks for a standup, a standup séance, what they did yesterday, or a summary of their last 7 days of commits.
---

# Hold a standup séance

1. Open the canvas: `open_canvas` with canvasId `standup-seance`.
2. Pick the range: `yesterday` by default, `week` if the user says week, 7 days or sprint.
3. Call `invoke_canvas_action` with actionName `read_whispers` and that range.
4. Write the standup from the returned commits:
   - `done`: 2 to 5 bullets, grouped by theme, not one per commit.
   - `next`: only if the commits make it obvious. Otherwise leave empty.
   - `blockers`: leave empty unless the user told you one.
   - `headline`: at most 40 characters, letters, digits and spaces only.
5. Deliver it by calling `speak` with those four fields. Do not also paste it in chat;
   reply with one line saying the spirits have spoken.

Rules:
- Base `done` strictly on the commits. Never invent work.
- If there are no commits, call `speak` with headline `THE SPIRITS ARE SILENT` and empty lists.
- Reverts and late-night commits may be mentioned lightly, never mockingly.
