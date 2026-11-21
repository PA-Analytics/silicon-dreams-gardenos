# Tasks — Revival Dossier

Status legend: `[x]` = implemented & verified locally; `[ ]` = pending execution inside Kiro IDE/CLI.

## 1. Stage One Compliance & Zero-GPU Entry
- [x] 1.1 Add root MIT `LICENSE`, rewrite `README.md` in English with Kiroween disclosure, and rewrite `/` to serve GardenOS directly in `vite.config.ts` and `vercel.json`.
- [x] 1.2 Add `i18n.ts` defaulting to English (`en`) with live `EN/ES` toggle and `?lang=es` support.
- [x] 1.3 Mount Direct Dossier & `?repo=owner/name` loader before `WebGPURenderer.init()` so inspection & export work without 3D/WebGPU.

## 2. Real Ingestion, Graph & Multi-TODO Triage
- [x] 2.1 Preserve partial GitHub data on `/readme` 404/429, sample up to 10 source/manifest files via `raw.githubusercontent.com`, and track `knownTotalFiles` vs `sampledFiles`.
- [x] 2.2 Rank code `TODO`/`FIXME`/`HACK` above docs, collect multi-track `todos: TodoTrack[]`, support `Cargo.toml` / `go.mod` / monorepo manifests, and fingerprint local folder IDs.
- [x] 2.3 Label `RepoGraph` edges (`import` vs `folder`) and scrub private workstation paths & completed-repo contradictions from `presets.ts`.

## 3. Visual Polish, 3D Holograms & Costume Contest UX
- [x] 3.1 Remove all debug camera selector panels (`#views` and `#recNav` camera buttons).
- [x] 3.2 Redesign `#dossierModal` (no inner white scrollbars, no broken paths, no orange h2 outline, clean 2-col layout, accessible `Tab` navigation, `Esc` closes modal).
- [x] 3.3 Polish 3D desk holograms (smooth gradient projection beams, no duplicate CRT ghost bezel, crisp 512×384 dark-glass contrast, graph always visible on CRT).
- [x] 3.4 Fix TV visual & multi-track interaction (route beam to TV antenna/side and turn off after activation, align TV brackets to glass, hide overlapping `#poi` during `#dlg`).

## 4. Kiro Artifacts & Verification
- [x] 4.1 Upgrade `.kiro/hooks/gardenos-regression.json` to official Kiro `v1` schema (`version: "v1"`, `hooks[]`, `trigger`, `action`) and emit `v1` hooks in `kiro-export.ts`.
- [x] 4.2 Export full multi-section Kiro Revival Pack (`requirements.md` EARS per TODO + `design.md` + `tasks.md` + `v1` hook).
- [ ] 4.3 Run `PostTaskExecution` / `PostFileSave` hooks and PBT property check inside Kiro IDE/CLI and record session evidence without private data.
