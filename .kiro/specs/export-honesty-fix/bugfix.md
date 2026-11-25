# Bugfix: Export honesty in the Kiro Revival Pack

Source: revival-auditor review of `src/gardenos/kiro-export.ts`.
Scope: `src/gardenos/kiro-export.ts`, plus new tests in `tests/export-honesty.test.ts`.
Do not commit to git. Do not touch `node_modules`, `dist`, or `.vercel`.

## Defects

1. BLOCKER: secret leakage. Raw values reach the exported pack without redaction: config excerpts (tracks), environment hint values, and declared run and test commands. A pack could carry API keys or tokens from a user's env files.
2. MAJOR: the creator note attribution reads `Creator note (<visitorName>): <note>`. When no author was entered, the placeholder `Visitor` appears, and the output reads confusingly.
3. MAJOR: config files (JSON, YAML, TOML, env) become code-behavior criteria, for example `WHEN the code at config.json:3 is exercised, THE SYSTEM SHALL resolve <raw excerpt>`. The excerpt is data in a config file, not behavior.
4. MAJOR: declared run and test commands become SHALL acceptance criteria. Nothing verified them.
5. MINOR: when no real TODO exists, the synthetic STUB track built from `tapeClue` renders as an inspect-and-resolve task, which reads as a finding.
6. MINOR: the creator note becomes a task (`Cross-check creator note: <visitor text>`).

## Bug condition

- C1: an exported string contains a secret-like value (a `key=value` pair with a sensitive key, a prefixed token such as `ghp_`, `sk-`, `AKIA`, `github_pat_`, `Bearer <token>`, or a standalone 16+ character letter-and-digit token).
- C2: the note label uses a visitor placeholder or the visitor name as a parenthetical.
- C3: a track in a config file (`.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env*`, and similar) renders as `WHEN the code at ... is exercised`.
- C4: a declared command renders as a SHALL requirement.
- C5: a synthetic STUB track renders as an `Inspect ... and resolve ...` task.
- C6: a creator note line appears in the tasks list.

## Expected behavior

- E1: each secret-like value is replaced by `<redacted>`, and the key name stays visible. No exported output contains the raw secret, in any position.
- E2: the label is `Creator note:`. The parenthetical with the author name appears only when a real author name exists (non-empty, and not the `Visitor` placeholder).
- E3: config tracks use `WHEN the configuration at <path:line> is revisited, THE <project name> SHALL ...`, and the excerpt is quoted as text.
- E4: declared commands are labeled `Declared in manifest (unverified)` and are not SHALL requirements.
- E5: the synthetic STUB track is labeled `Hypothesis (unconfirmed)` as an example. It is not an inspect-and-resolve task.
- E6: the tasks list never contains creator note text.

## Preserved behavior

- Observed, Hypothesis (unconfirmed), and Creator Note stay in separate sections.
- Hypothesis lines carry the `Hypothesis (unconfirmed)` label. A text that already starts with that label is not labeled twice.
- No `C:\` absolute paths and no Base64 in exported content.
- The hook uses the v1 schema and stays `enabled: false`.
- Git commit hashes keep their observed form. They are not redacted by the generic token rule.
- Existing tests in `tests/story-ingest.test.ts` and `tests/github-token-input.test.ts` keep passing.
