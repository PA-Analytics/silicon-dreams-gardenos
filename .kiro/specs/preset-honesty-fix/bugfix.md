# Bugfix Requirements Document

## Introduction

Two preset-related defects in the GardenOS reception and dossier code need fixing. Both affect what a visitor sees and exports.

1. **Chip order mismatch.** The dossier modal in `gardenos.html` lists the presets as BOUNDARY, TRAZO, Sentinel. The CRT login screen builds its preset chips from `PRESET_CHIPS` in `src/gardenos/login.ts`, which lists Trazo first. The two lists should agree.
2. **False STUB findings on the trazo preset.** The `trazo` entry in `src/gardenos/presets.ts` tags three todo tracks as `STUB`. The bug report says two of them are ordinary code (an Express SPA fallback route and a prompt rule string). The third, `trazo-sampler-fallback`, is a deliberate fallback branch with a comment only, not a stub. The three source files are not in this workspace, so the excerpts stored in `presets.ts` are the only evidence available. The existing detector in `src/gardenos/ingest.ts` (`COMMENT_TODO_RE` and `STUB_CODE_RE`) would not tag a comment like "Fallback: simple line if parsing yielded no segments" as STUB or TODO, which supports removing it.

Scope: the fix touches `src/gardenos/login.ts` (chip order), `src/gardenos/presets.ts` (trazo todo list and trazo tape clue classification), and `tests/story-ingest.test.ts` (assertions that depend on the old order or the removed findings). Other behavior, including `PRESET_LIST` in `presets.ts`, the ingest detector, and the boundary and sentinel-lab presets, stays as it is.

Bug condition, in plain terms: C(X) is true when the login screen renders the preset chips with Trazo ahead of BOUNDARY, or when the trazo preset exposes a STUB-tagged todo track for `trazo-spa-fallback`, `trazo-eval-rule`, or `trazo-sampler-fallback`.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the CRT login screen draws the Demo preset chips THEN the system lists "Trazo" as the first chip and "BOUNDARY" as the second, which differs from the dossier modal order (BOUNDARY first).

1.2 WHEN the trazo preset is loaded into the dossier THEN the system includes the todo track `trazo-spa-fallback` (`src/server/app.ts:985`, excerpt "// Static assets / SPA fallback for non-API routes") tagged `STUB`, even though the bug report identifies it as a standard Express SPA fallback route and not a stub.

1.3 WHEN the trazo preset is loaded into the dossier THEN the system includes the todo track `trazo-eval-rule` (`src/server/evaluator/prompts.ts:45`, excerpt is the `"NOT_MET"` prompt rule line) tagged `STUB`, even though that line is a prompt rule string and not a stub.

1.4 WHEN the trazo preset is loaded into the dossier THEN the system includes the todo track `trazo-sampler-fallback` (`src/utils/companionPathSampler.ts:216`, excerpt "// Fallback: simple line if parsing yielded no segments") tagged `STUB`, although the excerpt describes an intentional fallback branch with no stub marker or unfinished-work marker.

1.5 WHEN the trazo preset is loaded into the dossier THEN the system classifies the trace clue `tapeClue` as `kind: 'unfinished'` for the same `companionPathSampler.ts:216` line, which presents the fallback as unfinished work.

### Expected Behavior (Correct)

2.1 WHEN the CRT login screen draws the Demo preset chips THEN the system SHALL list the chips in the order BOUNDARY, Trazo, Sentinel Lab, matching the dossier modal order in `gardenos.html`, with each chip keeping its existing label.

2.2 WHEN a visitor selects any preset chip on the CRT login screen THEN the system SHALL load the preset whose label is drawn in that chip, and every chip SHALL remain selectable.

2.3 WHEN the trazo preset is loaded into the dossier THEN the system SHALL NOT include any todo track tagged `STUB` for `trazo-spa-fallback` or `trazo-eval-rule`, and both entries SHALL be removed from the trazo todo list.

2.4 WHEN the trazo preset is loaded into the dossier THEN the system SHALL NOT include `trazo-sampler-fallback` as a `STUB` todo track, and the entry SHALL be removed from the trazo todo list because the excerpt is not a stub or unfinished-work marker.

2.5 WHEN the trazo preset is loaded into the dossier THEN the system SHALL NOT classify `tapeClue` as `kind: 'unfinished'`, and the clue SHALL keep the same path, line number, and excerpt so that navigation and export references do not change.

2.6 WHEN `npm test` and `npx tsc --noEmit` are run THEN both SHALL pass, and any test that asserted the old chip order or the removed trazo findings SHALL be updated to assert the corrected behavior.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the boundary preset is loaded into the dossier THEN the system SHALL CONTINUE TO list its two TODO tracks (`boundary-todo-report`, `boundary-todo-validate`) tagged `TODO` with the same paths and line numbers.

3.2 WHEN the sentinel-lab preset is loaded into the dossier THEN the system SHALL CONTINUE TO list its two DEMO todo tracks (`sentinel-tape-timeout`, `sentinel-tape-cidr`) and keep the DEMO provenance label.

3.3 WHEN the trazo preset is loaded into the dossier THEN the system SHALL CONTINUE TO show its gallery images, primary image, commits, next steps, run commands, and test command without change.

3.4 WHEN a visitor clicks a preset in the dossier modal (BOUNDARY, TRAZO, or Sentinel) THEN the system SHALL CONTINUE TO open that preset with the same button order shown in `gardenos.html`.

3.5 WHEN the login screen resets THEN the system SHALL CONTINUE TO default the selected preset to `boundary`.

3.6 WHEN a local folder or GitHub repository is ingested THEN the system SHALL CONTINUE TO detect TODO, FIXME, HACK, XXX, and STUB markers with the existing rules in `src/gardenos/ingest.ts`.

3.7 WHEN any preset is exported to a Kiro Revival Pack THEN the system SHALL CONTINUE TO label provenance as ORIGINAL, SNAPSHOT, or DEMO and keep observed facts, hypotheses (unconfirmed), and creator notes in separate fields.

3.8 WHEN the trazo preset's `todos` list is empty THEN the system SHALL CONTINUE TO state in exports that no TODO/FIXME line markers were verified, rather than inventing a marker.
