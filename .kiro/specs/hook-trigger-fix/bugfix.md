# Bugfix Requirements Document

## Introduction

Kiro agent hooks never fire for this project. The repo hook file `.kiro/hooks/gardenos-regression.json` uses the trigger name `PostTaskExecution`, which the Kiro CLI does not recognize. At session start, the CLI log at `C:\Users\cerez\.kiro\logs\` reports `[hooks] Hook trigger is not a recognized name` for that hook. The canonical v1 trigger name is `PostTaskExec`.

The same wrong name is written into the Kiro Revival Pack that the app exports (`src/gardenos/kiro-export.ts`), so every exported hook also fails to register. The regression test in `tests/story-ingest.test.ts` asserts the wrong name, so the suite passes while the hook stays broken.

The file-save hook has a second problem. Its matcher `src/gardenos/.*\.ts$` uses forward slashes only. On Windows, the saved file path uses backslashes, so the matcher may never match and the typecheck hook does not run.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN Kiro loads `.kiro/hooks/gardenos-regression.json` with the first hook trigger set to `PostTaskExecution` THEN the system logs `Hook trigger is not a recognized name` and never runs `npm test` after a spec task completes.

1.2 WHEN the app exports a Kiro Revival Pack for a project THEN the generated hook JSON sets the trigger to `PostTaskExecution`, so the exported hook never registers.

1.3 WHEN a file under `src/gardenos/` is saved on Windows with a backslash-separated path such as `c:\disco\silicon-dreams-v12\src\gardenos\presets.ts` THEN the file-save hook matcher `src/gardenos/.*\.ts$` does not match and `npx tsc --noEmit` does not run.

1.4 WHEN `npm test` runs THEN the regression test asserts the trigger `PostTaskExecution`, so the wrong trigger name passes the suite and the defect goes undetected.

### Expected Behavior (Correct)

2.1 WHEN Kiro loads `.kiro/hooks/gardenos-regression.json` THEN the system SHALL register the first hook with the trigger `PostTaskExec` so that `npm test` runs after a spec task completes.

2.2 WHEN the app exports a Kiro Revival Pack for a project THEN the system SHALL generate a hook JSON whose trigger is `PostTaskExec` and whose `enabled` value is `false`.

2.3 WHEN a file under `src/gardenos/` with a `.ts` extension is saved and its path uses either forward-slash or backslash separators THEN the system SHALL match the file-save hook and run `npx tsc --noEmit`.

2.4 WHEN `npm test` runs THEN the system SHALL assert that the first repo hook trigger is exactly `PostTaskExec` and that every trigger in the repo hook file is a canonical v1 trigger name.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the repo hook file is loaded THEN the system SHALL CONTINUE TO use the trigger `PostFileSave` for the typecheck hook and the command `npx tsc --noEmit` for that hook.

3.2 WHEN the app exports a Kiro Revival Pack THEN the system SHALL CONTINUE TO emit `version: "v1"`, the `hooks[]` array, the same hook name, description, and action logic, and `enabled: false`.

3.3 WHEN a file outside `src/gardenos/`, such as `src/explore.ts` or `src/shaders/noise.ts`, is saved THEN the system SHALL CONTINUE TO leave the typecheck hook unmatched.

3.4 WHEN the file-save matcher is tested against a path with a `.tsx`, `.js`, or `.ts` file outside `src/gardenos/` THEN the system SHALL CONTINUE TO leave it unmatched.

3.5 WHEN the existing preset, ingest, repo-graph, and export assertions in `tests/story-ingest.test.ts` run THEN the system SHALL CONTINUE TO pass them with unchanged results.
