# Implementation Plan

## Overview

Scope: `src/gardenos/focus-target.ts` (new), `src/gardenos/main.ts`, and `tests/dossier-focus.test.ts` (new). Do not change other specs, other source files, or other tests.

## Tasks

- [x] 1. Write bug condition exploration tests (before the fix)
  - **Property 1: Bug Condition** - Kiro Toggle Keeps Focus
  - **CRITICAL**: These tests MUST FAIL on the unfixed code. A failure confirms the bug.
  - **DO NOT** change `main.ts` or the test expectations to make these pass at this stage.
  - Create `tests/dossier-focus.test.ts` using `node:test`, `node:assert/strict`, and `readFileSync` with `new URL('../src/gardenos/main.ts', import.meta.url)`, following `tests/story-ingest.test.ts`.
  - Add a source-text test asserting that the `toggleTodoInKiro` body calls `renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro, 'kiro')`.
  - Add a source-text test asserting that `main.ts` sets the `data-kiro-toggle` attribute on the Kiro button.
  - Add a test that imports `focusSelectorFor` from `../src/gardenos/focus-target.ts` and asserts `focusSelectorFor('kiro') === '[data-kiro-toggle]'`.
  - Run `npm test`.
  - **EXPECTED OUTCOME**: The three tests fail. The source checks fail because the sixth argument and the attribute are missing. The import test fails because the module does not exist.
  - Record the counterexamples in the task notes.
  - _Requirements: 1.1, 2.1_

- [x] 2. Write preservation tests (before the fix)
  - **Property 2: Preservation** - Track Focus and Non-Activation Renders
  - **IMPORTANT**: Observe the unfixed output first, then assert it.
  - Add to `tests/dossier-focus.test.ts` the following assertions. Each must PASS on the unfixed code, except where noted.
    - `main.ts` still sets `b.dataset.trackIdx = String(i)` and the `dosTrackBtn` class on track buttons.
    - `selectTodo` still passes `idx` as the sixth argument to `renderEvidence`.
    - The `renderEvidence` calls in `refreshDossierDom` and in the mount path (`renderEvidence(byId('dosGrid'), d, story, selectTodo, toggleTodoInKiro);` and `renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro);` outside the toggle) still pass five arguments.
    - `main.ts` still contains the Tab handler's `button,input,textarea` selector string.
    - `focus-target.ts` does not exist yet. The test that checks `focusSelectorFor(2) === '.dosTrackBtn[data-track-idx="2"]'` FAILS on the unfixed code. It is the only expected failure in this task.
  - Run `npm test`.
  - **EXPECTED OUTCOME**: All source-text preservation assertions pass on the unfixed code. The `focusSelectorFor(2)` test fails because the module does not exist. Record this.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix the Kiro toggle focus restoration

  - [x] 3.1 Create the pure focus helper module
    - Create `src/gardenos/focus-target.ts` with `export type DossierFocusTarget = number | 'kiro';` and `export function focusSelectorFor(target: DossierFocusTarget): string`.
    - A number returns `` `.dosTrackBtn[data-track-idx="${target}"]` ``. `'kiro'` returns `'[data-kiro-toggle]'`.
    - The module imports nothing.
    - _Bug_Condition: isBugCondition(kiro-toggle activation with focus in grid)_
    - _Expected_Behavior: focusSelectorFor('kiro') resolves the Kiro toggle (design Property 1)_
    - _Requirements: 2.1_

  - [x] 3.2 Update renderEvidence in main.ts
    - Add `import { focusSelectorFor, type DossierFocusTarget } from './focus-target.ts';` next to the other local imports.
    - In `renderEvidence`, replace the parameter `focusTrackIdx?: number` with `focusTarget?: DossierFocusTarget`.
    - On the Kiro button, add `kiroBtn.setAttribute('data-kiro-toggle', '');`.
    - Replace the focus block with `if (focusTarget !== undefined) grid.querySelector<HTMLButtonElement>(focusSelectorFor(focusTarget))?.focus({ preventScroll: true });`.
    - _Preservation: track buttons keep `data-track-idx`, `aria-pressed`, and the existing focus behavior (design Property 2)_
    - _Requirements: 2.1, 2.2, 3.1_

  - [x] 3.3 Pass the focus target from the call sites
    - In `toggleTodoInKiro`, add `'kiro'` as the sixth argument to `renderEvidence`.
    - In `selectTodo`, keep the `idx` argument. Do not change its behavior.
    - Do not change `refreshDossierDom`, the mount path, or the story-update call. They pass no focus target.
    - _Requirements: 2.1, 2.2, 3.2, 3.5_

  - [x] 3.4 Verify the exploration tests now pass
    - **Property 1: Expected Behavior** - Kiro Toggle Keeps Focus
    - Re-run the SAME tests from task 1. Do NOT write new tests.
    - Run `npm test`.
    - **EXPECTED OUTCOME**: All tests from task 1 PASS.
    - _Requirements: 2.1_

  - [x] 3.5 Verify the preservation tests still pass
    - **Property 2: Preservation** - Track Focus and Non-Activation Renders
    - Re-run the SAME assertions from task 2. Do NOT write new assertions.
    - Run `npm test`.
    - **EXPECTED OUTCOME**: All preservation assertions PASS, including the `focusSelectorFor(2)` test that failed before the module existed.
    - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint: final gate
  - Run `npm test`. All test files must pass.
  - Run `npx tsc --noEmit`. It must exit with no errors.
  - If either check fails, report the failing test or diagnostic. Do not claim success.
  - Do not run `git commit`. Do not start a dev server.
  - Report the manual browser check from design.md as not performed.
  - _Requirements: 2.1, 2.2, 3.1_

## Notes

- Do not commit to git.
- The manual browser focus check in design.md is not run by the agent. It is listed for the user.
