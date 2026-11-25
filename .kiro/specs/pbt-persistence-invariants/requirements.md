# Requirements Document

## Introduction

This feature adds property-based tests (PBT) for five invariants in the Silicon Dreams GardenOS code. The tests use `fast-check`, added as a devDependency, and live in a new file `tests/pbt-invariants.test.ts`. The suite runs under the repository runner `node --experimental-strip-types --test tests/*.test.ts` with no DOM.

The covered invariants are:

1. Project memory round trip through the Persistence_Module.
2. Honest failure when the Memory_Store rejects a write.
3. Corruption tolerance when the stored string is garbage.
4. Rejection of invalid Project_Memory_Records before any write.
5. Triage selection integrity: no duplicate ids, and every selected id belongs to the dossier.

Scope for this phase: requirements only. No file under `src/` changes in this phase, and no git commit is made.

Finding rule: a property that fails is a real finding about the code, not a flaky test. Requirement 9 governs how failures are handled in later phases.

Source-grounded facts this document relies on:

- `saveProjectMemory` and `loadProjectMemory` live in `src/gardenos/kiro-export.ts`. Keys are `sd_memory_v1:<projectId>`.
- `saveProjectMemory` returns `{ ok, error? }`. It returns `ok: false` with an error string for invalid records and for thrown storage errors.
- `loadProjectMemory` returns `null` for missing, unparseable, or invalid values. It catches all errors.
- `createStoryEngine` in `src/gardenos/story.ts` exposes `toggleActiveTodoForKiro`, `isTodoSelected`, and `interactIslandPoi('tv')`. The last one advances the active track index after the first tape play.
- `createPresetDossier('sentinel-lab', ...)` in `src/gardenos/ingest.ts` returns two todo tracks with ids `sentinel-tape-timeout` and `sentinel-tape-cidr`.

## Glossary

- **PBT_Suite**: The fast-check test file `tests/pbt-invariants.test.ts`, run by the repository test runner.
- **Property_Run**: One fast-check property execution with a fixed `numRuns` value.
- **Persistence_Module**: The pair `saveProjectMemory` and `loadProjectMemory` exported from `src/gardenos/kiro-export.ts`.
- **Memory_Store**: A storage object with `getItem` and `setItem` methods. Tests supply an in-memory Map-backed implementation, and a failing variant whose `setItem` throws.
- **Memory_Key**: The string `sd_memory_v1:` followed by the project id.
- **Project_Memory_Record**: An object with `creatorNote` (string), `verdict` (`null`, `archive`, `restore`, or `leave`), and an optional `savedAt` (string). The record is valid when it meets this shape and is invalid otherwise.
- **Persisted_Encoding**: A string that the Persistence_Module would accept as a stored record, meaning it parses as JSON to a valid Project_Memory_Record.
- **Triage_Engine**: The story engine returned by `createStoryEngine` in `src/gardenos/story.ts`, limited to `toggleActiveTodoForKiro`, `isTodoSelected`, and `interactIslandPoi('tv')`.
- **Triage_Operation**: One call to `toggleActiveTodoForKiro` or one call to `interactIslandPoi('tv')` made after the tape has played.
- **Selected_Todo_Set**: The `selectedTodoIds` array of the dossier used by the Triage_Engine.
- **Todo_Id_Set**: The set of `id` values in the dossier's `todos` array.
- **Sentinel_Dossier**: The result of `createPresetDossier('sentinel-lab', visitorName)`, with two todo tracks.
- **Finding**: A Property_Run that fails and reports a counterexample.

## Requirements

### Requirement 1: Test dependency

**User Story:** As a maintainer, I want fast-check available as a devDependency, so that the PBT_Suite can import it without adding a runtime dependency.

#### Acceptance Criteria

1. THE PBT_Suite SHALL import `fast-check` from the devDependencies section of `package.json`.
2. THE PBT_Suite SHALL NOT add `fast-check` to the dependencies section of `package.json`.
3. THE PBT_Suite SHALL run under the existing `npm test` script without a change to that script.

### Requirement 2: Suite size and runtime

**User Story:** As a maintainer, I want each property sized for a unit-test suite, so that the suite stays fast in every test run.

#### Acceptance Criteria

1. THE PBT_Suite SHALL set `numRuns` to a value between 100 and 200 inclusive for each Property_Run.
2. THE PBT_Suite SHALL complete all Property_Runs in one invocation within 5000 milliseconds on the development machine.
3. THE PBT_Suite SHALL execute without a DOM or browser globals, using only Node built-ins and the modules under test.

### Requirement 3: Memory round trip

**User Story:** As a creator, I want a saved creator note and verdict to load back unchanged, so that my memory of a project survives a reload.

#### Acceptance Criteria

1. WHEN any project id string and any Project_Memory_Record are saved with the Persistence_Module and then loaded with the same project id against the same Memory_Store, THE Persistence_Module SHALL return a record deep-equal to the saved record.
2. WHEN the generated Project_Memory_Record has no `savedAt` field, THE Persistence_Module SHALL return a record that has no `savedAt` field.
3. WHEN the generated Project_Memory_Record has a `savedAt` string, THE Persistence_Module SHALL return a record with the same `savedAt` string.
4. THE PBT_Suite SHALL generate `creatorNote` values that include the empty string, multi-line text, and non-ASCII characters.

### Requirement 4: Honest save failure

**User Story:** As a creator, I want a failed save to report the failure, so that I never believe my note was stored when it was not.

#### Acceptance Criteria

1. IF the Memory_Store `setItem` method throws any value while a valid Project_Memory_Record is saved, THEN THE Persistence_Module SHALL return an object whose `ok` field is `false`.
2. IF the Memory_Store `setItem` method throws while a valid Project_Memory_Record is saved, THEN THE Persistence_Module SHALL return an `error` field that is a non-empty string.
3. WHEN a valid Project_Memory_Record is saved against a Memory_Store whose `setItem` method succeeds, THE Persistence_Module SHALL return an object whose `ok` field is `true` and whose `error` field is absent.

### Requirement 5: Corruption tolerance on load

**User Story:** As a creator, I want corrupted or foreign data under my memory key to be ignored, so that a bad value never crashes the reception flow.

#### Acceptance Criteria

1. WHEN the Memory_Store `getItem` method returns a string under the Memory_Key that is not a Persisted_Encoding, THE Persistence_Module SHALL return `null`.
2. WHEN the Memory_Store `getItem` method returns a string under the Memory_Key, THE Persistence_Module SHALL complete without throwing an exception.
3. IF the Memory_Store `getItem` method throws any value, THEN THE Persistence_Module SHALL return `null` without throwing an exception.

Note on Requirement 5.1: A generated string can happen to be a valid Persisted_Encoding, such as `{"creatorNote":"","verdict":null}`. For such a string, the Persistence_Module correctly returns the record. The PBT_Suite SHALL therefore check that the output equals `null` only for strings that are not Persisted_Encodings, and SHALL check the returned record for strings that are.

### Requirement 6: Invalid record rejection

**User Story:** As a maintainer, I want invalid records rejected before any write, so that the store never holds a record the loader would discard.

#### Acceptance Criteria

1. WHEN a record that has no `creatorNote` field is saved with the Persistence_Module, THE Persistence_Module SHALL return an object whose `ok` field is `false` and whose `error` field is a non-empty string.
2. WHEN a record whose `verdict` field is not `null`, `archive`, `restore`, or `leave` is saved with the Persistence_Module, THE Persistence_Module SHALL return an object whose `ok` field is `false` and whose `error` field is a non-empty string.
3. WHEN a record whose `creatorNote` field is not a string is saved with the Persistence_Module, THE Persistence_Module SHALL return an object whose `ok` field is `false`.
4. WHEN an invalid record is saved with the Persistence_Module, THE Persistence_Module SHALL NOT call `setItem` on the Memory_Store.

### Requirement 7: Triage selection without duplicates

**User Story:** As a creator, I want my track selection to contain no duplicate entries, so that the Kiro spec never lists a track twice.

#### Acceptance Criteria

1. WHEN any sequence of Triage_Operations is applied to a Sentinel_Dossier through the Triage_Engine, THE Triage_Engine SHALL leave the Selected_Todo_Set with no repeated id.
2. WHEN any sequence of Triage_Operations is applied to a Sentinel_Dossier through the Triage_Engine, THE Triage_Engine SHALL make `isTodoSelected` return `true` for each id in the Selected_Todo_Set and `false` for each Todo_Id_Set id outside it.

### Requirement 8: Triage selection within dossier tracks

**User Story:** As a creator, I want every selected track to be a real track of my dossier, so that the Kiro spec never cites a track that does not exist.

#### Acceptance Criteria

1. WHEN any sequence of Triage_Operations is applied to a Sentinel_Dossier through the Triage_Engine, THE Triage_Engine SHALL keep every id in the Selected_Todo_Set inside the Todo_Id_Set.
2. WHEN the Triage_Engine is created from a Sentinel_Dossier, THE Triage_Engine SHALL start with a Selected_Todo_Set equal to the Todo_Id_Set.

### Requirement 9: Failing properties are findings

**User Story:** As a maintainer, I want a failing property treated as a real defect, so that the suite exposes bugs instead of hiding them.

#### Acceptance Criteria

1. IF a Property_Run fails, THEN THE PBT_Suite SHALL report the minimal counterexample that fast-check produces, including its seed and path.
2. WHEN a Property_Run fails, THE Spec SHALL require the design phase and the tasks phase to include a task that fixes the underlying invariant defect in the same session, so the fix is not deferred.
3. WHEN a Property_Run fails, THE Spec SHALL require the final result to record the invariant name, the counterexample, and the fix that resolved it.
4. WHEN all Property_Runs pass on the first execution, THE Spec SHALL require the final result to state that no Finding was produced, so the absence of a defect is recorded explicitly.

## Known Gaps To Resolve In Design

- `src/gardenos/main.ts` contains a second toggle path (`toggleTodoInKiro`) and a `selectTodo(idx)` path that writes `activeTodoIndex` directly. Both are inside DOM-bound code and are not exported. Requirements 7 and 8 cover only the Triage_Engine in `story.ts`. The design phase must decide whether to cover the `main.ts` paths, for example by extracting a pure helper, and must not change `src/` without a separate approval.
- Sentinel_Dossier has two tracks, so Requirement 7 exercises only a small id space. The design phase may add a generated-dossier variant if it can build one without fabricating data.
