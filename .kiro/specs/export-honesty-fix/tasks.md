# Implementation Plan

Scope: `src/gardenos/kiro-export.ts` and `tests/export-honesty.test.ts`. Do not commit to git.

- [x] 1. Write defect tests before the fix (fail-first)
  - Create `tests/export-honesty.test.ts`. One test per defect C1 to C6, plus the steering check for labeled hypotheses.
  - C1 property test with fast-check: for generated secrets placed in excerpts, commands, env hints, notes, commit messages, observed facts, and code context, the exported spec does not contain the raw secret.
  - Run `npm test`. The defect tests must fail on the unfixed code.
  - _Requirements: C1-C6_

- [x] 2. Fix the exporter
  - [x] 2.1 Add `redactSecrets` and route every untrusted string through it (`plain`, `literal`, context snippet, hook name and command, commit hash literal).
  - [x] 2.2 Fix the creator note label and attribution (E2).
  - [x] 2.3 Use config-file phrasing for config tracks and quote excerpts as text (E3).
  - [x] 2.4 Label declared commands as unverified in requirements, tasks, and observations (E4).
  - [x] 2.5 Label the synthetic STUB track as a hypothesis example (E5).
  - [x] 2.6 Remove the creator note task (E6).

- [x] 3. Verify
  - Run `npm test`, which passes (115 tests).
  - Run `npx tsc --noEmit`, which exits cleanly.
  - Check that no `C:\` path and no Base64 appear in the generated pack for the three presets.
