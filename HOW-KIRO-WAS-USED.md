# How Kiro was used — Silicon Dreams V1.2

Silicon Dreams is a browser experience, but every line of its delivery pipeline ran inside Kiro. Here is exactly how, with evidence you can verify in the public repo.

## Surfaces used

**Kiro CLI V3** was the primary surface: twelve metered development sessions covering spec-driven bugfixes, a full feature spec→implementation cycle, property-based testing, a custom-agent audit, and validation of the product's own exported artifacts. Every session was recorded in stream-json; credit consumption was tracked per session (total: ~17 credits).

**Steering** (`.kiro/steering/silicon-dreams-v12.md`) — epistemic honesty rules (strict separation of *Observed* / *Hypothesis (unconfirmed)* / *Creator Note*), a fixed lighting rig, and persistence honesty. Kiro injected the steering file automatically at every session start, and we watched it self-correct outputs to comply — e.g. adding the required `Hypothesis (unconfirmed)` prefix to interpretation clues without being asked twice.

**Agent Hooks** (`.kiro/hooks/gardenos-regression.json`) — typecheck on save (`PostFileSave`) and the full regression suite on spec-task completion (`PostTaskExec`). Both verified firing in real sessions: 16 typecheck completions and 7 regression-suite completions in a single feature-implementation session, recorded as `hook_update` events in the session transcripts.

**Custom Agent** (`.kiro/agents/revival-auditor.json`) — a read-only auditor that reviews the export pipeline for epistemic-honesty violations. Its run produced ten precise findings with exact line numbers.

**Property-Based Testing** — fast-check properties over persistence invariants (`sd_memory_v1:<id>` round-trips, invalid-record rejection, honest failure reporting) and triage selection.

## The best story: Kiro debugged its own configuration

Our regression hooks had silently never fired. During a session, Kiro's own logs revealed why: `PostTaskExecution` is not a recognized trigger in CLI V3 — the canonical name is `PostTaskExec` — and the file matcher didn't tolerate Windows path separators. A Kiro spec session wrote the bugfix spec in EARS format, then implemented the fix both in the repo hook *and* in the product's exported Revival Pack template — so Silicon Dreams users don't export broken hooks. The very next sessions showed both hooks firing to completion. Evidence: commit `5fb99ad` plus `hook_update` events in the transcripts.

## Spec-driven development, for real

Six specs, each committed separately from its implementation so the spec→task→diff attribution chain is visible in git history:

- **preset-honesty-fix** — the CRT intro led with a preset containing false `STUB` labels. The spec's exploration tests *fail on the unfixed code*; preservation tests pin correct behavior.
- **hook-trigger-fix** — the trigger root-cause fix above.
- **dossier-focus-restore** — keyboard focus loss in the dossier modal.
- **github-token-input** — a full feature spec (EARS requirements, mermaid architecture, security constraints verified against source line numbers) implemented across 47 new tests: the token never touches storage, exports, or error messages.
- **pbt-persistence-invariants** — see below.
- **export-honesty-fix** — the auditor's findings, closed loop.

## What PBT caught that unit tests missed

Property 2 — "`saveProjectMemory` never reports ok:true after a storage throw" — **failed after just 6 generated tests** (seed `-1770722359`, counterexample shrunk 4×). The catch block that formats the storage error could itself re-throw when the error's `name`/`message` were Symbols or throwing getters — violating the very honest-failure contract it was supposed to report. No unit test had ever exercised a storage error that hostile. Kiro fixed it with a non-throwing `describeStorageError` and pinned it with regression tests. The failing output is preserved in the session transcript.

## The custom agent closed the loop

The revival-auditor's top finding was a **blocker**: exported Revival Packs could leak secrets — raw env hints and config excerpts were exported unredacted. That audit report became the input to the `export-honesty-fix` spec session, which implemented redaction with fast-check property coverage (for any generated secret-like string in any position, exported output never contains the raw secret), fixed config files being rendered as code-behavior criteria, labeled unverified commands, and stopped the exported hooks from embedding redacted commands. In a fitting epilogue, GitHub's own push protection then blocked the commit because the *test fixtures* looked like real Stripe keys — the fixtures now construct their fake secrets dynamically.

## The product validates itself in Kiro

Silicon Dreams exports "Kiro Revival Packs" — spec kits for your abandoned projects. We didn't just ship that export: we loaded an exported pack into a real Kiro session and confirmed the hooks register without warnings and the spec files are discovered. The formatting issues that session surfaced were fed back into the product backlog — and fixed in the export-honesty cycle above.

## Credit discipline

All sessions used claude-haiku-5.5 with tight, pre-answered prompts to avoid clarification overhead. Total development spend: ~17 credits, metered per session via stream-json usage events.
