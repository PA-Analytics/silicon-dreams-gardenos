import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { createPresetDossier } from '../src/gardenos/ingest.ts';
import type { ProjectDossier, TodoTrack } from '../src/gardenos/ingest.ts';
import { formatArchiveCard, formatKiroDesignMd, formatKiroHookJson, formatKiroRequirementsMd, formatKiroRevivalSpec, formatKiroTasksMd } from '../src/gardenos/kiro-export.ts';

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
// A standalone token of 16+ letters and digits. The digit and letter requirement matches the generic redaction rule.
const tokenArb = fc.array(fc.constantFrom(...ALNUM), { minLength: 16, maxLength: 40 })
  .map((chars) => chars.join(''))
  .filter((s) => /[A-Za-z]/.test(s) && /\d/.test(s));
const prefixedArb = fc.tuple(fc.constantFrom('ghp_', 'sk-', 'AKIA', 'github_pat_', 'xoxb-'), tokenArb).map(([p, s]) => p + s);
const secretArb = fc.oneof(tokenArb, prefixedArb);

// Each entry plants the secret in one position that the exporter reads.
const POSITIONS: Array<(d: ProjectDossier, s: string) => void> = [
  (d, s) => { d.todos[0].excerpt = `TODO: rotate ${s} now`; },
  (d, s) => { d.todos[0].contextSnippet = `const key = "${s}";`; },
  (d, s) => { d.reentry.runCommands = [`npm run dev -- ${s}`]; },
  (d, s) => { d.reentry.testCommand = `npx check ${s}`; },
  (d, s) => { d.reentry.envHints = [`API_KEY=${s}`]; },
  (d, s) => { d.reentry.envHints = [s]; },
  (d, s) => { d.commits[0].message = `fix with ${s} inside`; },
  (d, s) => { d.tapeClue.observedFact = `saw ${s} in place`; },
  (d, s) => { d.tapeClue.interpretation = `context ${s} here`; },
  (d, s) => { d.projectName = `Garden ${s}`; },
  (d, s) => { d.honestyNote = `Read from ${s} folder.`; d.honestyNoteEs = `Leído desde ${s}.`; },
];

test('C1 property: a planted secret never appears in any export, in any position', () => {
  fc.assert(
    fc.property(secretArb, fc.integer({ min: 0, max: POSITIONS.length - 1 }), (secret, index) => {
      const d = createPresetDossier('boundary', 'Eva');
      POSITIONS[index](d, secret);
      const note = `creator remembers ${secret} here`;
      const out = everyExport(d, note);
      return !out.includes(secret);
    }),
    { numRuns: 200 },
  );
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
