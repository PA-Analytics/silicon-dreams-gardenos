# Implementation Plan

Scope: `src/gardenos/login.ts`, `src/gardenos/presets.ts`, and `tests/story-ingest.test.ts`. Do not change `observedFact` text, chip labels, `ingest.ts`, `PRESET_LIST`, or the boundary and sentinel-lab presets. Do not commit to git.

Resolved decisions applied in these tasks:
- Remove the three STUB todo tracks from `PRESETS.trazo` (`todos` becomes `[]`).
- Change `trazo.tapeClue.kind` from `'unfinished'` to `'file'`, keeping path, lineNumber 216, and excerpt.
- Prefix `trazo.tapeClue.interpretation` with `Hypothesis (unconfirmed)`. This label is not in bugfix.md. It comes from steering rule 2.
- Reorder `PRESET_CHIPS` to BOUNDARY, Trazo, Sentinel Lab.
- Add a source-text regression test comparing `PRESET_CHIPS` order with the modal order in `gardenos.html`.

- [ ] 1. Write bug condition exploration tests (before the fix)
  - **Property 1: Bug Condition** - Chip Order and Trazo Findings
  - **CRITICAL**: These tests MUST FAIL on the unfixed code. A failure confirms the bug exists.
  - **DO NOT** change `login.ts`, `presets.ts`, or the test expectations to make these pass at this stage.
  - **GOAL**: Surface the counterexamples listed in design.md (Exploratory Bug Condition Checking).
  - Add to `tests/story-ingest.test.ts` a source-text test that reads `src/gardenos/login.ts` with `readFileSync(new URL('../src/gardenos/login.ts', import.meta.url), 'utf8')`, extracts the `id` values from the `PRESET_CHIPS` literal in order, and asserts they equal `['boundary', 'trazo', 'sentinel-lab']`. Do not import `login.ts`, because it loads `three/webgpu` at import time.
  - Add a test that asserts the trazo preset has no todo track whose `id` is `trazo-spa-fallback`, `trazo-eval-rule`, or `trazo-sampler-fallback`, and no todo track tagged `STUB`.
  - Add a test that asserts `createPresetDossier('trazo', ...).tapeClue.kind === 'file'`, and that `tapeClue.path` is `src/utils/companionPathSampler.ts`, `tapeClue.lineNumber` is 216, and `tapeClue.excerpt` is `// Fallback: simple line if parsing yielded no segments`.
  - Add a test that asserts `tapeClue.interpretation` starts with `Hypothesis (unconfirmed)`.
  - Run `npm test` on the unfixed code.
  - **EXPECTED OUTCOME**: The chip order test fails with actual `['trazo', 'boundary', 'sentinel-lab']`. The trazo STUB test fails with three STUB tracks present. The clue kind test fails with `'unfinished'`. The interpretation label test fails. The modal order control test (sub-task below) passes.
  - Record the counterexamples in the task notes. Do not fix the code in this task.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.3, 2.4, 2.5_

- [ ] 2. Write preservation property tests (before the fix)
  - **Property 2: Preservation** - Non-Bug Presets, Dossier Order, and Export Behavior
  - **IMPORTANT**: Follow the observation-first method. Observe the unfixed output first, then assert it.
  - Add to `tests/story-ingest.test.ts` the following assertions. Each one must PASS on the unfixed code.
    - Boundary todos: exact `id`, `path`, `lineNumber`, and `tag` for `boundary-todo-report` (`src/main.py`, 294, `TODO`) and `boundary-todo-validate` (`src/main.py`, 280, `TODO`).
    - Sentinel-lab todos: exact tuples for `sentinel-tape-timeout` (`modulo-04-scanner/port_scanner.py`, 64, `TODO`) and `sentinel-tape-cidr` (`modulo-04-scanner/cidr_utils.py`, 28, `FIXME`). Assert `provenance === 'DEMO'` on the primary piece, tape clue, and tower record.
    - Trazo gallery and commands: `galleryImages.length === 3`, the commit count, and `runCommands.length` match the unfixed values. Record those values from the unfixed run first.
    - `PRESET_LIST.map((p) => p.id)` equals `['trazo', 'boundary', 'sentinel-lab']`.
    - Dossier modal order: read `gardenos.html` and assert that the ids `btnLoadBoundary`, `btnLoadTrazo`, and `btnLoadSentinel` appear in that order. This is a control and should pass on the unfixed code.
    - Login reset default: a source-text check that the `reset()` path in `login.ts` sets `presetId = 'boundary'`.
  - Run `npm test`. **EXPECTED OUTCOME**: All preservation and control assertions PASS on the unfixed code.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 3. Fix the chip order and trazo findings

  - [ ] 3.1 Reorder PRESET_CHIPS in login.ts
    - Move the `boundary` entry to the first position in `PRESET_CHIPS` (`src/gardenos/login.ts`, lines 10-14).
    - Result: `[{ id: 'boundary', label: 'BOUNDARY' }, { id: 'trazo', label: 'Trazo' }, { id: 'sentinel-lab', label: 'Sentinel Lab' }]`.
    - Keep labels unchanged. Do not edit the draw or hit-test code. Both index by position into `rect.presets`, so the reorder carries through.
    - _Bug_Condition: isBugCondition(login chip layout) where trazo precedes boundary in PRESET_CHIPS_
    - _Expected_Behavior: ids are boundary, trazo, sentinel-lab; each slot draws and selects the same preset (design Property 1)_
    - _Preservation: boundary default on reset, labels, PRESET_LIST order (design Property 2)_
    - _Requirements: 2.1, 2.2, 3.5_

  - [ ] 3.2 Remove the three STUB todo tracks from the trazo preset
    - In `src/gardenos/presets.ts`, set `PRESETS.trazo.todos` to `[]`, removing `trazo-sampler-fallback`, `trazo-spa-fallback`, and `trazo-eval-rule`.
    - Do not change the todo lists for boundary or sentinel-lab.
    - Do not change the detector in `ingest.ts`.
    - _Bug_Condition: trazo todo contains a STUB track with id in {trazo-spa-fallback, trazo-eval-rule, trazo-sampler-fallback}_
    - _Expected_Behavior: trazo todos are empty, with no STUB tag (design Property 1)_
    - _Preservation: empty-list export still states "No TODO/FIXME line markers verified" (design Property 2)_
    - _Requirements: 2.3, 2.4, 3.8_

  - [ ] 3.3 Reclassify the trazo tapeClue and add the interpretation label
    - In `PRESETS.trazo.tapeClue`, change `kind` from `'unfinished'` to `'file'`.
    - Keep `id` (`trazo-sampler-fallback`), `title`, `path`, `lineNumber` (216), `excerpt`, `provenance`, and `dateLabel` unchanged.
    - Keep `observedFact` unchanged, per the resolved decisions.
    - Prefix `interpretation` with `Hypothesis (unconfirmed): ` and keep the rest of the text unchanged.
    - _Bug_Condition: trazo.tapeClue.kind === 'unfinished'_
    - _Expected_Behavior: kind is 'file', with path, line, and excerpt unchanged (design Property 1)_
    - _Requirements: 2.5_

  - [ ] 3.4 Verify the bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Chip Order and Trazo Findings
    - **IMPORTANT**: Re-run the SAME tests from task 1. Do NOT write new tests.
    - Run `npm test`.
    - **EXPECTED OUTCOME**: All tests from task 1 PASS.
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

  - [ ] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Bug Presets, Dossier Order, and Export Behavior
    - **IMPORTANT**: Re-run the SAME assertions from task 2. Do NOT write new assertions.
    - Run `npm test`.
    - **EXPECTED OUTCOME**: All preservation and control assertions PASS, with no changed values for boundary, sentinel-lab, the modal order, or `PRESET_LIST`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 3.6 Update the existing trazo assertions in tests/story-ingest.test.ts
    - Line 18: replace `assert.ok(d.todos.length >= 2)` with per-preset expectations. `boundary` and `sentinel-lab` must have at least 2 todos. `trazo` must have exactly 0.
    - Lines 22-24 (trazo block): keep the gallery and line 216 assertions. Replace the `tapeClue.lineNumber === 216` check only if it moved. Add `tapeClue.kind === 'file'`, `path === 'src/utils/companionPathSampler.ts'`, and the original excerpt.
    - For every preset, add `assert.ok(!d.todos.some((t) => t.tag === 'STUB'))`.
    - Add an export check: for trazo, `formatKiroRevivalSpec(d, 'restore', 'Check validation first')` contains `No TODO/FIXME line markers verified` and does not contain `[STUB]`.
    - Do not modify other tests in the file.
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.8_

  - [ ] 3.7 Add the chip order regression test against gardenos.html
    - Add a source-text test (no import of `login.ts`) that extracts `PRESET_CHIPS` ids from `login.ts` and asserts the order `['boundary', 'trazo', 'sentinel-lab']`.
    - In the same test or an adjacent one, read `gardenos.html` with `readFileSync(new URL('../gardenos.html', import.meta.url), 'utf8')` and assert that the ids `btnLoadBoundary`, `btnLoadTrazo`, and `btnLoadSentinel` appear in that order. Then assert the two extracted lists match in meaning (boundary, trazo, sentinel).
    - Assert the labels `['BOUNDARY', 'Trazo', 'Sentinel Lab']` in the same order.
    - _Requirements: 2.1, 2.6, 3.4_

- [ ] 4. Checkpoint: final gate
  - Run `npm test`. All test files must pass.
  - Run `npx tsc --noEmit`. It must exit with no errors.
  - If either check fails, report the failing test or diagnostic. Do not claim success.
  - Do not run `git commit`. Do not start a dev server.
  - _Requirements: 2.6_
