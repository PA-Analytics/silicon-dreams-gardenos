import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPresetDossier, detectArchetype, detectReentryPlan, ingestGitHubRepo, ingestLocalFiles, formatRecoveryCardMarkdown } from '../src/gardenos/ingest.ts';
import type { LocalFileLike } from '../src/gardenos/ingest.ts';
import { buildRepoGraph, extractLocalImports } from '../src/gardenos/repo-graph.ts';
import { formatArchiveCard, formatKiroDesignMd, formatKiroHookJson, formatKiroRequirementsMd, formatKiroRevivalSpec, formatKiroTasksMd, loadProjectMemory, saveProjectMemory } from '../src/gardenos/kiro-export.ts';
import { createStoryEngine, lineSeconds, receptionCues, typingMs } from '../src/gardenos/story.ts';

for (const id of ['trazo', 'boundary', 'sentinel-lab'] as const) {
  test(`preset ${id}: provenance, real metadata & no local workstation paths`, () => {
    const d = createPresetDossier(id, ' Ada ');
    assert.equal(d.presetId, id);
    assert.equal(d.visitorName, 'Ada');
    assert.equal(d.isDemo, id === 'sentinel-lab');
    assert.ok(d.knownTotalFiles >= d.graph.nodes.length);
    assert.ok(d.graph.edges.length > 0);
    assert.ok(d.todos.length >= 2);
    assert.ok(d.reentry.runCommands.length > 0);
    assert.ok(!/C:\\disco/i.test(d.sourceLabel + d.honestyNote + d.primaryPiece.path));
    assert.ok(!d.todos.some((t) => /Todo empieza/.test(t.excerpt)));
    const expectedProv = d.isDemo ? 'DEMO' : 'SNAPSHOT';
    for (const p of [d.primaryPiece, d.tapeClue, d.towerRecord]) assert.equal(p.provenance, expectedProv);
    if (id === 'trazo') { assert.equal(d.galleryImages.length, 3); assert.equal(d.tapeClue.lineNumber, 216); }
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