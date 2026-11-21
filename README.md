# Silicon Dreams — The Archive of Unfinished Things

> **A place for things you almost made.**
>
> Kiroween 2026 · **Costume Contest**

Abandoned repositories rarely die because the code was bad. They die because **re-entry hurts**: months later you forget how to start it, which module was central, and where the last `TODO` or half-finished feature stopped.

**Silicon Dreams** turns any forgotten project (a public GitHub repository, a local folder read strictly in-browser, or one of three curated snapshots) into a playable 1997 weirdcore terminal & island experience—and sends you back with a **concrete, honest Kiro Revival Pack** (`requirements.md` in EARS format, `design.md`, `tasks.md`, and a `v1` Kiro Hook) so you can actually resume or archive the work.

---

## What Happens in 90 Seconds

1. **Instant Dossier OR Enter Through the CRT:** Every screen supports **Direct Dossier (`Tab` / `?repo=owner/name`)** before or during 3D loading—no 3D GPU or WebGPU required to inspect a repo and export its Kiro Revival Pack.
2. **Step Inside the Glass:** Click the 1997 PC monitor to cross into an impossible office corridor where **Vera**, the telephone-headed archive receptionist, cites your repo's **actual latest commit or unfinished `file:line`**.
3. **The Island & Desk Holograms:** Exit into daylight on the floating island and approach the same beige PC from the outside. Three retro phosphor holograms unfold over the desk:
   - **Center CRT:** Live connected dependency graph (real local `import` edges vs. module clusters).
   - **Left Panel:** Visual capture (if present) + repository pulse (real commits & dormancy).
   - **Right Panel:** Verified launch/test commands & `.env` hints—until the unfinished trace corrupts in amber and **fires an arc across the island to the TV & Boombox**.
4. **Nightfall, Triage & Verdict:** Play **Channel B** on the TV to cycle through real `TODO`/`FIXME` tracks as day shifts into night, **Archive Seraph** rises over the tower, and Vera waits inside the lit entrance tunnel to record your verdict: **Restore in Kiro**, **Archive**, or **Leave Unfinished** (persisted honestly in `localStorage`).

---

## Epistemic Discipline (Zero Fake Memories)

Every piece of evidence in the UI, holograms, and exported Markdown is strictly separated into:
- **OBSERVED:** Exact files, `file:line` markers, git commits, and manifest scripts actually read.
- **HYPOTHESIS (UNCONFIRMED):** Tentative re-entry framing, explicitly labeled unconfirmed.
- **CREATOR NOTE:** Whatever you choose to write and save locally in your own browser.

If a GitHub repo is private, rate-limited, or missing a README, partial data is preserved when available and any fallback is explicitly disclosed.

---

## Quickstart (Local)

Requirements: Node.js 22+ and a WebGPU/WebGL2 browser (Chrome/Edge recommended for 3D; **Direct Dossier mode works without WebGPU**).

```bash
npm ci
npm run dev
```

Open `http://localhost:5186/` (serves GardenOS directly) or jump straight to a repo dossier via:
`http://localhost:5186/?repo=owner/name`

Run the full test suite & production build:

```bash
npm test
npm run build
```

---

## How Kiro Was Used (`/.kiro`)

- **Steering (`.kiro/steering/silicon-dreams-v12.md`):** Enforces epistemic separation (Observed vs. Unconfirmed Hypothesis vs. Creator Note), fixed Three.js day/night light rigs, non-blocking Direct Dossier access, honest `localStorage` failure handling, and no-Base64 media rules.
- **Spec-Driven Development (`.kiro/specs/revival-dossier/`):** Full `requirements.md` (EARS), `design.md`, and `tasks.md` governing read-only ingestion, persistence invariants, and Kiro Revival Pack generation.
- **Agent Hooks (`.kiro/hooks/gardenos-regression.json`):** Official Kiro `v1` schema hooks (`PostTaskExecution` and `PostFileSave`) running `npm test`.
- **Custom Agent (`.kiro/agents/revival-auditor.json`):** Read-only reviewer verifying epistemic honesty and Stage One constraints.
- **In-Product Kiro Output:** Every restored project exports a ready-to-use `.kiro/specs/revive-<slug>/` Revival Pack (`requirements.md` EARS per discovered `TODO`, `design.md`, `tasks.md`, and a disabled `v1` Kiro hook).

---

## Pre-Existing Code & Asset Disclosure (Kiroween Rules §4)

Built during the Kiroween 2026 submission window using standard open-source libraries (`three`, `vite`, TypeScript) plus pre-existing workspace 3D models/shaders in `public/models/` (`silicon-dreams-v1.glb`, `gardenos-v03.glb`, `reception-v01.glb`, `characters/*.glb`) and `src/shaders/` created in this workspace's 3D pipeline prior to the narrative revival layer. No private credentials or local machine paths are embedded in the web bundle.

---

## License

[MIT](./LICENSE)
