# Hook Trigger Fix Bugfix Design

## Overview

Three hook definitions use a trigger or matcher that Kiro does not accept on Windows. The fix changes the trigger name to the canonical v1 value `PostTaskExec`, makes the file-save matcher accept both path separators, and updates the regression test so it checks for the correct values. No other behavior changes.

## Glossary

- **C(X)**: Bug condition. True for a hook definition whose trigger is `PostTaskExecution`, or for a file-save path under `src/gardenos/` with backslash separators that the old matcher does not match.
- **P(result)**: Property. The trigger is `PostTaskExec`, and the matcher matches `src/gardenos/*.ts` under either separator.
- **¬C(X)**: Non-buggy inputs. The `PostFileSave` trigger, `enabled: false`, the hook name, description, and action, and file paths outside `src/gardenos/`.
- **F**: The current hook and export code. **F'**: The code after the fix.

## Bug Details

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type HookOrPath
  OUTPUT: boolean

  IF X IS HookDefinition THEN
    RETURN X.trigger = "PostTaskExecution"
  ELSE
    // X is a path observed by a file-save hook
    RETURN X.path contains "src" + "/" + "gardenos" + "/" AND X.path ends with ".ts"
           AND X.path uses backslash separators
  END IF
END FUNCTION
```

### Affected Components

- `.kiro/hooks/gardenos-regression.json`: first hook trigger and second hook matcher.
- `src/gardenos/kiro-export.ts`: `formatKiroHookJson`, the `trigger` field.
- `tests/story-ingest.test.ts`: assertions that codify the wrong trigger.
- `README.md`, line 61: documentation of the trigger names.

## Expected Behavior

For buggy inputs, the hook uses `PostTaskExec` and the save matcher matches both path styles. For non-buggy inputs, behavior stays identical to the current code.

## Correctness Properties

### Property 1: Fix Checking

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

For every hook definition or path where the bug condition holds, the fixed code returns the expected result.

```pascal
// Property: Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  IF X IS HookDefinition THEN
    result ← F'(X)
    ASSERT result.trigger = "PostTaskExec"
  ELSE
    result ← F'_matcher(X)
    ASSERT result.matched = true
  END IF
END FOR
```

### Property 2: Preservation Checking

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

For every input where the bug condition does not hold, the fixed code returns the same result as the original code.

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

Non-buggy inputs keep their current results. This covers the `PostFileSave` trigger, the `npx tsc --noEmit` command, `enabled: false`, the export's name and description branches, and file paths outside `src/gardenos/`.

## Hypothesized Root Cause

1. `.kiro/hooks/gardenos-regression.json` and `src/gardenos/kiro-export.ts` both use `PostTaskExecution`. The canonical name is `PostTaskExec`. The Kiro CLI logs the unrecognized name and does not register the hook. This is the confirmed cause from the CLI log.
2. The matcher `src/gardenos/.*\.ts$` in `.kiro/hooks/gardenos-regression.json` contains a literal `/`. Windows paths use `\`, so the match may fail. This is a likely cause for the save hook and is treated as a defect to fix.
3. `tests/story-ingest.test.ts` line 145 asserts `PostTaskExecution`, and the repo-hook check at the end of the same test asserts only the command of the second hook. Neither checks a canonical name or the matcher, so the defect passed the suite.

## Fix Implementation

### Change 1: Repo hook file

File: `.kiro/hooks/gardenos-regression.json`

- First hook `trigger`: `"PostTaskExecution"` becomes `"PostTaskExec"`.
- Second hook `matcher`: `"src/gardenos/.*\\.ts$"` becomes `"src[\\\\/]gardenos[\\\\/].*\\.ts$"` in the JSON file. The decoded regex is `src[\\/]gardenos[\\/].*\.ts$`, which accepts `/` or `\` at each separator position. The `.*` and `\.ts$` parts are unchanged, so the matched set stays the `.ts` files under `src/gardenos/`.

### Change 2: Export template

File: `src/gardenos/kiro-export.ts`, function `formatKiroHookJson`, line 76.

- `trigger: 'PostTaskExecution'` becomes `trigger: 'PostTaskExec'`.
- `enabled: false`, `version: 'v1'`, the name and description branches, and the action branches are unchanged. The test command still reaches the hook only through `JSON.stringify`, as before.

### Change 3: Regression test

File: `tests/story-ingest.test.ts`

- Line 145, inside the Kiro export test: the expected value becomes `'PostTaskExec'`.
- In the test that reads `.kiro/hooks/gardenos-regression.json`, add these assertions:
  - `repoHook.hooks[0].trigger` equals `'PostTaskExec'` exactly.
  - Every `trigger` in `repoHook.hooks` is in the canonical v1 list: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SessionStart`, `Stop`, `SubagentStop`, `UserPromptSubmit`, `PreTaskExec`, `PostTaskExec`, `PreCompact`, `PostCompact`, `PostFileCreate`, `PostFileSave`, `PostFileDelete`.
  - `repoHook.hooks[1].matcher` matches `c:\disco\silicon-dreams-v12\src\gardenos\presets.ts` and `src/gardenos/presets.ts`, and does not match `src\explore.ts`.
  - The export test asserts that the exported hook JSON does not contain `PostTaskExecution`, so the old name cannot return unnoticed.

### Change 4: Documentation

File: `README.md`, line 61. The `PostTaskExecution` mention becomes `PostTaskExec`. Historical spec files under `.kiro/specs/revival-dossier/` stay as written, because they record past task status.

## Testing Strategy

- Run `npm test` before and after the change. The baseline is 33 passing tests.
- Run `npx tsc --noEmit` before and after the change. The baseline is clean.
- The new matcher assertion in `tests/story-ingest.test.ts` checks the regex against both path styles and against a non-GardenOS file.

## Assumptions

- The Kiro matcher uses standard JavaScript-style regex syntax, so the escaped character class works. The CLI log confirms only the trigger name. The matcher change is a fix for Windows paths and is covered by the new test.
- The canonical v1 trigger list in the test comes from the trigger names documented for the hook tool. It is not read from a Kiro runtime file.
