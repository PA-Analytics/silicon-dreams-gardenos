import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExampleDossier, describeGitHubFailure, ingestGitHubRepo, redactToken } from '../src/gardenos/ingest.ts';
import type { BilingualText } from '../src/gardenos/ingest.ts';
import { formatKiroRevivalSpec } from '../src/gardenos/kiro-export.ts';

const mainSource = readFileSync(new URL('../src/gardenos/main.ts', import.meta.url), 'utf8');

function functionBody(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `missing ${header}`);
  const end = source.indexOf('\n  };', start);
  assert.ok(end > start, `unterminated ${header}`);
  return source.slice(start, end);
}

function lineContaining(source: string, fragment: string): string | undefined {
  return source.split('\n').find((line) => line.includes(fragment));
}

const FIXTURE_TOKEN = 'github_pat_FIXTURE_ABC';

type Route = { suffix: string; respond: () => Response };

// Routes match by URL suffix. The first matching route wins, so a test can prepend an override.
function healthyRoutes(): Route[] {
  return [
    { suffix: '/repos/owner/repo', respond: () => Response.json({ name: 'repo', default_branch: 'main', created_at: '2020-01-01T00:00:00Z', pushed_at: '2024-01-01T00:00:00Z' }) },
    { suffix: '/repos/owner/repo/git/trees/main?recursive=1', respond: () => Response.json({ truncated: false, tree: [
      { path: 'README.md', type: 'blob' },
      { path: 'package.json', type: 'blob' },
      { path: 'src/index.ts', type: 'blob' },
    ] }) },
    { suffix: '/repos/owner/repo/commits?per_page=5', respond: () => Response.json([{ sha: 'abcdef1234567', commit: { message: 'init', committer: { date: '2024-01-01T00:00:00Z' } } }]) },
    { suffix: '/repos/owner/repo/readme', respond: () => Response.json({ path: 'README.md', content: '# Demo\n' }) },
    { suffix: '/owner/repo/main/package.json', respond: () => new Response('{"scripts":{"start":"node src/index.ts"}}') },
    { suffix: '/owner/repo/main/src/index.ts', respond: () => new Response('export const value = 1;\n') },
  ];
}

function status(code: number, remaining?: string): () => Response {
  return () => new Response(null, { status: code, headers: remaining === undefined ? {} : { 'x-ratelimit-remaining': remaining } });
}

// Records every (url, init) pair. Unmatched URLs answer 404.
function recordingFetch(routes: Route[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => url.endsWith(r.suffix));
    return route ? route.respond() : new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function authOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

// Counts sessionStorage calls. The original global is restored in t.after, as tests/story-ingest.test.ts does.
function stubSessionStorage(t: { after(fn: () => void): void }) {
  const store = new Map<string, string>();
  const counts = { getItem: 0, setItem: 0 };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => { counts.getItem++; return store.get(k) ?? null; },
      setItem: (k: string, v: string) => { counts.setItem++; store.set(k, v); },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  return counts;
}

type Case = { status: number; rateLimitRemaining: string | null; tokenSupplied: boolean };

const rateLimitStatuses = [403, 429];
const remainingValues: (string | null)[] = ['0', '5', null];

const rateLimitGrid: Case[] = rateLimitStatuses.flatMap((status) =>
  remainingValues.flatMap((rateLimitRemaining) => [
    { status, rateLimitRemaining, tokenSupplied: true },
    { status, rateLimitRemaining, tokenSupplied: false },
  ]),
);

const fullGrid: Case[] = [
  ...rateLimitGrid,
  { status: 404, rateLimitRemaining: null, tokenSupplied: false },
  { status: 404, rateLimitRemaining: null, tokenSupplied: true },
  { status: 401, rateLimitRemaining: null, tokenSupplied: true },
  { status: 500, rateLimitRemaining: null, tokenSupplied: false },
];

test('rate-limit statuses with a token never advise adding one', () => {
  for (const status of rateLimitStatuses) {
    for (const rateLimitRemaining of remainingValues) {
      const { en } = describeGitHubFailure({ status, rateLimitRemaining, tokenSupplied: true });
      assert.ok(!en.includes('raises'), `${status}/${rateLimitRemaining}: ${en}`);
      assert.ok(!en.includes('Add'), `${status}/${rateLimitRemaining}: ${en}`);
    }
  }
});

test('rate-limit statuses without a token state the 60 and 5,000 per hour limits', () => {
  for (const status of rateLimitStatuses) {
    for (const rateLimitRemaining of remainingValues) {
      const { en } = describeGitHubFailure({ status, rateLimitRemaining, tokenSupplied: false });
      assert.ok(en.includes('5,000'), `${status}/${rateLimitRemaining}: ${en}`);
      assert.ok(en.includes('60 per hour'), `${status}/${rateLimitRemaining}: ${en}`);
    }
  }
});

test('404 without a token says a private repository requires a token', () => {
  const { en } = describeGitHubFailure({ status: 404, rateLimitRemaining: null, tokenSupplied: false });
  assert.ok(en.includes('requires a token'), en);
});

test('404 with a token does not say a token is required', () => {
  const { en } = describeGitHubFailure({ status: 404, rateLimitRemaining: null, tokenSupplied: true });
  assert.ok(!en.includes('requires a token'), en);
});

test('403 with remaining 5 and no token says "may" and not "reached"', () => {
  const { en } = describeGitHubFailure({ status: 403, rateLimitRemaining: '5', tokenSupplied: false });
  assert.ok(en.includes('may'), en);
  assert.ok(!en.includes('reached'), en);
});

test('403 with remaining 0 and no token says the limit was reached', () => {
  const { en } = describeGitHubFailure({ status: 403, rateLimitRemaining: '0', tokenSupplied: false });
  assert.ok(en.includes('reached'), en);
});

test('401 with a token says GitHub rejected the token', () => {
  const { en } = describeGitHubFailure({ status: 401, rateLimitRemaining: null, tokenSupplied: true });
  assert.ok(en.includes('rejected'), en);
});

for (const input of fullGrid) {
  const label = `${input.status}/${input.rateLimitRemaining}/${input.tokenSupplied ? 'token' : 'no-token'}`;
  test(`bilingual text is complete for ${label}`, () => {
    const text: BilingualText = describeGitHubFailure(input);
    assert.ok(text.en.length > 0, 'en is empty');
    assert.ok(text.es.length > 0, 'es is empty');
    if (input.status === 500) {
      // The "other status" branch is specified to return the same "GitHub HTTP <status>." in both languages.
      assert.equal(text.es, text.en);
    } else {
      assert.notEqual(text.es, text.en);
    }
  });
}

test('redactToken replaces every occurrence of the token', () => {
  const token = 'github_pat_FIXTURE';
  assert.equal(
    redactToken('x github_pat_FIXTURE y github_pat_FIXTURE', token),
    'x [token hidden] y [token hidden]',
  );
});

test('redactToken is idempotent', () => {
  const token = 'github_pat_FIXTURE';
  const once = redactToken('x github_pat_FIXTURE y', token);
  assert.equal(redactToken(once, token), once);
});

test('redactToken returns the input unchanged for an empty or undefined token', () => {
  const text = 'network down github_pat_FIXTURE';
  assert.equal(redactToken(text, undefined), text);
  assert.equal(redactToken(text, ''), text);
  assert.equal(redactToken(text, '   '), text);
});

test('token success load: trimmed bearer on every api call, no headers on raw calls, zero storage calls', async (t) => {
  const storage = stubSessionStorage(t);
  const { fetchImpl, calls } = recordingFetch(healthyRoutes());
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl, `  ${FIXTURE_TOKEN}  `);
  assert.equal(dossier.origin, 'GitHub');
  const api = calls.filter((c) => c.url.startsWith('https://api.github.com/'));
  const raw = calls.filter((c) => c.url.startsWith('https://raw.githubusercontent.com/'));
  assert.ok(api.length >= 3, `expected api calls, got ${api.length}`);
  assert.ok(raw.length >= 1, `expected raw calls, got ${raw.length}`);
  for (const c of api) assert.equal(authOf(c.init), `Bearer ${FIXTURE_TOKEN}`, c.url);
  for (const c of raw) assert.equal(c.init?.headers, undefined, c.url);
  assert.equal(storage.getItem, 0);
  assert.equal(storage.setItem, 0);
});

test('whitespace-only token sends no Authorization header on any call', async (t) => {
  stubSessionStorage(t);
  const { fetchImpl, calls } = recordingFetch(healthyRoutes());
  await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl, '   ');
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal(authOf(c.init), undefined, c.url);
});

test('no token, meta 403 with remaining 0: 60/5,000 note, no setItem, sentinel fallback', async (t) => {
  const storage = stubSessionStorage(t);
  const { fetchImpl } = recordingFetch([{ suffix: '/repos/owner/repo', respond: status(403, '0') }, ...healthyRoutes()]);
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl);
  assert.ok(dossier.honestyNote.includes('60 per hour'), dossier.honestyNote);
  assert.ok(dossier.honestyNote.includes('5,000'), dossier.honestyNote);
  assert.equal(storage.setItem, 0);
  assert.equal(dossier.origin, 'Demo');
  assert.equal(dossier.presetId, 'sentinel-lab');
  assert.equal(dossier.isDemo, true);
});

test('token supplied, meta 403: honesty note omits the advice to add a token', async (t) => {
  stubSessionStorage(t);
  const { fetchImpl } = recordingFetch([{ suffix: '/repos/owner/repo', respond: status(403) }, ...healthyRoutes()]);
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl, FIXTURE_TOKEN);
  assert.ok(!dossier.honestyNote.includes('raises'), dossier.honestyNote);
  assert.ok(!dossier.honestyNote.includes('Add'), dossier.honestyNote);
});

test('token supplied, meta 401: honesty note says GitHub rejected the token', async (t) => {
  stubSessionStorage(t);
  const { fetchImpl } = recordingFetch([{ suffix: '/repos/owner/repo', respond: status(401) }, ...healthyRoutes()]);
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl, FIXTURE_TOKEN);
  assert.ok(dossier.honestyNote.includes('rejected'), dossier.honestyNote);
});

test('token supplied, fetch rejects with the token in the message: honesty note hides the token', async (t) => {
  stubSessionStorage(t);
  const fetchImpl = (async () => { throw new Error(`network down ${FIXTURE_TOKEN}`); }) as typeof fetch;
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl, FIXTURE_TOKEN);
  assert.ok(!dossier.honestyNote.includes(FIXTURE_TOKEN), dossier.honestyNote);
});

test('no token, tree 403, meta and commits succeed: English and Spanish notes state 60 per hour', async (t) => {
  stubSessionStorage(t);
  const { fetchImpl } = recordingFetch([{ suffix: '/repos/owner/repo/git/trees/main?recursive=1', respond: status(403) }, ...healthyRoutes()]);
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl);
  assert.equal(dossier.origin, 'GitHub');
  assert.ok(dossier.honestyNote.includes('60 per hour'), dossier.honestyNote);
  assert.ok(dossier.honestyNoteEs?.includes('60 por hora'), dossier.honestyNoteEs);
});

test('successful load with a token: dossier JSON and Kiro spec contain no token value', async (t) => {
  stubSessionStorage(t);
  const { fetchImpl } = recordingFetch(healthyRoutes());
  const dossier = await ingestGitHubRepo('owner/repo', 'Ada', fetchImpl, `  ${FIXTURE_TOKEN}  `);
  assert.equal(dossier.origin, 'GitHub');
  assert.ok(!JSON.stringify(dossier).includes(FIXTURE_TOKEN));
  assert.ok(!formatKiroRevivalSpec(dossier, 'restore', '').includes(FIXTURE_TOKEN));
});
test('createExampleDossier passes the Spanish reason into honestyNoteEs', () => {
  const dossier = createExampleDossier('Ada', 'Reason EN', 'Razón ES');
  assert.ok(dossier.honestyNoteEs?.startsWith('Razón ES'), dossier.honestyNoteEs);
});

test('createExampleDossier without a Spanish reason falls back to the English reason in honestyNoteEs', () => {
  const dossier = createExampleDossier('Ada', 'Reason EN');
  assert.ok(dossier.honestyNoteEs?.startsWith('Reason EN'), dossier.honestyNoteEs);
});

test('fallback dossier honestyNote starts with the English reason', () => {
  const dossier = createExampleDossier('Ada', 'Reason EN', 'Razón ES');
  assert.ok(dossier.honestyNote.startsWith('Reason EN'), dossier.honestyNote);
});

const htmlSource = readFileSync(new URL('../gardenos.html', import.meta.url), 'utf8');

function openingTagWithId(source: string, id: string): string | undefined {
  return source.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0];
}

test('quickTokenInput is a password field with autocomplete off and no value attribute', () => {
  const tag = openingTagWithId(htmlSource, 'quickTokenInput');
  assert.ok(tag, 'quickTokenInput tag not found');
  assert.ok(/\stype="password"/.test(tag), tag);
  assert.ok(/\sautocomplete="off"/.test(tag), tag);
  assert.ok(!/\svalue=/.test(tag), tag);
});

test('quickTokenInput sits between quickRepoInput and btnLoadRepo inside dossierModal', () => {
  const modal = htmlSource.indexOf('id="dossierModal"');
  const repo = htmlSource.indexOf('id="quickRepoInput"');
  const token = htmlSource.indexOf('id="quickTokenInput"');
  const load = htmlSource.indexOf('id="btnLoadRepo"');
  const close = htmlSource.indexOf('</dialog>', modal);
  assert.ok(modal >= 0, 'dossierModal not found');
  assert.ok(close > modal, 'closing </dialog> not found after dossierModal');
  assert.ok(token > repo, 'quickTokenInput must follow quickRepoInput');
  assert.ok(token < load, 'quickTokenInput must precede btnLoadRepo');
  assert.ok(token > modal && token < close, 'quickTokenInput must be inside dossierModal');
});

test('btnClearToken is a button with type="button"', () => {
  const tag = openingTagWithId(htmlSource, 'btnClearToken');
  assert.ok(tag, 'btnClearToken tag not found');
  assert.ok(/\stype="button"/.test(tag), tag);
});

test('quickTokenHint is present in gardenos.html', () => {
  assert.ok(htmlSource.includes('id="quickTokenHint"'));
});

test('loadRepoIntoDossier passes the trimmed token as the fourth argument to ingestGitHubRepo', () => {
  const body = functionBody(mainSource, "const loadRepoIntoDossier = async (repoStr: string, token = '') => {");
  assert.ok(body.includes("ingestGitHubRepo(q, loginUI.name || 'Visitor', undefined, t || undefined)"), body);
});

test('loadRepoIntoDossier contains no storage or console calls', () => {
  const body = functionBody(mainSource, "const loadRepoIntoDossier = async (repoStr: string, token = '') => {");
  assert.ok(!body.includes('localStorage'), body);
  assert.ok(!body.includes('sessionStorage'), body);
  assert.ok(!body.includes('console.'), body);
});

test('main.ts reads no token from URL query parameters', () => {
  assert.ok(!mainSource.includes("qs.get('token')"));
  assert.ok(!mainSource.includes("searchParams.get('token')"));
});

test('btnLoadRepo and the quickRepoInput Enter listener both pass the token input', () => {
  const buttonLine = lineContaining(mainSource, "byId('btnLoadRepo').onclick");
  const enterLine = lineContaining(mainSource, "byId('quickRepoInput').addEventListener('keydown'");
  assert.ok(buttonLine?.includes('quickTokenInput'), buttonLine);
  assert.ok(enterLine?.includes('quickTokenInput'), enterLine);
});

test('syncLangUi updates the token hint and the clear button', () => {
  const body = functionBody(mainSource, 'const syncLangUi = () => {');
  assert.ok(body.includes('quickTokenHint'), 'quickTokenHint missing from syncLangUi');
  assert.ok(body.includes('btnClearToken'), 'btnClearToken missing from syncLangUi');
});

test('buildDossier still returns activeDossier for a matching GitHub id (Requirement 6.2)', () => {
  const condition = "activeDossier.id === 'github:' + loginUI.repo.trim().toLowerCase()";
  const at = mainSource.indexOf(condition);
  assert.ok(at >= 0, 'GitHub id condition missing from buildDossier');
  assert.ok(mainSource.slice(at, at + 200).includes('return activeDossier;'), 'return activeDossier missing');
});
