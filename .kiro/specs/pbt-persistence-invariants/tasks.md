# Implementation Plan: pbt-persistence-invariants

## Overview

Add fast-check as a devDependency, then build `tests/pbt-invariants.test.ts` in small steps: harness and generators, one property per task, example checks, a timed `npm test` run that records each outcome, a conditional fix for the expected Property 2 finding, and a final test and type check. Files this plan changes: `package.json`, `package-lock.json`, `tests/pbt-invariants.test.ts`, and `src/gardenos/kiro-export.ts` only if Property 2 fails. Nothing is committed to git.

## Tasks

- [x] 1. Add fast-check as a devDependency
  - [x] 1.1 Install fast-check into devDependencies
    - Run `npm install -D fast-check@^4.11.0`. This updates `package.json` and `package-lock.json` only.
    - Confirm `fast-check` appears under devDependencies and not under dependencies.
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Verify exported API names against the installed package
    - Import the installed package by namespace and confirm each name the design uses exists: `assert`, `property`, `constant`, `constantFrom`, `oneof`, `tuple`, `option`, `array`, `uniqueArray`, `string`, `fullUnicodeString`, `json`, `integer`, `boolean`, `date`, `stringMatching`, `sample`. Confirm `option` accepts the `nil` setting.
    - Run one trivial `assert` to confirm the namespace import works under `node --experimental-strip-types`.
    - If a name is missing or behaves differently, record the replacement in this task's notes and update design.md before task 2.3 uses it. Write no repository files in this step.
    - _Requirements: 1.1, 1.3_

- [x] 2. Create the test file harness and shared generators
  - [x] 2.1 Create tests/pbt-invariants.test.ts with imports and constants
    - Import `test` from `node:test` and `assert` from `node:assert/strict`. Import `fast-check` as a namespace.
    - Import `saveProjectMemory` and `loadProjectMemory` from `src/gardenos/kiro-export.ts`, `createPresetDossier` from `src/gardenos/ingest.ts`, and `createStoryEngine` from `src/gardenos/story.ts`. Use explicit `.ts` extensions and `import type` for types. Avoid enums, namespaces, and parameter properties.
    - Define one run-count constant per property group: 200 for Properties 1 to 5, and 150 for Properties 6a, 6b, and 7. Define the verdict set and the `sd_memory_v1:` key prefix as local constants.
    - _Requirements: 1.1, 2.1_

  - [x] 2.2 Implement the fake store factory
    - Build a Map-backed object with `getItem` and `setItem`, a behaviour switch (ok, setThrows, getThrows, getReturns), a `setCalls` counter that increments before any throw, and a readable `map` field.
    - Throw the supplied value unchanged, including `undefined`, `null`, Symbols, and Error variants. Do not read any global storage.
    - _Requirements: 3.1, 4.1, 5.3, 6.4_

  - [x] 2.3 Implement the generators
    - Build the generators listed in the design's Components table: project id, creator note, ISO date, record (the `savedAt` key is omitted when absent, never set to `undefined`), invalid record with category tags (missing-note, bad-verdict, bad-note-type), garbage string, thrown-value factories that build fresh objects per run, triage operation sequence, synthetic todo id list, and saved memory.
    - The note generator must include the empty string, multi-line text, and non-ASCII text.
    - _Requirements: 3.4, 4.1, 5.1, 6.1, 6.2, 6.3, 7.1, 8.1_

  - [x] 2.4 Implement test-local oracles and the triage model
    - Write `expectedLoad`, `isValidRecord`, and the triage model from the glossary. Extra keys are allowed (design decision D1).
    - Do not import `isMemory` or any other code-under-test helper into the oracles. The oracles must restate the requirements independently.
    - _Requirements: 5.1, 6.1, 6.2, 7.2, 8.1_

  - [x] 2.5 Implement dossier and engine fixtures
    - Create a fresh Sentinel dossier and a fresh engine for every property run, so shared state cannot leak between runs or during shrinking.
    - Write a `playTape` helper that calls `interactIslandPoi('tv')` once and asserts `tapePlayed` is true. This setup call is not counted as a Triage_Operation.
    - Write the synthetic variant: structure-clone a fresh Sentinel dossier, then replace `todos`, `selectedTodoIds`, and `activeTodoIndex` (set to 0) with generated values. Keep the other fields the engine reads.
    - _Requirements: 7.1, 8.1, 8.2_

- [x] 3. Write one property-based test per property
  - [x] 3.1 Write Property 1: Memory round trip
    - Save a generated record under a generated project id, load it with the same id from the same store, and assert deep equality. Assert that `savedAt` is present in the result exactly when it was present in the input, with the same string.
    - Run with the Property 1 run count using one `fc.assert`. Put the property tag comment above the `test` block.
    - **Property 1: Memory round trip**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 3.2 Write Property 2: Honest save result
    - For a valid record and a store that either accepts `setItem` or throws a generated value, assert that `saveProjectMemory` never throws. Assert `ok` is false exactly when the store threw. When `ok` is false, assert `error` is a non-empty string. When `ok` is true, assert the result deep-equals `{ ok: true }`.
    - Do not weaken these assertions to get a pass. A failure is recorded in task 5.1.
    - **Property 2: Honest save result**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 3.3 Write Property 3: Garbage string load
    - For any generated string stored under the Memory_Key, including generated valid encodings, assert `loadProjectMemory` does not throw and returns the value from `expectedLoad`.
    - Include truncated valid encodings in the generator so near-miss strings occur.
    - **Property 3: Garbage string load**
    - **Validates: Requirements 5.1, 5.2**

  - [x] 3.4 Write Property 4: Load survives a throwing store
    - For any value thrown by `getItem`, assert `loadProjectMemory` returns `null` and does not throw.
    - This property is not in the original list of six. The design defines it as a separate property because Requirement 5.3 needs its own code path (the `catch` around `getItem`).
    - **Property 4: Load survives a throwing store**
    - **Validates: Requirements 5.3**

  - [x] 3.5 Write Property 5: Invalid records are rejected before any write
    - For each invalid-record category and a pre-seeded valid record under the same id, assert `ok` is false. For the missing-note and bad-verdict categories, assert `error` is a non-empty string. Assert `setCalls` is 0 and the stored value is unchanged.
    - Use the category tag in each assertion message so a failure names the broken rule.
    - **Property 5: Invalid records are rejected before any write**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 3.6 Write Property 6a: Triage selection on the Sentinel dossier
    - For any Triage_Operation sequence on a fresh Sentinel dossier, after every operation assert: no repeated id in `selectedTodoIds`, every selected id is in the track id list, `isTodoSelected` matches model membership for every track id, the selected set equals the model set, and `activeTodoIndex` equals the model index.
    - Use the `playTape` fixture before the sequence.
    - **Property 6: Triage selection matches the model (Sentinel variant, 6a)**
    - **Validates: Requirements 7.1, 7.2, 8.1**

  - [x] 3.7 Write Property 6b: Triage selection on synthetic track ids
    - Use the same body as 3.6 with generated unique id lists of 0 to 8 ids, built with the synthetic fixture from 2.5.
    - State in the test title that the ids are synthetic test inputs. They are not product data (design decision D3).
    - **Property 6: Triage selection matches the model (synthetic variant, 6b)**
    - **Validates: Requirements 7.1, 7.2, 8.1**

  - [x] 3.8 Write Property 7: Fresh engine selects every track
    - Read the `createStoryEngine` signature in `src/gardenos/story.ts` first, and confirm the type of the third `memory` argument before passing generated saved memory.
    - For pace in `demo` and `full`, and for optional saved memory, assert a fresh engine's selected set equals the track id set as sets, and `isTodoSelected` is true for every track id.
    - **Property 7: Fresh engine selects every track**
    - **Validates: Requirements 8.2**

- [x] 4. Add example checks
  - [x] 4.1 Add the no-DOM globals check
    - Assert `globalThis.window` and `globalThis.document` are both `undefined` before the properties run.
    - _Requirements: 2.3_

  - [x] 4.2 Add the generator coverage example and run-count range check
    - Use `fc.sample` with a fixed seed. Assert the sample includes the empty string, a note containing `\n`, and a note containing a code point above `0x7f`.
    - Assert each run-count constant from 2.1 is between 100 and 200 inclusive.
    - _Requirements: 2.1, 3.4_

- [x] 5. Run the suite and record each outcome
  - [x] 5.1 Run npm test once and record results
    - Run `npm test` and time it. Record for each property (1, 2, 3, 4, 5, 6a, 6b, 7): pass or fail. For any failure, record the invariant name, the fast-check counterexample, the seed, and the path.
    - Record the total duration against the 5000 ms budget. If the budget is exceeded, lower run counts within [100, 200] before changing anything else.
    - Do not edit a failing property to make it pass. If Property 2 fails, continue with task 6. If any other property fails, stop and report the counterexample to the user before changing `src/`.
    - Keep these results for the final result in task 7.
    - _Requirements: 2.2, 9.1, 9.4_

- [x] 6. Fix the saveProjectMemory catch-block defect (only if Property 2 failed in task 5.1)
  - If Property 2 passed, leave tasks 6.1 to 6.3 unchecked and note "skipped: no Finding produced" in the final result.
  - [x] 6.1 Add a non-throwing describeStorageError helper in kiro-export.ts
    - Add a helper that returns the name and message text for `Error` instances, converting each with `String()` inside a `try`. Return `'Storage unavailable.'` when the conversion or the instance check throws, or for non-Error values.
    - In the `catch` of `saveProjectMemory`, replace the template literal with a call to the helper.
    - Change nothing else: validation order, `isMemory`, and the success path stay the same. Existing output for ordinary errors (for example `Error: quota`) must not change.
    - _Requirements: 4.1, 4.2, 9.2_

  - [x] 6.2 Add a regression example test
    - In `tests/pbt-invariants.test.ts`, add example tests for an Error whose `name` is a Symbol, an Error whose `message` is a Symbol, and an Error whose `name` getter throws. Each must return `ok: false` with a non-empty `error` and must not throw.
    - Add an example asserting that `new Error('quota')` still yields `Error: quota`.
    - _Requirements: 4.1, 4.2_

  - [x] 6.3 Rerun Property 2 and the full suite
    - Run `npm test`. Property 2 must now pass.
    - If it still fails, stop and report the new counterexample. Do not extend the fix without a separate decision.
    - Record in the final result: the invariant name, the counterexample from task 5.1, and the fix from 6.1.
    - _Requirements: 9.2, 9.3_

- [x] 7. Final checkpoint: run npm test and npx tsc --noEmit
  - Run `npm test` and `npx tsc --noEmit`, and record both results.
  - `tsconfig.json` includes only `src`, so `tsc` does not check `tests/pbt-invariants.test.ts`. Record that limitation. The suite is verified by the `npm test` run.
  - The final result must state each property's outcome, the timing from task 5.1, the fast-check version, and either the Finding record (invariant, counterexample, fix) or an explicit statement that no Finding was produced.
  - Confirm that no git commit was made.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No sub-task is marked with `*`. The property tests are the deliverable of this feature, so they are required, not optional. Marking them optional would skip the feature's core work.
- Property 4 is included as task 3.4 although it was not in the six-item list. The design defines seven properties, and Requirement 5.3 needs its own property.
- Property 6 is split into 6a (Sentinel dossier) and 6b (synthetic ids) because the design requires both variants.
- Tasks 6.1 to 6.3 apply only if Property 2 fails. They are part of this plan so the fix happens in the same session, as Requirement 9.2 requires.
- The `main.ts` toggle paths are not covered. Covering them needs a `src/` change that is outside this approval (see design, Known gap).
- No code is written in this phase. Nothing is committed to git.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4"] },
    { "id": 6, "tasks": ["2.5"] },
    { "id": 7, "tasks": ["3.1"] },
    { "id": 8, "tasks": ["3.2"] },
    { "id": 9, "tasks": ["3.3"] },
    { "id": 10, "tasks": ["3.4"] },
    { "id": 11, "tasks": ["3.5"] },
    { "id": 12, "tasks": ["3.6"] },
    { "id": 13, "tasks": ["3.7"] },
    { "id": 14, "tasks": ["3.8"] },
    { "id": 15, "tasks": ["4.1"] },
    { "id": 16, "tasks": ["4.2"] },
    { "id": 17, "tasks": ["5.1"] },
    { "id": 18, "tasks": ["6.1"] },
    { "id": 19, "tasks": ["6.2"] },
    { "id": 20, "tasks": ["6.3"] },
    { "id": 21, "tasks": ["7"] }
  ]
}
```

## Run Record

- Task 5.1, first run of tests/pbt-invariants.test.ts: Properties 1, 3, 4, 5, 6a, 6b, 7 passed. Property 2 failed. Counterexample: a thrown Error whose name is a Symbol. saveProjectMemory threw a TypeError from its catch block instead of returning ok:false.
- Task 6 (fix applied because Property 2 failed): describeStorageError helper in src/gardenos/kiro-export.ts, plus four regression examples. Property 2 passes after the fix. Ordinary Error output is unchanged (Error: quota).
- Counterexample search: a temporary copy of the suite at 5000 cases per property passed all properties, and the copy was removed afterwards.
- Final checkpoint (task 7): npm test 103 of 103 passed. npx tsc --noEmit exit 0. fast-check 4.11.0. Test file duration about 0.3 s.
- Not committed to git.