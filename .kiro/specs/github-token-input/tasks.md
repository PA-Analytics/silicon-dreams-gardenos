# Implementation Plan: GitHub Repository Token Input

## Overview

Seven ordered tasks (0 through 6) implement the optional GitHub token field described in requirements.md and design.md. Task 0 records a baseline. Tasks 1 through 5 each change one area and end with a passing gate. Task 6 runs the final gate and a manual checklist.

## Notes

- Repository root: the workspace folder. Run all commands from there.
- Line numbers are approximate, taken from the code at design time. Find each target by the function or element name given in the task.
- Every task ends with the same gate: `npm test` and `npx tsc --noEmit` both exit with code 0. A task is not done until its gate passes.
- Do not start the dev server from a task. The manual checklist in task 6 is for a person to run.
- Do not change files outside the list named in each task.

## Tasks

- [ ] 0. Record the baseline before any edit
  - Run `npm test` and `npx tsc --noEmit` from the repository root before touching any file.
  - Record the number of passing and failing tests and any TypeScript errors in the task result.
  - If a failure already exists, list it and leave it unchanged. Do not fix unrelated failures.
  - Gate: both commands run. This task edits no file, so the gate is the recorded output.
  - _Requirements: 7.4_

- [ ] 1. Add pure failure-message helpers to ingest.ts and create the test file
  - File: `src/gardenos/ingest.ts`. Add these exports after `parseGitHubOwnerRepo` (around line 289), before `ingestGitHubRepo`:
    - `export interface BilingualText { en: string; es: string; }`
    - `export class GitHubHttpError extends Error` with a constructor `(readonly status: number, readonly endpoint: string, readonly rateLimitRemaining: string | null)` that calls `super(\`GitHub HTTP ${status} on ${endpoint}.\`)` and sets `this.name = 'GitHubHttpError'`.
    - `export function describeGitHubFailure(input: { status: number; rateLimitRemaining: string | null; tokenSupplied: boolean }): BilingualText`. Implement the eight-row table in design.md section 1 exactly. Use the English and Spanish sentences given there. For the Spanish text, write UTF-8 accented characters directly, for example "límite" and "dirección". Each branch returns non-empty `en` and `es`. The "other status" branch returns `GitHub HTTP ${status}.` in English and `GitHub HTTP ${status}.` in Spanish.
    - `export function redactToken(text: string, token: string | undefined): string`. Trim the token. If it is empty, return `text` unchanged. Otherwise replace every occurrence with `[token hidden]` using `split(token).join('[token hidden]')`.
  - Do not change `ingestGitHubRepo` in this task.
  - File: `tests/github-token-input.test.ts` (create). Import `test` from `node:test`, `assert` from `node:assert/strict`, and the three helpers from `../src/gardenos/ingest.ts`. Add table-driven tests:
    - For status 403 and 429 with `rateLimitRemaining` `'0'` and `'5'` and `null`: with `tokenSupplied: true`, the English text does not contain "raises" or "Add". With `tokenSupplied: false`, the English text contains "5,000" and "60 per hour".
    - For status 404: no token gives text containing "requires a token"; with a token the text does not contain "requires a token".
    - For status 403 with `rateLimitRemaining` `'5'` and no token: the English text contains "may" and does not contain "reached".
    - For status 403 with `rateLimitRemaining` `'0'` and no token: the English text contains "reached".
    - For status 401 with a token: the English text contains "rejected".
    - For every combination in the tables above, plus status 500 without a token, both `en` and `es` are non-empty and `es !== en`.
    - `redactToken('x github_pat_FIXTURE y github_pat_FIXTURE', 'github_pat_FIXTURE')` equals `'x [token hidden] y [token hidden]'`. Applying it twice gives the same result as once. An empty or undefined token returns the input unchanged.
  - Gate: `npm test` and `npx tsc --noEmit` both exit 0.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.3, 7.1, 7.3_

- [ ] 2. Wire the helpers into ingestGitHubRepo and cover the token rules with stubbed fetch
  - File: `src/gardenos/ingest.ts`, function `ingestGitHubRepo` (around line 311).
    - In the inner `request<T>(endpoint)` function (around lines 337-345), replace the `throw new Error(...)` for `!res.ok` with `throw new GitHubHttpError(res.status, \`/repos/${full}${endpoint}\`, res.headers.get('x-ratelimit-remaining'))`. Keep the message the same as before, because the class builds it.
    - Declare `let rateLimited = false;` and `const partialWarningsEs: string[] = [];` next to the existing `partialWarnings` declaration.
    - In the tree catch handler (around line 355) and the commits catch handler (around line 359): if the error is a `GitHubHttpError`, compute `const note = describeGitHubFailure({ status: e.status, rateLimitRemaining: e.rateLimitRemaining, tokenSupplied: !!token })`. Set `rateLimited = true` when the status is 403 or 429. Push `Tree unavailable. ${note.en}` to `partialWarnings` and `Árbol no disponible. ${note.es}` to `partialWarningsEs`. Use `Commits unavailable.` and `Commits no disponibles.` for the commits handler. For any other error, use `redactToken(message, token)` as the English text and the same string for Spanish.
    - Push matching Spanish strings into `partialWarningsEs` at the other `partialWarnings.push` sites (the truncated-tree warning around line 367, and the README-missing warning inside `fetchReadmeApi`).
    - Build `warnNote` (English) from `partialWarnings` as today. Build `warnNoteEs` from `partialWarningsEs`. In `honestyNoteEs`, use `warnNoteEs` in place of `warnNote`.
    - Fatal `catch (error)` block (around lines 455-461): when `error instanceof GitHubHttpError`, set `rateLimited = rateLimited || status is 403 or 429`, and build `reason = describeGitHubFailure({ status, rateLimitRemaining, tokenSupplied: !!token })`. When `ctrl.signal.aborted`, use the timeout text in English and Spanish (`Timeout reading ${full} (9 s).` and `Tiempo agotado leyendo ${full} (9 s).`). For other errors, use `redactToken(message, token)` in both languages with the text `Could not read ${full}: ...` and `No se pudo leer ${full}: ...`. Call `createExampleDossier(visitorName, reason.en, reason.es)`. Task 3 adds the Spanish parameter, so this call will not compile until task 3. To keep the gate green, pass `reason.en` only in this task, and extend the call in task 3.
    - Change the sessionStorage write (around line 451) from `if (!token)` to `if (!token && !rateLimited)`. Leave the read guard at line 321 (`if (!token)`) unchanged.
  - File: `tests/github-token-input.test.ts`. Add a fake-fetch helper that takes a route table keyed by URL suffix and records every `(url, init)` pair. Add a `sessionStorage` stub that counts `getItem` and `setItem` calls, restored in `t.after`, as `tests/story-ingest.test.ts` does. Add tests:
    - Token `'  github_pat_FIXTURE_ABC  '` on a successful load: every api.github.com call has `Authorization: Bearer github_pat_FIXTURE_ABC`. Every `raw.githubusercontent.com` call has no `headers` option. The stub records zero `getItem` and zero `setItem` calls (Properties 2 and 3).
    - Whitespace-only token `'   '`: no recorded call has an `Authorization` header (Property 2).
    - No token, meta request returns 403 with `x-ratelimit-remaining: 0`: the result's `honestyNote` contains "60 per hour" and "5,000", the sessionStorage `setItem` count is 0, and the result's `origin` is the sentinel fallback with `isDemo === true` (Requirements 3.1, 2.8).
    - Token supplied, meta request returns 403: `honestyNote` does not contain "raises" or "Add" (Requirement 3.4).
    - Token supplied, meta request returns 401: `honestyNote` contains "rejected" (Requirement 3.5).
    - Token supplied, fetch rejects with `new Error('network down github_pat_FIXTURE_ABC')`: the returned `honestyNote` does not contain `github_pat_FIXTURE_ABC` (Requirement 2.7).
    - No token, tree request returns 403, meta and commits succeed: `honestyNote` contains "60 per hour" and `honestyNoteEs` contains "60 por hora" (Requirement 3.7).
    - Successful load with a token: `JSON.stringify(dossier)` and the output of `formatKiroRevivalSpec(dossier, 'restore', '')` do not contain the token value (Property 1, Requirement 2.6). Import `formatKiroRevivalSpec` from `../src/gardenos/kiro-export.ts`.
  - Gate: `npm test` and `npx tsc --noEmit` both exit 0.
  - _Requirements: 2.2, 2.3, 2.6, 2.7, 2.8, 3.1, 3.4, 3.5, 3.7, 7.2, 7.3_

- [ ] 3. Add a Spanish reason parameter to the fallback dossier helpers
  - File: `src/gardenos/ingest.ts`.
    - `createExampleDossier(visitorName: string, fallbackReason?: string, fallbackReasonEs?: string)` passes both values to `createPresetDossier`.
    - `createPresetDossier(presetId, visitorName, fallbackReason?, fallbackReasonEs?)` (around line 575). Keep `partialWarnings` and `fallbackReason` unchanged. In the `honestyNoteEs` expression (around line 604), use `[fallbackReasonEs ?? fallbackReason, honestyNoteEs ?? data.honestyNote]`, filtered for empty values.
    - In `ingestGitHubRepo` fatal catch, change the `createExampleDossier` call to `createExampleDossier(visitorName, reason.en, reason.es)` only if the catch block already builds a bilingual reason from task 2. If it builds a single string, keep the English-only call and add a Spanish value here.
  - File: `tests/github-token-input.test.ts`. Add tests:
    - `createExampleDossier('Ada', 'Reason EN', 'Razón ES').honestyNoteEs` starts with "Razón ES".
    - `createExampleDossier('Ada', 'Reason EN').honestyNoteEs` starts with "Reason EN" (backward compatible).
    - The `honestyNote` of a fallback dossier starts with the English reason.
  - Gate: `npm test` and `npx tsc --noEmit` both exit 0.
  - _Requirements: 4.3, 3.7_

- [ ] 4. Add the token input, clear control, and hint to the Dossier_Modal markup
  - File: `gardenos.html`.
    - Inside `<div class="dosQuickSwitch">` (around line 197), immediately after the `#quickRepoInput` line and before `#btnLoadRepo`, insert:
      ```html
      <input id="quickTokenInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="255" data-lpignore="true" aria-describedby="quickTokenHint" placeholder="GitHub token (optional)" aria-label="Optional GitHub personal access token" />
      <button class="dosBtnSm" id="btnClearToken" type="button">Clear token</button>
      <small id="quickTokenHint" class="dosTokenHint">Optional token. Stays in memory only: never saved to browser storage, the Kiro Revival Pack, or any download. Raises GitHub's limit from 60 to 5,000 requests per hour.</small>
      ```
    - Do not add a `value` attribute to the token input. Do not wrap the row in a `<form>`.
    - Near the `.dosQuickSwitch input` rule (around line 117), add one CSS rule: `.dosTokenHint{flex:1 1 100%;font:11px/1.4 "Courier New",monospace;color:#9fb3b4}`.
  - File: `tests/github-token-input.test.ts`. Read `gardenos.html` with `readFileSync`. Add source-text tests:
    - The `#quickTokenInput` element has `type="password"` and `autocomplete="off"`, and has no `value=` attribute.
    - The index of `id="quickTokenInput"` is greater than `id="quickRepoInput"` and less than `id="btnLoadRepo"`. Both are inside `id="dossierModal"` (index of `dossierModal` less than the token index and the closing `</dialog>` after it).
    - `id="btnClearToken"` has `type="button"`.
    - `id="quickTokenHint"` is present.
  - Gate: `npm test` and `npx tsc --noEmit` both exit 0.
  - _Requirements: 1.1, 1.2, 1.3, 1.7, 3.8, 5.1_

- [ ] 5. Wire the Load_Handler, Enter key, clear control, and language labels in main.ts
  - File: `src/gardenos/main.ts`.
    - Replace the `loadRepoIntoDossier` definition (around lines 268-274) with:
      ```ts
      const loadRepoIntoDossier = async (repoStr: string, token = '') => {
        const q = repoStr.trim();
        if (!q) return;
        const t = token.trim();
        byId('dosHonest').textContent = tr(
          t ? `Fetching ${q} with a token held in memory only…` : `Fetching ${q}…`,
          t ? `Consultando ${q} con un token solo en memoria…` : `Consultando ${q}…`,
          getLang(),
        );
        const d = await ingestGitHubRepo(q, loginUI.name || 'Visitor', undefined, t || undefined);
        loginUI.setOrigin('GitHub'); loginUI.setRepo(q);
        await openDossier(true, d);
      };
      ```
      Do not store `t` anywhere else.
    - Change the `btnLoadRepo.onclick` line (around line 286) and the Enter listener on `quickRepoInput` (around line 287) so each passes `(byId('quickRepoInput') as HTMLInputElement).value` and `(byId('quickTokenInput') as HTMLInputElement).value` as the two arguments.
    - Add an Enter listener on `quickTokenInput` that calls `e.preventDefault()` and then calls `loadRepoIntoDossier` with the same two values.
    - Add `byId('btnClearToken').onclick = () => { (byId('quickTokenInput') as HTMLInputElement).value = ''; };` next to the other quick-row handlers.
    - In `syncLangUi` (around line 114), add these updates, reading the elements with `byId` inside the function:
      - `quickTokenInput.placeholder = tr('GitHub token (optional)', 'Token de GitHub (opcional)', getLang())`
      - `setAttribute('aria-label', tr('Optional GitHub personal access token', 'Token personal de GitHub opcional', getLang()))` on the same input
      - `byId('quickTokenHint').textContent = tr(<English hint from gardenos.html>, <Spanish hint from design.md section 7>, getLang())`
      - `byId('btnClearToken').textContent = tr('Clear token', 'Borrar token', getLang())`
    - Do not change the URL path (`qs.get('repo')`, around line 355), the boot path (around line 303), or `buildDossier` (around lines 548-557). Do not add `console.*`, `localStorage`, `sessionStorage`, or any read of a `token` URL parameter.
  - File: `tests/github-token-input.test.ts`. Read `src/gardenos/main.ts` with `readFileSync`. Copy the `functionBody` helper from `tests/dossier-focus.test.ts`. Add tests:
    - The `loadRepoIntoDossier` body contains `ingestGitHubRepo(q, loginUI.name || 'Visitor', undefined, t || undefined)`.
    - The `loadRepoIntoDossier` body contains no `localStorage`, `sessionStorage`, or `console.`.
    - `main.ts` contains no `qs.get('token')` and no `searchParams.get('token')`.
    - The `btnLoadRepo` line and the `quickRepoInput` Enter line both reference `quickTokenInput`.
    - `syncLangUi` contains `quickTokenHint` and `btnClearToken`.
    - The `buildDossier` branch that returns `activeDossier` for `'github:' + loginUI.repo.trim().toLowerCase()` is still present (Requirement 6.2).
  - Gate: `npm test` and `npx tsc --noEmit` both exit 0.
  - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 2.4, 2.5, 4.1, 4.2, 6.1, 6.2, 7.1_

- [ ] 6. Final verification and manual checklist
  - Run `npm test` and `npx tsc --noEmit` from the repository root. Both must exit 0. Record the number of tests in `tests/github-token-input.test.ts` that ran and passed.
  - Confirm the baseline recorded in task 0 did not get worse. Any new failure must be fixed in this task.
  - Manual checks. A person runs `npm run dev` in a separate terminal and opens the dossier. These cannot be automated without a DOM:
    1. Open the Quick Dossier with Tab from the Repository_Input. Confirm Tab and Shift+Tab reach the token field, the Clear token button, and the Load GitHub button in that order, and that focus does not leave the dialog.
    2. In the token field, press the Left and Right arrow keys. Confirm the caret moves and focus stays in the field.
    3. Press Escape in the token field. Confirm only the dossier closes.
    4. Type a value into the token field. Confirm the characters are masked.
    5. Toggle the language. Confirm the placeholder, label, hint, and clear button text change.
    6. Load a repository with a token, then press Enter in the token field. Confirm the status line does not show the token.
    7. Download the Kiro Revival Pack and the requirements.md. Open each file and confirm the token value does not appear.
    8. Open the browser developer tools Application panel. Confirm no `sd_gh_v3` entry was written for a load with a token, and no entry contains the token.
    9. Load a repository with no token while the GitHub limit is exhausted, or with the network blocked. Confirm the message states the 60 per hour limit and the token advice.
  - Gate: `npm test` and `npx tsc --noEmit` both exit 0. The manual checklist is reported separately and does not block the gate.
  - _Requirements: 5.1, 5.2, 5.3, 2.6, 7.4_

## Task Dependency Graph

Tasks run in strict order. Each wave depends on the one before it.

```json
{
  "waves": [
    { "id": 0, "tasks": ["0"] },
    { "id": 1, "tasks": ["1"] },
    { "id": 2, "tasks": ["2"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4"] },
    { "id": 5, "tasks": ["5"] },
    { "id": 6, "tasks": ["6"] }
  ]
}
```

Tasks 2 and 3 both edit the fatal catch in `ingestGitHubRepo`, so they stay in separate waves. Task 4 must precede task 5, because task 5 reads the element IDs that task 4 adds.
