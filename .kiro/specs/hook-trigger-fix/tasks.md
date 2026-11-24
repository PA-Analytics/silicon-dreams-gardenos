# Implementation Plan

## Overview

Fix the wrong hook trigger name and the Windows-unsafe save matcher in the repo hook file, the Revival Pack export, and the regression test. Update the README mention. No other behavior changes. Do not commit to git.

## Tasks

- [ ] 1. Fix the repo hook file
  - [x] 1.1 Change the first hook trigger in `.kiro/hooks/gardenos-regression.json` from `PostTaskExecution` to `PostTaskExec`
  - [x] 1.2 Change the second hook matcher to `src[\\\\/]gardenos[\\\\/].*\\.ts$` so it accepts forward-slash and backslash paths
  - _Requirements: 2.1, 2.3, 3.1_

- [ ] 2. Fix the Revival Pack hook export
  - [x] 2.1 Change `trigger` in `formatKiroHookJson` in `src/gardenos/kiro-export.ts` from `PostTaskExecution` to `PostTaskExec`, leaving `enabled: false` and all other fields unchanged
  - _Requirements: 2.2, 3.2_

- [ ] 3. Update the regression tests in `tests/story-ingest.test.ts`
  - [x] 3.1 Change the exported hook trigger assertion to `'PostTaskExec'` and assert the exported JSON does not contain `PostTaskExecution`
  - [x] 3.2 Assert `repoHook.hooks[0].trigger` equals `'PostTaskExec'` exactly
  - [x] 3.3 Assert every repo hook trigger is in the canonical v1 trigger list
  - [x] 3.4 Assert the second hook matcher matches `c:\disco\silicon-dreams-v12\src\gardenos\presets.ts` and `src/gardenos/presets.ts`, and does not match `src\explore.ts`
  - _Requirements: 2.4, 3.3, 3.4, 3.5_

- [ ] 4. Update the README hook description
  - [x] 4.1 Change the `PostTaskExecution` mention in `README.md` line 61 to `PostTaskExec`
  - _Requirements: 2.1_

- [ ] 5. Verify the fix
  - [x] 5.1 Run `npm test` and confirm all tests pass
  - [x] 5.2 Run `npx tsc --noEmit` and confirm it exits with no errors
  - _Requirements: 3.5_

## Notes

- Mark a task `[-]` before starting it and `[x]` after it completes, as the user authorized.
- Historical files under `.kiro/specs/revival-dossier/` are not edited.
- Tasks 1 to 4 can run in any order. Task 5 runs last.
