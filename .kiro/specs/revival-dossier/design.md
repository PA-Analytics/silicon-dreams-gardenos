# Design — Revival Dossier & Playable Island (V1.2)

## Architecture Overview
- **Zero-GPU Entry First (`main.ts` + `gardenos.html`):** Direct Dossier, `?repo=owner/name` query loader, and language switcher (`EN` default / `ES`) mount before `WebGPURenderer.init()`, guaranteeing usability in headless, WebGL-less, or rapid-judging environments.
- **Background Ingestion & Graph Pipeline (`ingest.ts`, `repo-graph.ts`, `presets.ts`):**
  - Local folders: hashes relative paths for unique `local:<name>:<hash>` IDs, reads manifests (including monorepo sub-manifests, `Cargo.toml`, `go.mod`, `pyproject.toml`, `package.json`), ranks code `TODO`/`FIXME`/`HACK` above docs.
  - GitHub repos: caches in `sessionStorage`, preserves partial results when `/readme` returns 404/429, samples up to 10 top source/manifest files via `raw.githubusercontent.com` for real `import` edges and `TodoTrack` markers.
  - `RepoGraph`: tracks `kind: 'import' | 'folder'` per edge and `knownTotalFiles` vs `sampledFiles`.
- **3D Island & Hologram Rig (`island.ts`, `hologram-desk.ts`, `crt-canvas.ts`):**
  - Center CRT always paints the live connected dependency graph (`import` edges solid cyan, `folder` edges dashed dim, active `TodoTrack` pulsing amber).
  - Left Panel displays `primaryImage` (when present) + repository pulse (commits & dormancy) on a crisp 512×384 dark-glass hologram without coarse striped projector fans or double CRT bezel ghosting.
  - Right Panel displays verified launch/test/env commands and switches to amber `SIGNAL DIVERTED -> CHANNEL B` upon diversion, sending a smooth arc to the TV's right antenna/side edge (and turning off once Channel B is activated).
  - TV Channel B supports multi-track `TodoTrack` cycling (`1/N`) via `[E]`, shifting the island smoothly to night with `ArchiveSeraph` and lit tunnel Vera.
- **Kiro Revival Pack Export (`kiro-export.ts`):** Generates complete English `requirements.md`, `design.md`, `tasks.md`, and official Kiro `v1` hook JSON (`enabled: false`), with individual downloads and clipboard copy.
