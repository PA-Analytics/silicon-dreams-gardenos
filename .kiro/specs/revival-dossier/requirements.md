# Requirements — Revival Dossier (Silicon Dreams V1.2)

## Introduction
Silicon Dreams turns an abandoned repository into an explorable 1997 weirdcore experience and exports an honest, multi-file **Kiro Revival Pack** (`requirements.md` in EARS format, `design.md`, `tasks.md`, and a `v1` Kiro hook). Crucially, the Direct Dossier works both inside the 3D world and immediately without WebGPU (`?repo=owner/name` or pre-3D quick access).

## Glossary
- **Dossier (`ProjectDossier`)**: Read-only inventory, dependency graph, commits, ranked `TODO`/`FIXME` tracks, and verified re-entry commands.
- **TodoTrack**: Verified `TODO`/`FIXME`/`HACK` marker with `path`, `lineNumber`, `excerpt`, and priority score (source code ranked above docs).
- **Observed Fact**: File, commit, manifest script, or `file:line` marker directly read.
- **Hypothesis (unconfirmed)**: Tentative re-entry interpretation, explicitly labeled unconfirmed.
- **Kiro Revival Pack**: Multi-section export (`requirements.md` EARS per TodoTrack, `design.md`, `tasks.md`, and `v1` hook JSON) targeting `.kiro/specs/revive-<slug>/`.

## Requirement 1 — Honest Read-Only Ingestion & Real Source Sampling
### Acceptance Criteria (EARS)
1. WHEN the visitor selects a local folder, THE SYSTEM SHALL read only eligible text files in-browser, exclude secrets (`.env`, keys) and build artifacts, rank source-code `TODO`/`FIXME` markers above README notes, and hash paths into a collision-free project ID.
2. WHEN the visitor submits a GitHub repository (`owner/repo` or URL), THE SYSTEM SHALL query public metadata, commits, and recursive tree, AND SHALL sample top source/manifest files via `raw.githubusercontent.com` to extract real local `import` edges and code `TODO`/`FIXME` markers.
3. IF an optional endpoint (such as `/readme`) fails with 404 or 429 WHILE repo metadata, tree, or commits succeeded, THEN THE SYSTEM SHALL preserve all partial GitHub observations instead of discarding the repo, and SHALL disclose the missing piece honestly.
4. WHEN the repository tree exceeds the sampled cap, THE SYSTEM SHALL report both `knownTotalFiles` and `sampledFiles` explicitly.
5. WHEN a graph is built, THE SYSTEM SHALL distinguish real `import` edges from structural `folder` fallback edges.
6. WHEN a demo or snapshot is selected, THE SYSTEM SHALL never embed local workstation paths and SHALL mark synthetic fixtures with `isDemo: true` and `DEMO`, while bundled real-project snapshots are labeled `SNAPSHOT`.

## Requirement 2 — Non-Blocking Direct Dossier & Accessible Costume Contest UX
### Acceptance Criteria (EARS)
1. WHEN the page loads (including with `?repo=owner/name`) or if WebGPU initialization fails, THE SYSTEM SHALL allow opening the Direct Dossier immediately without waiting for 3D shaders or GLB models.
2. WHILE the Dossier modal is open, THE SYSTEM SHALL allow `Tab` / `Shift+Tab` to navigate controls naturally, close only on `Escape` or the Close button, and hide background HUD chrome.
3. WHEN the visitor approaches the island PC or interacts with the TV, THE SYSTEM SHALL keep the connected dependency graph visible (never occluded by screenshots), route the diversion pulse cleanly without obscuring TV text, and allow cycling through discovered `TodoTrack` items on Channel B.
4. WHILE dialogue text is shown on screen, THE SYSTEM SHALL suppress overlapping `#poi` prompts over the TV glass and avoid horizontal overflow on desktop and mobile (`375x667`).

## Requirement 3 — Honest Persistence & Multi-Artifact Kiro Revival Export
### Acceptance Criteria (EARS)
1. WHEN the visitor edits their Creator Note or selects a verdict (`restore`, `archive`, `leave`), THE SYSTEM SHALL persist `{ creatorNote, verdict, savedAt }` under `sd_memory_v1:<id>` and report success only when `setItem` succeeds.
2. IF `localStorage` throws (`QuotaExceededError`, `SecurityError`), THEN THE SYSTEM SHALL display the exact failure and never announce success.
3. WHEN exporting the Kiro Revival Pack, THE SYSTEM SHALL generate English EARS requirements tailored to each discovered `TodoTrack` and verified manifest command, a `design.md` summary with hub module, `envHints`, and commits, actionable `tasks.md`, and a disabled Kiro `v1` hook JSON (`version: "v1"`, `hooks[]`, `trigger`, `action`).
