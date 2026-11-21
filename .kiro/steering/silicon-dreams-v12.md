# Steering — Silicon Dreams V1.2 (The Operator)

Standing rules governing `src/gardenos/`. Applied automatically across sessions.

## 1. Hypothesis V1.2, Not Fabricated Memory
- The product builds a **Re-entry Hypothesis**: a grounded reading of real repository traces, never invented history.
- Every interpretive line is explicitly labeled `Hypothesis (unconfirmed)`. Never present an inference as an observed fact or a creator memory.
- Never invent commands, commits, authors, or motivations. Missing data is declared explicitly (`No verified command`, `No git history available`).

## 2. Strict Separation: Observed / Hypothesis / Creator Note
Three distinct fields, never merged:
- **Observed:** Only what was read from files, manifests, commits, or `file:line` markers (`observedFact`).
- **Hypothesis (unconfirmed):** Tentative re-entry context derived from observations (`interpretation`).
- **Creator Note:** Free-form text written by the visitor; stored strictly locally in `localStorage`.
- Provenance tags distinguish `ORIGINAL`, `SNAPSHOT` (bundled real-repo showcase), and `DEMO` (synthetic `sentinel-lab`).

## 3. Fixed Three.js Light Rig
- Scene lights come from `scene-meta.json` / `night-meta.json` and `gardenos-meta.json`. Never add ad-hoc lights at runtime after shader compilation.
- Day ↔ Night transitions reuse the same 7 lights in `createSceneLighting` via uniform/intensity updates.
- `WebGPURenderer` uses `NeutralToneMapping`, `setPixelRatio(isMobile ? 0.8 : 0.85)`, and `exposure`.

## 4. Non-Blocking Direct Dossier Access (No-3D Safe)
- Direct Dossier (`Tab`, `?repo=owner/name`, or the pre-3D Quick Dossier button) must mount and open **before** `WebGPURenderer` or GLB compilation.
- If WebGPU fails or is unavailable, the user can still inspect any GitHub repo, local folder, or snapshot and export the complete Kiro Revival Pack.
- `Tab` and `Shift+Tab` cycle controls inside the open dialog; `Escape` closes only the topmost active layer; arrow keys exit the note `textarea` at boundaries.

## 5. Honest `localStorage` Persistence
- Storage key `sd_memory_v1:<projectId>` (using a collision-free fingerprint for local folders).
- Every write returns `{ ok, error? }`. On failure, show the real error and never report persistence success.

## 6. No Base64 Media Inspection & No Private Paths
- Never read binary media (`.png`, `.jpg`, `.webp`, `.mp4`) as text/Base64. Load previews by URL / `ObjectURL` and revoke via `dispose()`.
- Bundled showcase snapshots must never embed local filesystem paths (e.g. `C:\\...`).

## 7. Safe Kiro Revival Pack Export
- `formatKiroRevivalSpec` escapes repository strings so untrusted repo text cannot inject Markdown/HTML instructions.
- Exported hooks use Kiro `v1` schema (`version: "v1"`, `hooks[]`, `trigger`, `action`) and are emitted with `enabled: false`.
