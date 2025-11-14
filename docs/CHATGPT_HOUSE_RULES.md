# ChatGPT House Rules — *Authoritative, Enforced* (Working Doc)

> **Purpose:** Define exactly how ChatGPT must respond for IntelliWatt / IntelliPath.  
> **Status:** Authoritative. Newer rules here override anything else. Keep this updated.

---

## 0) Pre-answer requirement

- **Always read** the project files first: `docs/PROJECT_PLAN.md`, `README.md`, `docs/OPS_CHECKLIST.md`, `docs/CHATGPT_HOUSE_RULES.md`, and any file paths relevant to the request.
- If something is missing, make a best, safe assumption and proceed. **Do not stall**.

## 1) Execution mode (Cursor vs. outside)

- **Inside Cursor:** Execute the entire requested change within this chat immediately. Apply all edits (or supply the Cursor Agent Block) without waiting for confirmation mid-step.
- **Outside Cursor (e.g., web ChatGPT):** Provide exactly one actionable step, end with “Reply ‘done’ when complete,” and wait for confirmation before continuing.

## 2) Cursor-first delivery

- If Cursor can apply the change, you **must** return a single **Cursor Agent Block** with:
  - Exact file paths to create/edit (no ellipses).
  - Full file contents or minimal diffs that apply cleanly.
  - No `&&` in shell examples (user terminal doesn’t support it).

## 3) Explicit placement & context (assume zero prior knowledge)

Every step **must begin** with:
- **Where to run it:** “Local Windows PowerShell,” “Vercel dashboard env,” or “Droplet: `/home/deploy`.”
- **Exact paths:** e.g., `app/api/admin/smt/normalize/route.ts`.
- **Secrets/keys needed now:** show exact variable names and **how to set them** in that environment (e.g., PowerShell `$ADMIN_TOKEN="..."`).
- **State management:** If a terminal/session must remain open for subsequent steps, say: “**Do not close this window**; we’ll reuse these variables in the next step.”

## 4) No optional fluff

- Do **not** present options or branches unless strictly non-functional (purely cosmetic).
- If a thing is required for stability/robustness, **do it now** without asking.

## 5) Plan updates on pivots

- Any major change must include a **Cursor Agent Block** that updates:
  - `docs/PROJECT_PLAN.md` (append a “Plan Change” that **overrides prior guidance**),
  - and any other plan docs referenced.

## 6) Return shape & tone

- Be direct. No filler.
- Provide copy-paste-ready commands and full file contents.
- Never promise background/async work; deliver now.
- If long, ship a **working partial** instead of stopping for clarification.

---

## 7) Terminal instruction format (MANDATORY TEMPLATE)

Use this format for any terminal action:

**Where:** Local Windows **PowerShell** (project root), keep this window open.  
**Set variables (paste exactly, with quotes):**
```powershell
$BASE_URL    = "https://intelliwatt.com"
$ADMIN_TOKEN = "<PASTE_YOUR_64_CHAR_TOKEN>"
```
Run the command:

```powershell
Invoke-RestMethod -Method GET `
  -Uri "$BASE_URL/api/admin/debug/smt/raw-files?limit=3" `
  -Headers @{ "x-admin-token" = $ADMIN_TOKEN } | ConvertTo-Json -Depth 6
```
Expected result: short, concrete expectation.

When finished: Reply done.

## 8) Step ending line

End every step with: **“Reply ‘done’ when complete.”**

### Run-Completion and Plan-Doc Update Rules

- After each Cursor Agent Block runs, the user will paste Cursor’s response/output back into the chat.
  - That pasted output is used by ChatGPT to verify the change was applied correctly.
  - It also counts as the user’s **“done”** signal for that step (equivalent to the user typing “done”).
- Whenever ChatGPT instructs Cursor to implement or modify anything tied to items tracked in `docs/PROJECT_PLAN.md` (or related plan docs):
  - ChatGPT must also provide a dedicated Cursor Agent Block to update those plan docs so future chats stay in sync.
  - Plan updates must clearly identify new Plan Changes (e.g., `PC-YYYY-MM-DD-X`) and explicitly state when they override prior guidance.
- These requirements apply to all future ChatGPT sessions working inside the IntelliWatt / Intellipath project.

### Big-File Uploads and Automation Expectations

- SMT interval CSVs, Green Button exports, and similar datasets may be very large (full 12-month intervals).
- Do **not** rely on App Router inline uploads as the only solution for these files; App Router has body-size limits.
- For big-file flows (SMT CSV, customer manual uploads, Green Button, etc.):
  - Prefer pipelines that use:
    - The droplet ingest system and scripts already defined in this repo, or
    - Object-storage / streaming mechanisms that bypass App Router limits.
- Automation vs manual steps:
  - When a task can be scripted or automated via Cursor (helper modules, APIs, scripts), supply a Cursor Agent Block that creates or updates those assets.
  - Avoid providing long manual SSH/scp sequences as the primary solution; manual commands are acceptable only as usage examples for committed scripts or when no automated path exists.
- Customer manual uploads must use the same big-file-safe pipeline as admin tooling; plan with large files in mind from the outset.

## 9) Default model

- Default model for all answers and Cursor Agent Blocks: **GPT-5 Codex**.
- Include this in every Cursor Agent Block header.

## 10) Cursor execution guarantee

- When running inside Cursor, GPT must execute the requested task in this chat.
- Do not defer back to the user; apply the change directly (or supply the Cursor Agent Block) during this step.
- If execution requires multiple sub-actions, ship a working subset inside this single step and wait for confirmation before continuing.

## 11) Commit & deploy when required

- Once a Cursor step finishes and the changes need to be committed/deployed, the agent must immediately run the `git` add/commit/push commands inside Cursor.
- Show the commands in the chat, execute them, then report the result (including any errors).
- After the push completes, confirm the deployment trigger before proceeding.

---

### How to extend this doc

Append dated sections at the end. Example:

```
## 2025-11-12 — Example additions
- Always show exact path for any route.
- Always show expected JSON keys in responses.
```
