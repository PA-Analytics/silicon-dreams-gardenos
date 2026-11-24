import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPresetDossier, detectArchetype, detectReentryPlan, ingestGitHubRepo, ingestLocalFiles, formatRecoveryCardMarkdown } from '../src/gardenos/ingest.ts';
import type { LocalFileLike } from '../src/gardenos/ingest.ts';
import { buildRepoGraph, extractLocalImports } from '../src/gardenos/repo-graph.ts';
import { formatArchiveCard, formatKiroDesignMd, formatKiroHookJson, formatKiroRequirementsMd, formatKiroRevivalSpec, formatKiroTasksMd, loadProjectMemory, saveProjectMemory } from '../src/gardenos/kiro-export.ts';
import { createStoryEngine, lineSeconds, receptionCues, typingMs } from '../src/gardenos/story.ts';
import { PRESET_LIST } from '../src/gardenos/presets.ts';

for (const id of ['trazo', 'boundary', 'sentinel-lab'] as const) {
  test(`preset ${id}: provenance, real metadata & no local workstation paths`, () => {
    const d = createPresetDossier(id, ' Ada ');
    assert.equal(d.presetId, id);
    assert.equal(d.visitorName, 'Ada');
    assert.equal(d.isDemo, id === 'sentinel-lab');
    assert.ok(d.knownTotalFiles >= d.graph.nodes.length);
    assert.ok(d.graph.edges.length > 0);
    if (id === 'trazo') assert.equal(d.todos.length, 0);
    else assert.ok(d.todos.length >= 2);
    assert.ok(!d.todos.some((t) => t.tag === 'STUB'));
    assert.ok(d.reentry.runCommands.length > 0);
    assert.ok(!/C:\\disco/i.test(d.sourceLabel + d.honestyNote + d.primaryPiece.path));
    assert.ok(!d.todos.some((t) => /Todo empieza/.test(t.excerpt)));
    const expectedProv = d.isDemo ? 'DEMO' : 'SNAPSHOT';
    for (const p of [d.primaryPiece, d.tapeClue, d.towerRecord]) assert.equal(p.provenance, expectedProv);
    if (id === 'trazo') {
      assert.equal(d.galleryImages.length, 3);
      assert.equal(d.tapeClue.lineNumber, 216);
      assert.equal(d.tapeClue.kind, 'file');
      assert.equal(d.tapeClue.path, 'src/utils/companionPathSampler.ts');
      assert.equal(d.tapeClue.excerpt, '// Fallback: simple line if parsing yielded no segments');
      const spec = formatKiroRevivalSpec(d, 'restore', 'Check validation first');
      assert.ok(spec.includes('No TODO/FIXME line markers verified'));
      assert.ok(!spec.includes('[STUB]'));
    }
    if (id === 'boundary') { assert.match(d.primaryPiece.observedFact, /src\/main\.py:280/); assert.equal(d.tapeClue.lineNumber, 294); }
  });
}

test('repo-graph: distinguishes real import edges vs folder links (JS/Py/Go/Rust) & knownTotalFiles', () => {
  const refs = extractLocalImports("import {a} from './a.js';\nconst b=require('../lib/b');\nimport 'external';\n// require('./absent')");
  assert.deepEqual(refs, ['./a.js', '../lib/b']);
  const goRefs = extractLocalImports('package main\nimport (\n  "fmt"\n  "github.com/acme/app/internal/store"\n)');
  assert.ok(goRefs.includes('go:github.com/acme/app/internal/store'));
  const paths = ['src/a.ts', 'src/main.ts', 'lib/b.ts', 'tools/run.py', 'tools/util.py', 'cmd/api/main.go', 'internal/store/db.go', ...Array.from({ length: 50 }, (_, i) => `assets/${i}.txt`)];
  const imports = new Map([['src/main.ts', refs], ['tools/run.py', extractLocalImports('from . import util')], ['cmd/api/main.go', goRefs]]);
  const g = buildRepoGraph(paths, imports, 'assets/49.txt', 301);
  assert.equal(g.nodes.length, 36);
  assert.equal(g.sampledFiles, 57);
  assert.equal(g.knownTotalFiles, 301);
  assert.ok(g.importEdgeCount >= 4);
  assert.deepEqual(g, buildRepoGraph(paths.slice().reverse(), imports, 'assets/49.txt', 301));
  const hasImport = (from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to && e.kind === 'import');
  assert.ok(hasImport('src/main.ts', 'lib/b.ts'));
  assert.ok(hasImport('cmd/api/main.go', 'internal/store/db.go'));
  assert.deepEqual(buildRepoGraph([]).nodes, []);
});

test('archetypes & manifests: Cargo crate-local bin, go.mod, monorepo & Python', () => {
  for (const [path, kind] of [['ejercicios/uno.py', 'course'], ['kali/pentest.txt', 'security'], ['prisma/schema.prisma', 'saas'], ['pubspec.yaml', 'app'], ['scene.glb', 'creative'], ['notes.txt', 'general']] as const) {
    assert.equal(detectArchetype([path]).archetype, kind);
  }
  const docs = new Map([
    ['crates/lib/Cargo.toml', '[package]\nname = "core_lib"'],
    ['crates/api/src/main.rs', 'fn main() {}'],
    ['go.mod', 'module example.com/app'],
    ['apps/web/package.json', JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } })],
    ['.env.example', 'API_KEY=not-for-output'],
  ]);
  const plan = detectReentryPlan([...docs.keys()], docs);
  assert.ok(plan.runCommands.includes('cd crates/lib && cargo build'));
  assert.ok(!plan.runCommands.includes('cd crates/lib && cargo run'), 'lib crate must not emit cargo run');
  assert.ok(plan.runCommands.includes('go build ./...'));
  assert.ok(plan.runCommands.includes('cd apps/web && npm run dev'));
  assert.equal(plan.testCommand, 'cd apps/web && npm test');
  assert.deepEqual(plan.envHints, ['API_KEY']);
});

function fixture(path: string, source: string, stamp = 12, readable = true): LocalFileLike {
  return { name: path.split('/').pop()!, webkitRelativePath: 'demo/' + path, size: source.length || 1, lastModified: stamp, async text() { assert.ok(readable, 'media and secrets must not be read as text'); return source; } };
}

test('local folder: case-sensitive TODO_RE ignores todo vars/Spanish, detects todo!() & captures context', async () => {
  const revoked: string[] = [];
  const files = [
    fixture('src/ui.ts', "const todo = { title: 'Todo empieza aquí' };\nexport const label = 'todo-app';", 100),
    fixture('src/billing.ts', "import './lib';\nfunction charge() {\n  // FIXME: prevent double charge\n  return true;\n}", 50),
    fixture('src/lib.rs', 'pub fn run() { todo!("wire handler") }', 40),
    fixture('src/lib.ts', 'export {}'),
    fixture('.env', 'PASSWORD=secret', 1, false),
  ];
  const d = await ingestLocalFiles(files, 'Eva', 'demo', (f) => 'blob:' + f.name, (u) => revoked.push(u));
  assert.ok(!d.todos.some((t) => t.path === 'src/ui.ts'), 'false positive todo var must be ignored');
  assert.equal(d.tapeClue.path, 'src/billing.ts');
  assert.equal(d.tapeClue.lineNumber, 3);
  assert.ok(d.todos.some((t) => t.path === 'src/lib.rs' && t.tag === 'STUB'));
  assert.match(d.todos[0].contextSnippet ?? '', /function charge/);
  const d2 = await ingestLocalFiles([fixture('other.ts', 'export const x = 1;')], 'Eva', 'demo');
  assert.notEqual(d.id, d2.id);
  d.dispose(); assert.deepEqual(revoked, d.galleryImages);
});

test('GitHub: monorepo with 10 manifests STILL samples source files & preserves partial data on 404 readme', async (t) => {
  const storage = new Map<string, string>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else Reflect.deleteProperty(globalThis, 'sessionStorage'); });

  const manyManifests = Array.from({ length: 10 }, (_, i) => `packages/p${i}/package.json`);
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/repos/owner/mono')) return Response.json({ name: 'Mono', default_branch: 'feat/v2', created_at: '2020-02-01' });
    if (url.endsWith('/commits?per_page=5')) return Response.json([{ sha: '2fa9999', commit: { message: 'wip monorepo', author: { date: '2023-04-05' } } }]);
    if (url.includes('/git/trees/')) return Response.json({ truncated: false, tree: [...manyManifests, 'src/app.ts', 'src/util.ts'].map((path) => ({ path, type: 'blob' })) });
    if (url.endsWith('/readme')) return new Response(null, { status: 404 });
    if (url.endsWith('/package.json')) return new Response(JSON.stringify({ scripts: { start: 'vite', test: 'node --test' } }));
    if (url.endsWith('/feat/v2/src/app.ts')) return new Response("import './util';\n// FIXME: handle reconnect");
    if (url.endsWith('/feat/v2/src/util.ts')) return new Response('export const ok = true;');
    return new Response(null, { status: 404 });
  };

  const d = await ingestGitHubRepo('owner/mono', 'Vera', fetcher);
  assert.equal(d.origin, 'GitHub');
  assert.equal(d.tapeClue.path, 'src/app.ts');
  assert.equal(d.tapeClue.lineNumber, 2);
  assert.ok(d.graph.importEdgeCount >= 1);
  assert.ok(storage.has('sd_gh_v3:owner/mono'));
});

test('Kiro export & triage: selectedTodoIds filters requirements.md, design.md, tasks.md & official v1 hook', async () => {
  const d = createPresetDossier('boundary', 'Eva');
  const engine = createStoryEngine(d, 'demo');
  engine.interactIslandPoi('tv');
  const bToggle = engine.toggleActiveTodoForKiro();
  assert.equal(bToggle.effect, 'toggle_tv_todo');
  const reqFiltered = formatKiroRequirementsMd(d, 'Note', 'en');
  assert.ok(!reqFiltered.includes('src/main.py:294'), 'deselected track must be omitted from requirements.md');
  assert.match(reqFiltered, /src\/main\.py:280/);
  const text = formatKiroRevivalSpec(d, 'restore', 'Check validation first');
  assert.match(text, /## 1\. Observed Facts/);
  assert.ok(!text.includes('Source: Carpeta'));
  const hook = JSON.parse(formatKiroHookJson(d));
  assert.equal(hook.version, 'v1');
  assert.equal(hook.hooks[0].trigger, 'PostTaskExecution');
  assert.equal(hook.hooks[0].enabled, false);
  assert.match(formatKiroDesignMd(d), /Hub module/);
  assert.match(formatKiroTasksMd(d, 'Note'), /src\/main\.py:280/);
  assert.equal(formatRecoveryCardMarkdown(d, 'archive', 'Done'), formatArchiveCard(d, 'Done'));

  const repoHook = JSON.parse(readFileSync(new URL('../.kiro/hooks/gardenos-regression.json', import.meta.url), 'utf8'));
  assert.equal(repoHook.version, 'v1');
  assert.equal(repoHook.hooks.length, 2);
  assert.match(repoHook.hooks[1].action.command, /tsc --noEmit/);
});

test('localStorage memory & receptionCues', () => {
  const data = { verdict: 'leave', creatorNote: 'Keep note' } as const;
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  assert.deepEqual(saveProjectMemory('a', data, store), { ok: true });
  assert.deepEqual(loadProjectMemory('a', store), data);
  assert.equal(typingMs('a, b'), 46 + 190 + 46);
  for (const id of ['trazo', 'boundary', 'sentinel-lab'] as const) for (const pace of ['demo', 'full'] as const) {
    const lines = createStoryEngine(createPresetDossier(id, 'Ada'), pace).getReceptionLines();
    const c = receptionCues(lines, pace, false);
    const cues = [c.l1, c.l2, c.l3, c.clr];
    lines.forEach((line, i) => assert.ok(cues[i + 1] - cues[i] >= lineSeconds(line) - 1e-9));
  }
});

test('bug 1.1: PRESET_CHIPS in login.ts lists BOUNDARY, Trazo, Sentinel Lab in that order', () => {
  const source = readFileSync(new URL('../src/gardenos/login.ts', import.meta.url), 'utf8');
  const literal = source.match(/export const PRESET_CHIPS[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(literal, 'PRESET_CHIPS literal must exist in login.ts');
  const ids = [...literal[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['boundary', 'trazo', 'sentinel-lab']);
});

test('bug 1.2: trazo preset has no fallback or eval-rule todo tracks', () => {
  const d = createPresetDossier('trazo', 'Ada');
  const forbidden = ['trazo-spa-fallback', 'trazo-eval-rule', 'trazo-sampler-fallback'];
  const present = d.todos.map((t) => t.id).filter((id) => forbidden.includes(id));
  assert.deepEqual(present, []);
});

test('bug 1.2: trazo preset has no todo track tagged STUB', () => {
  const d = createPresetDossier('trazo', 'Ada');
  const stubs = d.todos.filter((t) => t.tag === 'STUB').map((t) => t.id);
  assert.deepEqual(stubs, []);
});

test('bug 1.3: trazo tapeClue is a file clue at companionPathSampler.ts:216', () => {
  const clue = createPresetDossier('trazo', 'Ada').tapeClue;
  assert.equal(clue.kind, 'file');
  assert.equal(clue.path, 'src/utils/companionPathSampler.ts');
  assert.equal(clue.lineNumber, 216);
  assert.equal(clue.excerpt, '// Fallback: simple line if parsing yielded no segments');
});

test('bug 1.4: trazo tapeClue.interpretation starts with the Hypothesis (unconfirmed) label', () => {
  const label = 'Hypothesis (unconfirmed)';
  const interpretation = createPresetDossier('trazo', 'Ada').tapeClue.interpretation;
  assert.equal(interpretation.slice(0, label.length), label);
});

test('control: dossier modal buttons appear in BOUNDARY, TRAZO, Sentinel order in gardenos.html', () => {
  const html = readFileSync(new URL('../gardenos.html', import.meta.url), 'utf8');
  const positions = ['btnLoadBoundary', 'btnLoadTrazo', 'btnLoadSentinel'].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((p) => p >= 0), `button ids missing, positions: ${positions}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

// Preservation (Property 2). Values were observed on the unfixed code before these assertions were written.

test('preservation 3.1: boundary todo tracks keep exact id, path, lineNumber and tag', () => {
  const d = createPresetDossier('boundary', 'Ada');
  const tuple = (id: string) => {
    const t = d.todos.find((item) => item.id === id);
    assert.ok(t, `todo ${id} must exist`);
    return [t.id, t.path, t.lineNumber, t.tag];
  };
  assert.deepEqual(tuple('boundary-todo-report'), ['boundary-todo-report', 'src/main.py', 294, 'TODO']);
  assert.deepEqual(tuple('boundary-todo-validate'), ['boundary-todo-validate', 'src/main.py', 280, 'TODO']);
});

test('preservation 3.2: sentinel-lab todo tracks keep exact id, path, lineNumber and tag', () => {
  const d = createPresetDossier('sentinel-lab', 'Ada');
  const tuple = (id: string) => {
    const t = d.todos.find((item) => item.id === id);
    assert.ok(t, `todo ${id} must exist`);
    return [t.id, t.path, t.lineNumber, t.tag];
  };
  assert.deepEqual(tuple('sentinel-tape-timeout'), ['sentinel-tape-timeout', 'modulo-04-scanner/port_scanner.py', 64, 'TODO']);
  assert.deepEqual(tuple('sentinel-tape-cidr'), ['sentinel-tape-cidr', 'modulo-04-scanner/cidr_utils.py', 28, 'FIXME']);
});

test('preservation 3.2: sentinel-lab primary piece, tape clue and tower record keep DEMO provenance', () => {
  const d = createPresetDossier('sentinel-lab', 'Ada');
  assert.equal(d.primaryPiece.provenance, 'DEMO');
  assert.equal(d.tapeClue.provenance, 'DEMO');
  assert.equal(d.towerRecord.provenance, 'DEMO');
});

test('preservation 3.3: trazo gallery has 3 images, 5 commits and 4 run commands', () => {
  const d = createPresetDossier('trazo', 'Ada');
  assert.equal(d.galleryImages.length, 3);
  assert.equal(d.commits.length, 5);
  assert.equal(d.reentry.runCommands.length, 4);
});

test('preservation 3.5: PRESET_LIST order is trazo, boundary, sentinel-lab', () => {
  assert.deepEqual(PRESET_LIST.map((p) => p.id), ['trazo', 'boundary', 'sentinel-lab']);
});

test('preservation 3.5: login reset() defaults presetId to boundary', () => {
  const source = readFileSync(new URL('../src/gardenos/login.ts', import.meta.url), 'utf8');
  const reset = source.match(/\breset\(\)\s*\{([^}]*)\}/);
  assert.ok(reset, 'reset() must exist in login.ts');
  assert.match(reset[1], /presetId\s*=\s*'boundary'/);
});
test('chip order regression: login PRESET_CHIPS ids, labels and gardenos.html modal order agree', () => {
  const loginSource = readFileSync(new URL('../src/gardenos/login.ts', import.meta.url), 'utf8');
  const literal = loginSource.match(/export const PRESET_CHIPS[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(literal, 'PRESET_CHIPS literal must exist in login.ts');
  const chipIds = [...literal[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  const chipLabels = [...literal[1].matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chipIds, ['boundary', 'trazo', 'sentinel-lab']);
  assert.deepEqual(chipLabels, ['BOUNDARY', 'Trazo', 'Sentinel Lab']);

  const html = readFileSync(new URL('../gardenos.html', import.meta.url), 'utf8');
  const modalIds = ['btnLoadBoundary', 'btnLoadTrazo', 'btnLoadSentinel'];
  const positions = modalIds.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((p) => p >= 0), `modal button ids missing, positions: ${positions}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));

  const chipToModal: Record<string, string> = { boundary: 'btnLoadBoundary', trazo: 'btnLoadTrazo', 'sentinel-lab': 'btnLoadSentinel' };
  assert.deepEqual(chipIds.map((id) => chipToModal[id]), modalIds);
});
