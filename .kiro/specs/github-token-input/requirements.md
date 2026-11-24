# Requirements Document

## Introduction

GitHub Repository Token Input adds an optional, masked GitHub personal access token field to the Direct Dossier quick-load row. A visitor who loads a public repository can supply a token when GitHub's unauthenticated API limit (60 requests per hour per IP address) is reached, and the Ingestion_Engine then sends that token on api.github.com requests.

The token is held in memory for the current page session only. It is never written to Browser_Storage, never placed in a dossier field, never included in any Dossier_Export, and never shown in a repository field or an error message.

Scope: this feature covers the Dossier_Modal only. The CRT login screen (src/gardenos/login.ts) does not gain a token field. The design records that decision and its reasoning.

## Glossary

- **Dossier_Modal**: The `#dossierModal` dialog in gardenos.html that renders the Direct Dossier.
- **Quick_Load_Row**: The `.dosQuickSwitch` element inside the Dossier_Modal that holds the repository field and load buttons.
- **Repository_Input**: The existing `#quickRepoInput` text field that accepts owner/repo text.
- **Token_Input**: The new masked `#quickTokenInput` field that accepts an optional GitHub personal access token.
- **Clear_Token_Control**: The new `#btnClearToken` button that empties the Token_Input.
- **Token_Hint**: The new `#quickTokenHint` element that states the token policy in visible text.
- **Load_Handler**: The `loadRepoIntoDossier` function in src/gardenos/main.ts.
- **Ingestion_Engine**: The `ingestGitHubRepo` function in src/gardenos/ingest.ts.
- **Failure_Note**: The bilingual text (English and Spanish) returned by `describeGitHubFailure` in src/gardenos/ingest.ts.
- **Honesty_Note**: The `honestyNote` and `honestyNoteEs` fields of a ProjectDossier, shown in the `#dosHonest` element.
- **Dossier_Export**: Any Markdown, JSON, or clipboard output generated from a dossier in src/gardenos/kiro-export.ts, including the Kiro Revival Pack, requirements.md, design.md, tasks.md, the hook JSON, and the ARCHIVE_CARD.
- **Browser_Storage**: The browser `localStorage` and `sessionStorage` objects.
- **GitHub_API_Origin**: The origin `https://api.github.com`.
- **Translator**: The `tr(en, es, lang)` function in src/gardenos/i18n.ts.
- **Rate_Limit_Response**: An HTTP 403 or HTTP 429 response from GitHub_API_Origin.

## Requirements

### Requirement 1: Optional token field in the quick-load row

**User Story:** As a visitor, I want to optionally enter a GitHub token next to the repository field, so that I can load a repository after the unauthenticated limit is reached.

#### Acceptance Criteria

1. THE Quick_Load_Row SHALL display the Token_Input immediately after the Repository_Input and before the Load GitHub button.
2. THE Token_Input SHALL render its typed characters as masked characters by using `type="password"`.
3. THE Token_Input SHALL accept at most 255 characters.
4. WHEN the visitor activates the Load GitHub button or presses Enter in the Repository_Input or the Token_Input, THE Load_Handler SHALL start one ingestion of the text in the Repository_Input.
5. WHEN the trimmed Token_Input value is not empty at ingestion start, THE Load_Handler SHALL pass the trimmed value as the token argument of the Ingestion_Engine.
6. WHEN the trimmed Token_Input value is empty at ingestion start, THE Load_Handler SHALL call the Ingestion_Engine with no token argument.
7. WHEN the visitor activates the Clear_Token_Control, THE Dossier_Modal SHALL set the Token_Input value to an empty string.

### Requirement 2: Memory-only token handling

**User Story:** As a visitor, I want my token to stay in memory only, so that it cannot be recovered from browser storage, a downloaded file, or a copied report.

#### Acceptance Criteria

1. THE Load_Handler SHALL keep the token only in the Token_Input element value and in the local variables of one ingestion call.
2. WHEN a token is supplied, THE Ingestion_Engine SHALL send the token only in the `Authorization` header of requests whose URL starts with the GitHub_API_Origin.
3. WHEN a token is supplied, THE Ingestion_Engine SHALL leave Browser_Storage unchanged.
4. WHEN the Load_Handler stores the repository text, THE Load_Handler SHALL store only the trimmed repository text.
5. THE Load_Handler SHALL read no token from URL query parameters.
6. THE ingestion result and every Dossier_Export SHALL contain no token value.
7. IF an ingestion fails while a token is supplied, THEN THE Ingestion_Engine SHALL return a Failure_Note and Honesty_Note that contain no token value.
8. WHEN a load without a token ends with a Rate_Limit_Response, THE Ingestion_Engine SHALL skip the sessionStorage write for that dossier.

### Requirement 3: Honest rate-limit and access messages

**User Story:** As a visitor, I want the error message to tell me the real cause and whether a token would help, so that I know what action to take.

#### Acceptance Criteria

1. IF a Rate_Limit_Response arrives and no token was supplied, THEN THE Ingestion_Engine SHALL state in the Honesty_Note that unauthenticated GitHub API requests are limited to 60 per hour per IP address and that a personal access token raises that limit to 5,000 per hour.
2. IF a Rate_Limit_Response carries the `x-ratelimit-remaining` header with the value `0`, THEN THE Ingestion_Engine SHALL state that the request limit was reached.
3. IF a 403 response carries an `x-ratelimit-remaining` header whose value is not `0`, or carries no such header, THEN THE Ingestion_Engine SHALL describe the cause as possibly rate-limited or forbidden, without claiming that the limit was confirmed.
4. IF a Rate_Limit_Response arrives and a token was supplied, THEN THE Ingestion_Engine SHALL omit the advice to add a token from the Failure_Note.
5. IF GitHub responds with HTTP 401 and a token was supplied, THEN THE Ingestion_Engine SHALL state that GitHub rejected the token.
6. IF GitHub responds with HTTP 404 and no token was supplied, THEN THE Ingestion_Engine SHALL state that the repository was not found or is private, and that a private repository requires a token with access.
7. WHEN the Ingestion_Engine records a failed tree or commit request as a partial warning, THE Ingestion_Engine SHALL include the matching Failure_Note in the Honesty_Note.
8. THE Dossier_Modal SHALL display the Token_Hint, which states that the token stays in memory only and is never saved to Browser_Storage or included in any export.

### Requirement 4: Bilingual interface text

**User Story:** As a visitor who reads English or Spanish, I want every new control and message in my language, so that I understand the token policy and the errors.

#### Acceptance Criteria

1. THE Dossier_Modal SHALL show the Token_Input placeholder, the Token_Input accessible label, the Token_Hint text, and the Clear_Token_Control label in English and Spanish, selected through the Translator.
2. WHEN the visitor toggles the interface language, THE Dossier_Modal SHALL update the Token_Input placeholder, the Token_Input accessible label, the Token_Hint text, and the Clear_Token_Control label to the selected language.
3. THE Ingestion_Engine SHALL produce each Failure_Note with a non-empty English text and a non-empty Spanish text.

### Requirement 5: Keyboard and layer behavior

**User Story:** As a keyboard user, I want the token field to follow the dialog's focus and Escape rules, so that I can operate the dialog without a pointer.

#### Acceptance Criteria

1. WHILE the Dossier_Modal is open, THE Dossier_Modal SHALL include the Token_Input and the Clear_Token_Control in the Tab and Shift+Tab focus cycle, in DOM order.
2. WHILE the Token_Input has focus, THE Dossier_Modal SHALL move the text caret, and SHALL NOT move focus, when the visitor presses an arrow key.
3. WHEN the visitor presses Escape while the Token_Input has focus, THE Dossier_Modal SHALL close only the Dossier_Modal.

### Requirement 6: Operation without 3D

**User Story:** As a visitor whose browser cannot start WebGPU, I want the token-enabled load to work in the Direct Dossier, so that I can still inspect a repository.

#### Acceptance Criteria

1. THE Load_Handler SHALL complete a token-enabled repository load without starting the WebGPU renderer or compiling any GLB model.
2. WHEN the visitor activates the Enter 3D World action for a dossier loaded with a token, THE Load_Handler SHALL reuse the loaded dossier and SHALL NOT start a new GitHub request.

### Requirement 7: Automated test coverage

**User Story:** As a maintainer, I want automated tests for the token rules, so that a regression in storage, headers, or messages fails the test suite.

#### Acceptance Criteria

1. THE project SHALL contain automated tests for this feature in the tests directory, runnable with `npm test` using the Node test runner and without a DOM.
2. THE test suite SHALL verify the `Authorization` header rules of Requirement 2 with a stubbed fetch implementation.
3. THE test suite SHALL verify that each Failure_Note branch in Requirement 3 contains its required statement and contains no token value.
4. WHEN the implementation is complete, THE project SHALL pass `npm test` and `npx tsc --noEmit` with exit code 0.

### Requirement 8: Bundled content safety

**User Story:** As a maintainer, I want the feature to add no local machine paths to bundled or exported content, so that the showcase and exports stay portable.

#### Acceptance Criteria

1. THE feature SHALL add no local filesystem path to any bundled file or Dossier_Export.
