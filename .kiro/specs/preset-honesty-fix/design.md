# Preset Honesty Fix Bugfix Design

## Overview

The GardenOS reception and dossier code disagree in two places. Both are data or ordering defects, not logic defects.

1. The CRT login screen draws its Demo preset chips from `PRESET_CHIPS` in `src/gardenos/login.ts:10-14`. That array lists Trazo first. The dossier modal in `gardenos.html:201-203` lists BOUNDARY, TRAZO, Sentinel. The fix reorders the array to BOUNDARY, Trazo, Sentinel Lab. The draw code and the hit-test code both index by position into this array, so reordering the entries changes which label appears in each slot and which preset a click selects, and both change together.
2. The `trazo` preset in `src/gardenos/presets.ts` carries three todo tracks tagged `STUB` and classifies its trace clue `tapeClue` as `kind: 'unfinished'`. The bug report identifies these as false findings. The fix removes the three todo entries, which leaves the trazo todo list empty, and changes the trazo `tapeClue.kind` from `'unfinished'` to `'file'`. The clue keeps its path, line number 216, and excerpt.

The fix changes three files: `src/gardenos/login.ts`, `src/gardenos/presets.ts`, and `tests/story-ingest.test.ts`. The `PRESET_LIST` export, the ingest detector in `src/gardenos/ingest.ts`, and the boundary and sentinel-lab presets stay unchanged. The three `src/server` and `src/utils` files named in the bug report are not in this workspace, so the excerpts stored in `presets.ts` are the only evidence used. This design does not read any binary media and does not add any local filesystem path.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the defect. Here it is true when the Demo chips on the CRT login screen list Trazo before BOUNDARY, or when the trazo preset exposes a `STUB` todo track for `trazo-spa-fallback`, `trazo-eval-rule`, or `trazo-sampler-fallback`, or when its `tapeClue.kind` is `'unfinished'`.
- **Property (P)**: The desired behavior under C. The chip order matches the dossier modal order. The trazo preset has no false `STUB` tracks and classifies its clue as a file.
- **Preservation**: Behavior outside C that must not change. This includes the boundary and sentinel-lab todo tracks, the dossier button order, the ingest detector, `PRESET_LIST`, and the export text for presets with a non-empty todo list.
- **PRESET_CHIPS**: The array in `src/gardenos/login.ts:10-14` that defines the Demo chip slots. Slot index `i` draws `PRESET_CHIPS[i]` and clicks select `PRESET_CHIPS[i].id`.
- **rect.presets**: The three chip rectangles in `src/gardenos/login.ts` used for both drawing and hit-testing. Slot `i` in `rect.presets` corresponds to `PRESET_CHIPS[i]`.
- **TodoTrack**: One entry in `PresetSpec.todos` (`src/gardenos/presets.ts`). Fields: `id`, `path`, `lineNumber`, `excerpt`, `tag`, `score`.
- **tapeClue**: The trace clue in `PresetSpec.tapeClue`. Its `kind` is `'unfinished'` or `'file'`.
- **STUB_CODE_RE**: The detector regex in `src/gardenos/ingest.ts:100` that tags `STUB` only for `todo!(`, `unimplemented!(`, `NotImplementedError`, or a `panic(` with "not implemented" text.
- **PRESET_LIST**: The export in `src/gardenos/presets.ts:804` that equals `[PRESETS.trazo, PRESETS.boundary, PRESETS['sentinel-lab']]`. It contains live references, so it reflects the fix without an edit.
- **Hypothesis (unconfirmed)**: A label for any inferred cause in this document that is not directly shown by the code or the bug report.

## Bug Details

### Bug Condition

The bug has two independent parts. The first is the order of the login chips. The second is the trazo findings and clue kind.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ScreenOrPreset, where ScreenOrPreset is either
         (a) the CRT login chip layout, or
         (b) the PresetSpec for id = 'trazo'
  OUTPUT: boolean

  IF input is (a) THEN
    RETURN indexOf(PRESET_CHIPS, 'trazo') < indexOf(PRESET_CHIPS, 'boundary')
  END IF

  IF input is (b) THEN
    RETURN EXISTS t IN input.todos WHERE
             t.id IN ['trazo-spa-fallback', 'trazo-eval-rule', 'trazo-sampler-fallback']
             AND t.tag = 'STUB'
           OR input.tapeClue.kind = 'unfinished'
  END IF
END FUNCTION
```

### Examples

- **Chip order (login.ts):** The Demo chips draw as `[Trazo, BOUNDARY, Sentinel Lab]`. Expected: `[BOUNDARY, Trazo, Sentinel Lab]`, matching `gardenos.html`.
- **Chip selection (login.ts):** Today the first slot draws "Trazo" and a click there sets `presetId = 'trazo'`. After the fix the first slot draws "BOUNDARY" and a click sets `presetId = 'boundary'`. Each slot still selects the preset whose label it draws.
- **SPA fallback (presets.ts):** The trazo todo `trazo-spa-fallback` is tagged `STUB` with excerpt `// Static assets / SPA fallback for non-API routes`. Expected: no such track. This is a standard Express fallback route and not a stub.
- **Eval rule (presets.ts):** The trazo todo `trazo-eval-rule` is tagged `STUB` with excerpt `- "NOT_MET": The evidence is interpretable, but demonstrates that the criterion is NOT yet satisfied.`. Expected: no such track. This is a prompt rule string.
- **Sampler fallback (presets.ts):** The trazo todo `trazo-sampler-fallback` is tagged `STUB` with excerpt `// Fallback: simple line if parsing yielded no segments`. Expected: no such track. This is an intentional fallback branch with no stub marker.
- **Clue kind (presets.ts):** `trazo.tapeClue` has `kind: 'unfinished'` for `companionPathSampler.ts:216`. Expected: `kind: 'file'`, with the same path, line 216, and excerpt.
- **Edge case, boundary preset (must not change):** `boundary-todo-report` at `src/main.py:294` and `boundary-todo-validate` at `src/main.py:280`, both tagged `TODO`. These stay as they are.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Boundary todo tracks `boundary-todo-report` (`src/main.py:294`, `TODO`) and `boundary-todo-validate` (`src/main.py:280`, `TODO`) stay in the boundary preset with the same paths, line numbers, and tags.
- Sentinel-lab todo tracks `sentinel-tape-timeout` (`modulo-04-scanner/port_scanner.py:64`, `TODO`) and `sentinel-tape-cidr` (`modulo-04-scanner/cidr_utils.py:28`, `FIXME`) stay in the sentinel-lab preset, with DEMO provenance.
- The dossier modal in `gardenos.html` keeps its order, BOUNDARY, TRAZO, Sentinel [DEMO], and its button IDs `btnLoadBoundary`, `btnLoadTrazo`, `btnLoadSentinel`.
- Trazo gallery images, primary image, commits, next steps, run commands, and test command stay as they are.
- The login screen still defaults to `presetId = 'boundary'` on reset (`login.ts` `reset()`).
- The chip labels stay as they are: "BOUNDARY", "Trazo", "Sentinel Lab". The label casing differs from the modal "TRAZO" label and "Sentinel [DEMO]", and that difference is not part of this fix.
- `PRESET_LIST` (`presets.ts:804`) keeps its three entries in the order trazo, boundary, sentinel-lab.
- The ingest detector in `ingest.ts` (`COMMENT_TODO_RE`, `DOC_TODO_RE`, `STUB_CODE_RE`) is unchanged.
- Provenance labels ORIGINAL, SNAPSHOT, DEMO, and the separation of observed facts, hypotheses (unconfirmed), and creator notes stay as they are.
- A trazo preset with an empty todo list still states in exports that no TODO/FIXME line markers were verified, rather than inventing a marker.

**Scope:**
Every input that does not match the bug condition is unaffected. This includes the Demo chip click handling for slots whose order does not change, the GitHub and Carpeta origin flows, the local ingest and GitHub ingest paths, and all export formatters for presets that have todos.

## Hypothesized Root Cause

Each cause below is a Hypothesis (unconfirmed). The first part of each is an observed fact from the code.

1. **Two independent chip lists**: `PRESET_CHIPS` (`login.ts:10-14`) and the modal buttons (`gardenos.html:201-203`) are written as separate literals. Nothing ties their order together.
   - Observed: The two lists were authored in different orders and nothing shares a constant.
   - Hypothesis (unconfirmed): The CRT list was written before the modal order was settled, and no later edit synchronized them.

2. **Trazo STUB tags not produced by the detector**: The three `STUB` tracks in `presets.ts` do not match `STUB_CODE_RE` (`ingest.ts:100`). None of the three excerpts contains `todo!(`, `unimplemented!(`, `NotImplementedError`, or a `panic(` with "not implemented" text.
   - Observed: The excerpts fail the detector regex, so the tags did not come from the detector.
   - Hypothesis (unconfirmed): The preset data was hand-authored and the tags were set by hand, not by the ingest path.

3. **Clue kind set separately from the todo list**: `trazo.tapeClue.kind` (`presets.ts`) is `'unfinished'`. It is set in the preset data independently of the todo list, and it reuses the same `companionPathSampler.ts:216` line as the removed sampler track.
   - Observed: The clue and the removed track share the path, line, and excerpt.
   - Hypothesis (unconfirmed): The clue was classified as unfinished for the same reason as the removed track.

4. **Excerpt-only evidence**: The `companionPathSampler.ts` file and the `src/server` files are not in this workspace. The findings rest on the excerpts alone.
   - Observed: The three source files are absent from the workspace.
   - Hypothesis (unconfirmed): The excerpts are accurate, so the bug report's classification holds.

## Correctness Properties

Property 1: Bug Condition - Chip Order and Trazo Findings

_For any_ rendering of the Demo chip layout (the CRT login screen with origin `Demo`), the fixed `PRESET_CHIPS` SHALL list the ids in the order `boundary`, `trazo`, `sentinel-lab` with the labels `BOUNDARY`, `Trazo`, `Sentinel Lab`. Each chip slot SHALL select the preset whose label it draws. For the trazo preset, the fixed `PresetSpec` SHALL contain no todo track whose id is `trazo-spa-fallback`, `trazo-eval-rule`, or `trazo-sampler-fallback`, SHALL contain no todo track tagged `STUB`, and SHALL set `tapeClue.kind` to `'file'` while keeping `tapeClue.path` `src/utils/companionPathSampler.ts`, `tapeClue.lineNumber` 216, and `tapeClue.excerpt` `// Fallback: simple line if parsing yielded no segments`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Non-Bug Presets, Dossier Order, and Export Behavior

_For any_ input where the bug condition does NOT hold (boundary and sentinel-lab presets, the dossier modal order, `PRESET_LIST`, the ingest detector, and the export of a preset with an empty todo list), the fixed code SHALL produce the same result as the original code, preserving the todo tracks, provenance labels, button order, default preset, detector rules, and the "no markers verified" export statement described in Preservation Requirements.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

**File**: `src/gardenos/login.ts`

**Constant**: `PRESET_CHIPS` (lines 10-14)

**Specific Changes**:
1. **Reorder the chip array**: Move the `boundary` entry to the first position and keep the `trazo` and `sentinel-lab` entries in their current relative order.
   - Result: `[{ id: 'boundary', label: 'BOUNDARY' }, { id: 'trazo', label: 'Trazo' }, { id: 'sentinel-lab', label: 'Sentinel Lab' }]`.
   - Labels stay as they are.
2. **No change to draw or hit code**: The draw call at `login.ts` `PRESET_CHIPS.forEach((p, i) => chip(rect.presets[i], p.label, p.id === presetId))` and the hit call that returns `{ preset: PRESET_CHIPS[si].id }` both index by position. Reordering the array keeps both correct. Draw and hit are gated by the same condition, `origin === 'Demo'` (the draw branch is the `else` of the GitHub and Carpeta checks). Both use the same three slots, so no index goes out of range.

**File**: `src/gardenos/presets.ts`

**Object**: `PRESETS.trazo` (`todos` array and `tapeClue` object)

**Specific Changes**:
1. **Remove the three STUB tracks**: Delete the entries `trazo-sampler-fallback`, `trazo-spa-fallback`, and `trazo-eval-rule` from `trazo.todos`. Set `todos: []`.
   - Downstream effect, checked in the code:
     - `src/gardenos/kiro-export.ts` (`observations`, lines 50-53) prints `- No TODO/FIXME line markers verified in sampled files.` when the todo list is empty. This satisfies Requirement 3.8.
     - `src/gardenos/story.ts` (`currentTrack`, line 137) returns `null` for an empty list. The code path is null-safe.
     - `src/gardenos/main.ts` (`toggleTodoInKiro`, lines 177-181) builds `allIds` from an empty array. This does not throw.
     - `src/gardenos/crt-canvas.ts` (`activeTrack`, lines 135-142) falls back to `dossier.tapeClue` when there are no todos. The CRT readout for trazo will show the tape clue, with tag `TRACE`, in place of the removed STUB tracks.
2. **Reclassify the tape clue**: Change `trazo.tapeClue.kind` from `'unfinished'` to `'file'`. Keep `id`, `title`, `path` (`src/utils/companionPathSampler.ts`), `lineNumber` (216), `excerpt` (`// Fallback: simple line if parsing yielded no segments`), `provenance`, `dateLabel`, and `observedFact`.
   - The `kind` union already includes `'file'` in `presets.ts` (`tapeClue.kind: 'unfinished' | 'file'`) and in `ingest.ts`. No type change is needed.
   - Narration impact is zero for trazo. `story.ts` (`getReceptionLines`, around lines 225-240) checks `firstCommit` before it checks `tape.kind`. Trazo has commits, so the `'unfinished'` branch was never reached for trazo. The change matters only for a preset with no commits, and none of the three presets has that shape.
   - Trazo `tapeClue.id` is still `trazo-sampler-fallback`, the id of the removed track. A search of `src` found no code that reads `tapeClue.id`. Keep the id unchanged so the requirement to keep export references stable holds. See Open Decisions.
3. **Open Decision on the interpretation text**: The trazo `tapeClue.interpretation` text is conditional and has no `Hypothesis (unconfirmed)` label. The steering rule for `src/gardenos/` requires that label on every interpretive line. The `observedFact` text describes a runtime fallback, but the only evidence is the comment excerpt. See Open Decisions.

`PRESET_LIST` (`presets.ts:804`) needs no edit. It holds references to `PRESETS.trazo`, so it reflects the change.

**File**: `tests/story-ingest.test.ts`

**Specific Changes**:
1. **Line 18 (every-preset todo minimum)**: The assertion `assert.ok(d.todos.length >= 2)` runs for all three presets. After the fix trazo has zero todos, so the assertion would fail. Replace it with a per-preset expectation: `boundary` and `sentinel-lab` must have at least 2 todos, and `trazo` must have exactly 0.
2. **Trazo block (line 24)**: Add assertions that `d.tapeClue.kind === 'file'`, `d.tapeClue.path === 'src/utils/companionPathSampler.ts'`, and `d.tapeClue.excerpt` equals the original excerpt. Add `assert.ok(!d.todos.some((t) => t.tag === 'STUB'))` for every preset.
3. **Export statement for an empty trazo list**: Build the export with `formatKiroRevivalSpec(d, 'restore', 'Check validation first')` for trazo. Assert that the output contains `No TODO/FIXME line markers verified` and does not contain `[STUB]`. This covers Requirement 3.8.
4. **Chip order (new test, no existing chip test)**: Read `src/gardenos/login.ts` with `readFileSync(new URL('../src/gardenos/login.ts', import.meta.url), 'utf8')`. Extract the ids from the `PRESET_CHIPS` array literal in order. Assert the result equals `['boundary', 'trazo', 'sentinel-lab']`. Read `gardenos.html` and assert that the `id` attributes `btnLoadBoundary`, `btnLoadTrazo`, `btnLoadSentinel` appear in that order. The test reads source text instead of importing `login.ts`, because `login.ts` imports `three/webgpu` at load time and that import has not been checked under `node --experimental-strip-types`.
5. **Preservation snapshot (new assertions)**: Assert the exact todo tuples (`id`, `path`, `lineNumber`, `tag`) for `boundary` and `sentinel-lab`, using the values listed in Preservation Requirements. Assert `PRESET_LIST.map((p) => p.id)` equals `['trazo', 'boundary', 'sentinel-lab']`.

No other test file references chip order, the trazo findings, or `tapeClue.kind` (search of `tests/` found no matches for `PRESET_CHIPS`, `STUB`, or `chip` outside `story-ingest.test.ts`).

### Open Decisions

These items need a decision before implementation. The recommended default is listed first.

1. **Hypothesis label on the trazo clue text**: Recommended: prefix `tapeClue.interpretation` with `Hypothesis (unconfirmed): ` and keep the rest of the text. Requirement 2.5 does not cover this text, so the change is optional. The steering rule requires it. Alternative: leave the text unchanged and record the gap.
2. **Evidence wording in `observedFact`**: The current trazo `observedFact` says the code "falls back to a straight-line path". The only evidence is the comment excerpt, and the source file is not in this workspace. Recommended: leave the text unchanged in this fix and note the limitation in the export. Alternative: reword the fact to quote the excerpt only.
3. **Trazo CRT readout change**: With no todos, the CRT readout for trazo shows the tape clue with tag `TRACE` instead of the removed `STUB` tracks. This is a visible change not listed in the requirements. Recommended: accept it, since it follows from requirement 2.3 and 2.4 and the existing fallback in `crt-canvas.ts`.
4. **Sentinel label mismatch**: The chip label is "Sentinel Lab" and the modal button is "Sentinel [DEMO]". Requirement 2.1 says to keep the existing chip labels, so this is not changed.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach. First, run the new assertions on the unfixed code to show the bug. Then apply the fix and show that the assertions pass and the preservation assertions still hold. Run the checks with `npm test` (which runs `node --experimental-strip-types --test tests/*.test.ts`) and `npx tsc --noEmit`. Do not start a dev server.

### Exploratory Bug Condition Checking

**Goal**: Show the bug on the unfixed code and confirm that the three root-cause hypotheses match the data.

**Test Plan**: Add the new assertions from the Fix Implementation section to `tests/story-ingest.test.ts`, then run `npm test` before changing any source file.

**Test Cases**:
1. **Chip order source test**: Extract `PRESET_CHIPS` ids from `login.ts`. Expected failure: the actual order is `['trazo', 'boundary', 'sentinel-lab']`. (fails on unfixed code)
2. **Modal order source test**: Read `gardenos.html` button order. Expected result: passes on unfixed code, because the modal order is already correct. (passes on unfixed code, as a control)
3. **Trazo todo test**: Assert the trazo todo list contains no `STUB` tracks. Expected failure: three `STUB` tracks are present. (fails on unfixed code)
4. **Trazo clue kind test**: Assert `trazo.tapeClue.kind === 'file'`. Expected failure: the actual value is `'unfinished'`. (fails on unfixed code)
5. **Existing todo minimum**: The current `todos.length >= 2` check passes for trazo on unfixed code (3 tracks). This is expected. The updated per-preset check replaces it.

**Expected Counterexamples**:
- The chip order array starts with `trazo`.
- Trazo has three `STUB` tracks with ids `trazo-sampler-fallback`, `trazo-spa-fallback`, and `trazo-eval-rule`.
- Trazo `tapeClue.kind` is `'unfinished'`.
- Possible causes: manually set order in `login.ts`, manually set tags in `presets.ts`, and manually set clue kind in `presets.ts`. These are the Hypothesis (unconfirmed) causes listed above.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code gives the expected result.

**Pseudocode:**
```
FOR ALL layout WHERE isBugCondition(layout) DO
  chips := fixed PRESET_CHIPS
  ASSERT ids(chips) = ['boundary', 'trazo', 'sentinel-lab']
  ASSERT FOR EACH slot i: draw(slot i).label = chips[i].label AND hit(slot i).preset = chips[i].id
END FOR

FOR ALL p WHERE p = PRESETS.trazo DO
  ASSERT NOT EXISTS t IN p.todos WHERE t.tag = 'STUB'
  ASSERT p.todos has no id in {trazo-spa-fallback, trazo-eval-rule, trazo-sampler-fallback}
  ASSERT p.tapeClue.kind = 'file' AND p.tapeClue.path = 'src/utils/companionPathSampler.ts' AND p.tapeClue.lineNumber = 216
END FOR
```

The slot-to-label and slot-to-id checks follow from the index structure of `draw` and `hit`. The source test checks the array order, and the code review in the Fix Implementation section checks the index use.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code gives the same result as the original code.

**Pseudocode:**
```
FOR ALL p WHERE p IN {PRESETS.boundary, PRESETS['sentinel-lab']} DO
  ASSERT p.todos(fixed) = p.todos(original)
END FOR
ASSERT modalOrder(fixed) = modalOrder(original)
ASSERT PRESET_LIST.map(id) = ['trazo', 'boundary', 'sentinel-lab']
```

**Testing Approach**: The finite domain here has three presets and three chip slots. Every case can be enumerated, so enumerative assertions cover the full domain. No property-based generator is needed. The package scripts show no generator library, and I did not check the dev dependencies. Adding one is not required for this fix.

**Test Plan**: Capture the boundary and sentinel-lab todo tuples from the unfixed code, which the Preservation Requirements section lists. Then assert that the fixed code returns the same tuples.

**Test Cases**:
1. **Boundary todos**: Assert exact `id`, `path`, `lineNumber`, and `tag` for both boundary tracks. Observe on unfixed code (passes), then keep the assertion after the fix.
2. **Sentinel todos and DEMO provenance**: Assert exact tuples for both sentinel tracks and `provenance === 'DEMO'` on the sentinel primary piece and clue. Observe on unfixed code (passes), then keep the assertion.
3. **Trazo gallery, commits, and commands**: Assert `galleryImages.length === 3`, the commit count, and `runCommands` length are unchanged. Observe on unfixed code, then keep the assertion.
4. **Empty-list export**: For trazo after the fix, assert the export includes "No TODO/FIXME line markers verified" and no `[STUB]` text.
5. **Default preset and PRESET_LIST order**: Assert the default preset is `boundary` in the reset path (source check) and that `PRESET_LIST` order is unchanged.

### Unit Tests

- Chip order: extract `PRESET_CHIPS` ids from `login.ts` source and compare with `['boundary', 'trazo', 'sentinel-lab']`.
- Chip labels: extract labels in order and compare with `['BOUNDARY', 'Trazo', 'Sentinel Lab']`.
- Modal order: check the button ids in `gardenos.html`.
- Trazo todos: exactly 0 todos, no `STUB` tag.
- Trazo tape clue: `kind === 'file'`, path, line 216, excerpt unchanged.
- Boundary and sentinel-lab todos: exact tuples.
- `PRESET_LIST` order.

### Property-Based Tests

- Not added. The input domains are three presets and three chip slots, and the unit tests above cover each element. A generator would not add coverage.

### Integration Tests

- Run `npm test` and confirm all test files pass. The existing local folder, GitHub, Kiro export, and memory tests in `story-ingest.test.ts` exercise the ingest detector and export paths that must not change.
- Run `npx tsc --noEmit` and confirm it passes. The `kind: 'file'` value is already in the union types, so no type change should be needed.
- Manual check, optional and outside this phase: open the CRT login screen and confirm the chip order visually, and select the trazo chip to confirm the CRT readout. The user runs the dev server; the agent does not start it.
