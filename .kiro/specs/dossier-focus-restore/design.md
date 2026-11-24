# Dossier Focus Restore Bugfix Design

## Overview

`renderEvidence` in `src/gardenos/main.ts` rebuilds the dossier evidence grid with `grid.replaceChildren(cardA, cardB)`. That call removes every control in the grid, including the one that had focus. The function already restores focus when it receives a track index. `selectTodo` passes the index, so track-selection buttons keep focus. `toggleTodoInKiro` passes no index, so the "+ Include in Kiro Spec" toggle loses focus.

The fix gives the Kiro toggle a focus target that `renderEvidence` can resolve after the re-render. The change adds one pure helper module, one attribute on the Kiro toggle, and one argument in `toggleTodoInKiro`. No rendering, data, or export logic changes.

The fix changes three source files: `src/gardenos/focus-target.ts` (new), `src/gardenos/main.ts`, and a new test file `tests/dossier-focus.test.ts`. The brief names `tests/` as the test location. No other spec and no other source file changes.

## Glossary

- **Focus target**: The value that identifies which grid control `renderEvidence` should focus after rendering. It is either a track index (`number`) or the literal `'kiro'`.
- **Track button**: A `.dosTrackBtn` element with `data-track-idx="N"`, created for each marker when there is more than one marker.
- **Kiro toggle**: The `.dosTrackBtn` element created for the active marker, labeled "+ Include in Kiro Spec" or "✓ Included in Kiro Spec". It has no index today.
- **Focus selector**: A CSS selector string that finds the control to focus inside the grid.
- **Hypothesis (unconfirmed)**: A label for an inferred cause that the code does not show directly. The bug report did not confirm the exact browser focus behavior, so the exact focus fallback is treated this way.

## Bug Details

### Bug Condition

The bug triggers when the user activates the Kiro toggle. The grid re-renders and no focus target is passed.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type DossierInteraction
         (fields: kind ∈ {'track-select', 'kiro-toggle', 'refresh'}, focusedBefore: Element)
  OUTPUT: boolean

  RETURN input.kind = 'kiro-toggle'
         AND input.focusedBefore is inside the grid (#dosGrid)
END FUNCTION
```

### Examples

- Keyboard user tabs to the "+ Include in Kiro Spec" toggle and presses Enter. Today the button is replaced and focus moves to `body`. Expected: focus stays on the toggle, now labeled "✓ Included in Kiro Spec".
- Keyboard user tabs to a marker track button, presses Enter, and focus stays on that track button. This already works. Expected: unchanged.
- Opening the dossier, switching language, or a story update re-renders the grid with no interaction. Focus is not moved today and must not be moved after the fix.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Track-selection buttons keep focus after activation, using `data-track-idx` and `preventScroll: true`.
- `selectTodo` still sets `activeTodoIndex`, updates the island, and re-renders with the clicked index.
- `toggleTodoInKiro` still flips the id in `selectedTodoIds`, updates the island, and re-renders the grid.
- The re-render calls in `refreshDossierDom`, the mount path, and the story-update path still pass no focus target, so they still do not move focus.
- Tab and Shift+Tab cycling in the dialog (the keydown handler near `main.ts` lines 917-928) is not touched.
- Escape handling and the topmost-layer rule are not touched.
- The Kiro export, the CRT readout, and the `selectedTodoIds` semantics are not touched.

**Scope:**
Every interaction that does not activate the Kiro toggle is unaffected. This includes track selection, which already works, and all non-click re-renders.

## Hypothesized Root Cause

1. **Replaced node**: `grid.replaceChildren(...)` removes the focused element. Focus then goes to `body`.
   - Observed: `renderEvidence` ends with `replaceChildren`, and the focus restore runs only when `focusTrackIdx !== undefined`.
   - Hypothesis (unconfirmed): Browsers move focus to `body` when the focused element is removed. This matches the reported symptom but was not checked in a browser, because the repo has no DOM test environment.

2. **Missing focus argument**: `toggleTodoInKiro` calls `renderEvidence` without a focus argument.
   - Observed: `toggleTodoInKiro` passes five arguments. `selectTodo` passes six.

3. **No identifying attribute**: The Kiro toggle has no `data-track-idx` and no other attribute that a selector could find.
   - Observed: `kiroBtn` sets `type`, `aria-pressed`, and `onclick`, and nothing else.

## Correctness Properties

Property 1: Bug Condition - Kiro Toggle Keeps Focus

_For any_ activation of the Kiro toggle, the fixed `toggleTodoInKiro` SHALL call `renderEvidence` with focus target `'kiro'`, and after the re-render `renderEvidence` SHALL focus the element matched by `focusSelectorFor('kiro')`, which is the new Kiro toggle.

**Validates: Requirements 2.1**

Property 2: Preservation - Track Focus and Non-Activation Renders

_For any_ track-selection activation, the fixed `selectTodo` SHALL pass the clicked index as the focus target and focus `.dosTrackBtn[data-track-idx="N"]`, exactly as before. _For any_ render without an activation, `renderEvidence` SHALL receive no focus target and SHALL NOT move focus.

**Validates: Requirements 2.2, 3.1, 3.2, 3.5**

## Fix Implementation

### Approach

A discriminated target parameter, `focusTarget?: number | 'kiro'`, replaces the current `focusTrackIdx?: number`. A pure helper turns the target into a selector.

Alternatives considered:
- **Boolean flag `focusKiro`**: Simpler call site, but `renderEvidence` would have two unrelated focus parameters. It also needs a second branch for the same idea. Rejected.
- **Query the Kiro toggle in `toggleTodoInKiro` after rendering**: This moves the focus logic out of `renderEvidence`, which already owns focus restoration. It also duplicates the selector. Rejected.
- **Pure helper module**: `main.ts` cannot be imported under node, because it imports `three/webgpu` and runs `init()` at load time. A small module with no DOM or three.js imports can be tested directly. This is the chosen approach.

### Changes Required

**File**: `src/gardenos/focus-target.ts` (new)

```ts
export type DossierFocusTarget = number | 'kiro';

export function focusSelectorFor(target: DossierFocusTarget): string {
  return typeof target === 'number'
    ? `.dosTrackBtn[data-track-idx="${target}"]`
    : '[data-kiro-toggle]';
}
```

The module exports no runtime state and imports nothing. `main.ts` imports the type and the function.

**File**: `src/gardenos/main.ts`

1. **Import**: Add `import { focusSelectorFor, type DossierFocusTarget } from './focus-target.ts';` next to the existing `./login.ts` and `./hologram.ts` imports.
2. **`renderEvidence` signature**: Replace the parameter `focusTrackIdx?: number` with `focusTarget?: DossierFocusTarget`.
3. **Kiro toggle marker**: In the block that builds `kiroBtn`, add `kiroBtn.setAttribute('data-kiro-toggle', '');`. The attribute is a marker only and carries no value. It does not change the button's look or its `aria-pressed` state.
4. **Focus restore**: Replace the current `if (focusTrackIdx !== undefined)` block with:
   ```ts
   if (focusTarget !== undefined) {
     grid.querySelector<HTMLButtonElement>(focusSelectorFor(focusTarget))?.focus({ preventScroll: true });
   }
   ```
   The `preventScroll` option is kept from the existing track path. The Kiro toggle sits in the same scroll area as the track buttons, so the same option applies.
5. **`selectTodo`**: Keep the call as it is, which passes `idx`. Only the parameter name changes.
6. **`toggleTodoInKiro`**: Add `'kiro'` as the sixth argument to `renderEvidence`:
   `renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro, 'kiro');`
7. **Other call sites**: `refreshDossierDom`, the `renderEvidence` call in the language-refresh path, and the story-update path stay unchanged, so they pass no focus target.

**File**: `tests/dossier-focus.test.ts` (new)

See Testing Strategy.

## Testing Strategy

### Validation Approach

Two phases. First, add the new tests and run them on the unfixed code. The tests that check the new module fail because the module does not exist yet, and the source-text checks fail because the attribute and the `'kiro'` argument are missing. Second, apply the fix and show that the tests pass and the preservation checks still hold.

Run `npm test` (`node --experimental-strip-types --test tests/*.test.ts`) and `npx tsc --noEmit`. Do not start a dev server.

### Exploratory Bug Condition Checking

**Goal**: Confirm that the Kiro toggle has no focus target and no identifying attribute before the fix.

**Test cases:**
1. `main.ts` source contains `toggleTodoInKiro` calling `renderEvidence` with `'kiro'` as the sixth argument. Expected failure on unfixed code: the call has five arguments.
2. `main.ts` source sets `data-kiro-toggle` on the Kiro button. Expected failure: the attribute is absent.
3. `focusSelectorFor('kiro')` returns `[data-kiro-toggle]`. Expected failure: the module does not exist yet.

**Expected counterexamples**: The toggle call has five arguments, the Kiro button has no identifier, and no focus helper exists.

### Fix Checking

**Pseudocode:**
```
FOR ALL activation WHERE activation = kiro-toggle DO
  render := renderEvidence(grid, d, story, selectTodo, toggleTodoInKiro, 'kiro')
  ASSERT focusSelectorFor('kiro') = '[data-kiro-toggle]'
  ASSERT the grid contains exactly one element matching '[data-kiro-toggle]' after render
  ASSERT that element receives focus
END FOR
```

The DOM focus call cannot run under node, so the test checks the selector string and the call sites in source. The focus behavior itself is a manual browser check, listed in the Testing Strategy.

### Preservation Checking

**Test cases:**
1. `focusSelectorFor(2)` returns `.dosTrackBtn[data-track-idx="2"]`, which matches the attribute set on track buttons. Check that `main.ts` still sets `b.dataset.trackIdx = String(i)` and class `dosTrackBtn`.
2. `selectTodo` still passes `idx` as the sixth argument of `renderEvidence`.
3. `refreshDossierDom`, the mount path, and the story-update path still call `renderEvidence` with five arguments.
4. The Tab and Shift+Tab handler and the Escape handler are unchanged. Check by asserting the existing `controls` list line (`modal.querySelectorAll<HTMLElement>('button,input,textarea')`) still appears in `main.ts`.

### Unit Tests

- `focusSelectorFor` for a number and for `'kiro'`.
- `focusSelectorFor` output matches the attributes emitted in `main.ts`.
- Source checks for the Kiro toggle attribute, the `'kiro'` argument in `toggleTodoInKiro`, and the unchanged five-argument refresh calls.

### Property-Based Tests

Not added. The input domain is one toggle and the track indices, and the unit tests above cover it.

### Manual Check

Recommended, not run by the agent: in the dev server, open the dossier, tab to "+ Include in Kiro Spec", press Enter, and confirm that focus stays on the same button with the new label.
