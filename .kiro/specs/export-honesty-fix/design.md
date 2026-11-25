# Design: Export honesty fix

## Redaction

`redactSecrets(text)` runs before any untrusted text reaches the output. It applies three rules in order:

1. Sensitive key-value pairs. A key matching `token|secret|password|passwd|pwd|api[_-]?key|auth|credential|private[_-]?key|access[_-]?key|bearer` keeps its name and separator. Only its value is replaced. This covers `KEY=value`, `"key": "value"`, and `key: value`.
2. Prefixed tokens: `gh[pousr]_…`, `github_pat_…`, `sk-…`, `AKIA[0-9A-Z]{16}`, `xox[abprs]-…`, `AIza…`, and `Bearer <token>`. The keyword `Bearer` stays visible.
3. Standalone tokens of 16 or more characters from `[A-Za-z0-9_+=]` that contain at least one letter and one digit. Hyphens and slashes are excluded, so paths such as `modulo-04-scanner/port_scanner.py` and slugs such as `sentinel-tape-timeout` are not redacted.

Replacement text is always the literal `<redacted>`.

Escaping order: `plain()` and `literal()` redact first and then escape. Redaction emits a private-use marker (`\uE000`/`\uE001`). Escaping cannot touch the markers, and the markers become `<redacted>` at the end. This keeps `<redacted>` readable in Markdown output, and it keeps the escape step from turning it into `&lt;redacted&gt;`.

Commit hashes are rendered with a literal that skips the generic rule. Git hashes are 40 hex characters and would otherwise be redacted. Commit messages still pass through `plain()`.

The hook JSON name and command also pass through redaction. If the test command changes under redaction, the hook falls back to the manual prompt and does not emit the command.

## Labels and attribution

- `creatorLabel(d)` returns the parenthetical author name only when `visitorName.trim()` is non-empty and is not `Visitor`. Otherwise it returns an empty string. Headings and blockquotes use `Creator note:` or `Creator note (<name>):`.
- `hypothesisLabel(text)` adds `Hypothesis (unconfirmed): ` unless the text already starts with that label.

## Config and command phrasing

- `isConfigPath(path)` matches `.json`, `.ya?ml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.xml`, `.properties`, and `.env*` files.
- Code tracks keep the `WHEN the code at … is exercised` form. Config tracks use `WHEN the configuration at … is revisited, THE <project> SHALL review the marker text …`, and the excerpt is quoted as text.
- Declared commands are written as `Declared in manifest (unverified): …`. They are never SHALL clauses.

## Synthetic track

When there are no real tracks, the STUB track derived from `tapeClue` is only an example. Tasks show `Hypothesis (unconfirmed) example:` with the location. Requirements omit it, and use the existing `component at … is reopened` branch, labeled as a hypothesis.

## Creator note

Removing the creator note task line from `formatKiroTasksMd`. The note stays in the Creator Note section and in the requirements blockquote.
