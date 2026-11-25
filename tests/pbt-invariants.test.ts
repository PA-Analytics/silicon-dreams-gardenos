import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { loadProjectMemory, saveProjectMemory } from '../src/gardenos/kiro-export.ts';
import type { SavedProjectMemory } from '../src/gardenos/kiro-export.ts';
import { createPresetDossier } from '../src/gardenos/ingest.ts';
import type { ProjectDossier } from '../src/gardenos/ingest.ts';
import { createStoryEngine } from '../src/gardenos/story.ts';

// Feature: pbt-persistence-invariants. Run counts stay in the 100-200 range for a unit-test suite.
const RUNS = 200;
const RUNS_TRIAGE = 150;
const KEY_PREFIX = 'sd_memory_v1:';
const VERDICTS: ReadonlyArray<SavedProjectMemory['verdict']> = [null, 'archive', 'restore', 'leave'];

type FailSpec = { set?: { value: unknown }; get?: { value: unknown } };

// Map-backed fake of the Storage methods used by the module under test.
function makeStore(fail: FailSpec = {}) {
  const map = new Map<string, string>();
  const store = {
    map,
    setCalls: 0,
    getItem(key: string): string | null {
      if (fail.get) throw fail.get.value;
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.setCalls += 1;
      if (fail.set) throw fail.set.value;
      map.set(key, value);
    },
  };
  return store;
}

// Thrown values are built fresh for each generated case so no state leaks between runs.
const THROWN_FACTORIES: ReadonlyArray<() => unknown> = [
  () => null,
  () => undefined,
  () => 'quota',
  () => 42,
  () => Symbol('s'),
  () => new Error('quota exceeded'),
  () => new Error(''),
  () => { const e = new Error('x'); Object.defineProperty(e, 'name', { value: Symbol('n') }); return e; },
  () => { const e = new Error('x'); Object.defineProperty(e, 'message', { value: Symbol('m') }); return e; },
  () => { const e = new Error('x'); Object.defineProperty(e, 'name', { get() { throw new Error('name getter'); } }); return e; },
  () => new Proxy(new Error('p'), { get() { throw new Error('get trap'); } }),
];

const projectIdArb = fc.oneof(
  fc.string(),
  fc.string({ unit: 'grapheme' }),
  fc.constantFrom('', ':', 'a:b', 'sentinel-lab'),
);

const noteArb = fc.oneof(
  fc.constant(''),
  fc.constantFrom('line1\nline2', 'a\r\nb\n\nc', 'café', 'Ñandú 🌿 日本語', '\u2028'),
  fc.string({ unit: 'grapheme' }),
  fc.string(),
);

const verdictArb = fc.constantFrom(...VERDICTS);
const isoArb = fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString());

// savedAt is omitted (never set to undefined) when absent.
const recordArb = fc.tuple(noteArb, verdictArb, fc.option(isoArb, { nil: null })).map(([creatorNote, verdict, savedAt]) => {
  const record: SavedProjectMemory = { creatorNote, verdict };
  if (savedAt !== null) record.savedAt = savedAt;
  return record;
});

const invalidRecordArb = fc.oneof(
  fc.record({
    tag: fc.constant('missing-note'),
    record: fc.record({ verdict: verdictArb }),
  }),
  fc.record({
    tag: fc.constant('bad-verdict'),
    record: fc.record({
      creatorNote: noteArb,
      verdict: fc.oneof(
        fc.constantFrom('ARCHIVE', 'none', '', ' archive'),
        fc.string().filter((v) => !['archive', 'restore', 'leave'].includes(v)),
        fc.integer(),
        fc.constant(undefined),
      ),
    }),
  }),
  fc.record({
    tag: fc.constant('bad-note-type'),
    record: fc.record({
      creatorNote: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined), fc.array(fc.string())),
      verdict: verdictArb,
    }),
  }),
);

const garbageStringArb = fc.oneof(
  fc.string(),
  fc.string({ unit: 'grapheme' }),
  fc.json(),
  fc.constantFrom('', 'null', '0', '[]', '"x"', '{', 'NaN', '{"creatorNote":1,"verdict":null}', '{"creatorNote":"","verdict":"maybe"}'),
  recordArb.map((r) => JSON.stringify(r)),
  fc.tuple(recordArb, fc.nat()).map(([r, n]) => {
    const s = JSON.stringify(r);
    return s.slice(0, n % (s.length + 1));
  }),
);

const thrownArb = fc.constantFrom(...THROWN_FACTORIES).map((make) => make());

// Test-local oracle restating the load rule independently of kiro-export.ts.
function isValidRecord(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.creatorNote === 'string'
    && VERDICTS.includes(r.verdict as SavedProjectMemory['verdict'])
    && (r.savedAt === undefined || typeof r.savedAt === 'string');
}

function expectedLoad(raw: string): unknown {
  if (raw === '') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  return isValidRecord(parsed) ? parsed : null;
}

// Triage: the playTape setup is not a Triage_Operation.
const freshSentinel = (): ProjectDossier => createPresetDossier('sentinel-lab', 'Tester');

function checkTriage(dossier: ProjectDossier, engine: ReturnType<typeof createStoryEngine>, trackIds: string[], model: Set<string>, index: number, step: number): void {
  const selected = dossier.selectedTodoIds;
  assert.equal(new Set(selected).size, selected.length, `step ${step}: duplicate id in selectedTodoIds`);
  for (const id of selected) assert.ok(trackIds.includes(id), `step ${step}: selected id ${id} is not a track id`);
  for (const id of trackIds) assert.equal(engine.isTodoSelected(id), model.has(id), `step ${step}: isTodoSelected(${id}) disagrees with model`);
  assert.deepEqual([...new Set(selected)].sort(), [...model].sort(), `step ${step}: selected set differs from model`);
  assert.equal(engine.activeTodoIndex, index, `step ${step}: activeTodoIndex differs from model`);
}

function runTriage(dossier: ProjectDossier, trackIds: string[], ops: string[]): void {
  const engine = createStoryEngine(dossier, 'full', null);
  engine.interactIslandPoi('tv');
  assert.equal(engine.tapePlayed, true, 'setup: tape must be played before triage operations');
  const n = trackIds.length;
  const model = new Set(trackIds);
  let index = 0;
  checkTriage(dossier, engine, trackIds, model, index, -1);
  ops.forEach((op, step) => {
    if (op === 'toggle') {
      engine.toggleActiveTodoForKiro();
      if (n > 0) {
        const current = trackIds[index % n];
        if (model.has(current)) model.delete(current); else model.add(current);
      }
    } else {
      engine.interactIslandPoi('tv');
      if (n > 1) index = (index + 1) % n;
    }
    checkTriage(dossier, engine, trackIds, model, index, step);
  });
}

function syntheticDossier(ids: string[]): ProjectDossier {
  const d = freshSentinel();
  const template = d.todos[0];
  d.todos = ids.map((id, i) => ({ ...structuredClone(template), id, lineNumber: i + 1 }));
  d.selectedTodoIds = ids.slice();
  d.activeTodoIndex = 0;
  return d;
}

const triageOpsArb = fc.array(fc.constantFrom('toggle', 'tv'), { maxLength: 40 });
const syntheticIdsArb = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/), { minLength: 0, maxLength: 8 });
const savedMemoryArb = fc.option(recordArb, { nil: null });

// Property 1: memory round trip
// Feature: pbt-persistence-invariants, Property 1: memory round trip
test('Property 1: save then load returns a deep-equal record', () => {
  fc.assert(fc.property(projectIdArb, recordArb, (id, record) => {
    const store = makeStore();
    assert.deepEqual(saveProjectMemory(id, record, store), { ok: true });
    const loaded = loadProjectMemory(id, store);
    assert.deepEqual(loaded, record);
    assert.equal(Object.hasOwn(loaded as object, 'savedAt'), Object.hasOwn(record, 'savedAt'));
  }), { numRuns: RUNS });
});

// Property 2: honest save result
// Feature: pbt-persistence-invariants, Property 2: honest save result
test('Property 2: saveProjectMemory never reports ok:true after a storage throw', () => {
  fc.assert(fc.property(projectIdArb, recordArb, thrownArb, fc.boolean(), (id, record, thrown, shouldThrow) => {
    const store = makeStore(shouldThrow ? { set: { value: thrown } } : {});
    const result = saveProjectMemory(id, record, store);
    if (shouldThrow) {
      assert.equal(result.ok, false, 'a throwing setItem must yield ok:false');
      assert.equal(typeof result.error, 'string');
      assert.ok((result.error as string).length > 0, 'error must be a non-empty string');
    } else {
      assert.deepEqual(result, { ok: true });
    }
  }), { numRuns: RUNS });
});

// Property 3: garbage string load
// Feature: pbt-persistence-invariants, Property 3: garbage string load
test('Property 3: loadProjectMemory returns the oracle value for any stored string', () => {
  fc.assert(fc.property(projectIdArb, garbageStringArb, (id, raw) => {
    const store = makeStore();
    store.map.set(KEY_PREFIX + id, raw);
    assert.deepEqual(loadProjectMemory(id, store), expectedLoad(raw));
  }), { numRuns: RUNS });
});

// Property 4: load survives a throwing store
// Feature: pbt-persistence-invariants, Property 4: load survives a throwing store
test('Property 4: loadProjectMemory returns null and never throws when getItem throws', () => {
  fc.assert(fc.property(projectIdArb, thrownArb, (id, thrown) => {
    const store = makeStore({ get: { value: thrown } });
    assert.equal(loadProjectMemory(id, store), null);
  }), { numRuns: RUNS });
});

// Property 5: invalid records are rejected before any write
// Feature: pbt-persistence-invariants, Property 5: invalid records are rejected before any write
test('Property 5: invalid records return ok:false and never reach setItem', () => {
  fc.assert(fc.property(projectIdArb, recordArb, invalidRecordArb, (id, seed, invalid) => {
    const store = makeStore();
    const seededRaw = JSON.stringify(seed);
    store.map.set(KEY_PREFIX + id, seededRaw);
    const result = saveProjectMemory(id, invalid.record as unknown as SavedProjectMemory, store);
    const tag = invalid.tag;
    assert.equal(result.ok, false, `[${tag}] invalid record must not save`);
    if (tag !== 'bad-note-type') {
      assert.equal(typeof result.error, 'string', `[${tag}] error must be a string`);
      assert.ok((result.error as string).length > 0, `[${tag}] error must be non-empty`);
    }
    assert.equal(store.setCalls, 0, `[${tag}] setItem must not be called`);
    assert.equal(store.map.get(KEY_PREFIX + id), seededRaw, `[${tag}] stored value must be unchanged`);
  }), { numRuns: RUNS });
});

// Property 6a: triage selection on the Sentinel dossier
// Feature: pbt-persistence-invariants, Property 6: triage selection matches the model (Sentinel variant)
test('Property 6a: triage selection matches the model on the Sentinel dossier', () => {
  fc.assert(fc.property(triageOpsArb, (ops) => {
    const dossier = freshSentinel();
    runTriage(dossier, dossier.todos.map((t) => t.id), ops);
  }), { numRuns: RUNS_TRIAGE });
});

// Property 6b: triage selection on synthetic track ids (test inputs only, not product data)
// Feature: pbt-persistence-invariants, Property 6: triage selection matches the model (synthetic variant)
test('Property 6b: triage selection matches the model on synthetic track ids (test inputs, not product data)', () => {
  fc.assert(fc.property(syntheticIdsArb, triageOpsArb, (ids, ops) => {
    runTriage(syntheticDossier(ids), ids, ops);
  }), { numRuns: RUNS_TRIAGE });
});

// Property 7: fresh engine selects every track
// Feature: pbt-persistence-invariants, Property 7: fresh engine selects every track
test('Property 7: a fresh engine selects every track regardless of pace or saved memory', () => {
  fc.assert(fc.property(fc.constantFrom('demo', 'full'), savedMemoryArb, (pace, memory) => {
    const dossier = freshSentinel();
    const engine = createStoryEngine(dossier, pace, memory);
    const ids = dossier.todos.map((t) => t.id);
    assert.deepEqual(new Set(dossier.selectedTodoIds), new Set(ids));
    for (const id of ids) assert.equal(engine.isTodoSelected(id), true, `track ${id} must be selected`);
  }), { numRuns: RUNS_TRIAGE });
});

// Example checks
test('no DOM globals are present in this Node test environment', () => {
  assert.equal((globalThis as Record<string, unknown>).window, undefined);
  assert.equal((globalThis as Record<string, unknown>).document, undefined);
});

test('generator coverage: note samples include empty, multi-line, and non-ASCII text', () => {
  const samples = fc.sample(noteArb, { seed: 20260924, numRuns: 300 });
  assert.ok(samples.includes(''), 'empty string must appear');
  assert.ok(samples.some((s) => s.includes('\n')), 'a multi-line note must appear');
  assert.ok(samples.some((s) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f)), 'a non-ASCII note must appear');
});

test('run counts stay within the 100-200 unit-suite range', () => {
  for (const n of [RUNS, RUNS_TRIAGE]) assert.ok(n >= 100 && n <= 200, `run count ${n} out of range`);
});

// Regression examples for the Property 2 finding (task 6.2)
test('regression: an Error whose name is a Symbol returns ok:false instead of throwing', () => {
  const e = new Error('x');
  Object.defineProperty(e, 'name', { value: Symbol('n') });
  const result = saveProjectMemory('p', { creatorNote: '', verdict: null }, makeStore({ set: { value: e } }));
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.ok((result.error as string).length > 0);
});

test('regression: an Error whose message is a Symbol returns ok:false instead of throwing', () => {
  const e = new Error('x');
  Object.defineProperty(e, 'message', { value: Symbol('m') });
  const result = saveProjectMemory('p', { creatorNote: '', verdict: null }, makeStore({ set: { value: e } }));
  assert.equal(result.ok, false);
  assert.ok((result.error as string).length > 0);
});

test('regression: an Error whose name getter throws returns ok:false instead of throwing', () => {
  const e = new Error('x');
  Object.defineProperty(e, 'name', { get() { throw new Error('name getter'); } });
  const result = saveProjectMemory('p', { creatorNote: '', verdict: null }, makeStore({ set: { value: e } }));
  assert.equal(result.ok, false);
  assert.ok((result.error as string).length > 0);
});

test('regression: ordinary Error output is unchanged (Error: quota)', () => {
  const result = saveProjectMemory('p', { creatorNote: '', verdict: null }, makeStore({ set: { value: new Error('quota') } }));
  assert.deepEqual(result, { ok: false, error: 'Error: quota' });
});
