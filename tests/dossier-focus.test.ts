import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/gardenos/main.ts', import.meta.url), 'utf8');

function functionBody(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `missing ${header}`);
  const end = source.indexOf('\n  };', start);
  assert.ok(end > start, `unterminated ${header}`);
  return source.slice(start, end);
}

test('bug condition: Kiro toggle re-render passes the kiro focus target', () => {
  const body = functionBody(mainSource, 'const toggleTodoInKiro = (todoId: string) => {');
  assert.match(body, /renderEvidence\(byId\('dosGrid'\), activeDossier, story, selectTodo, toggleTodoInKiro, 'kiro'\);/);
});

test('bug condition: Kiro toggle button carries a focus identifier', () => {
  assert.match(mainSource, /kiroBtn\.setAttribute\('data-kiro-toggle', ''\);/);
});

test('bug condition: focus helper resolves the Kiro toggle selector', async () => {
  const { focusSelectorFor } = await import('../src/gardenos/focus-target.ts');
  assert.equal(focusSelectorFor('kiro'), '[data-kiro-toggle]');
});

test('preservation: track buttons keep their index attribute and class', () => {
  assert.match(mainSource, /b\.dataset\.trackIdx = String\(i\);/);
  assert.match(mainSource, /el\('button', `\$\{picked \? '✓ ' : ''\}\$\{t\.tag\}[^`]*`, 'dosTrackBtn'\)/);
});

test('preservation: track selection still refocuses by passing its index', () => {
  const body = functionBody(mainSource, 'const selectTodo = (idx: number) => {');
  assert.match(body, /renderEvidence\(byId\('dosGrid'\), activeDossier, story, selectTodo, toggleTodoInKiro, idx\);/);
});

test('preservation: non-activation renders still pass no focus target', () => {
  assert.ok(mainSource.includes("renderEvidence(byId('dosGrid'), d, story, selectTodo, toggleTodoInKiro);"), 'refresh/mount call changed');
  assert.ok(mainSource.includes("renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro);"), 'language/story refresh call changed');
});

test('preservation: Tab cycling control list is unchanged', () => {
  assert.ok(mainSource.includes("modal.querySelectorAll<HTMLElement>('button,input,textarea')"));
});

test('preservation: track selector resolves to the track button', async () => {
  const { focusSelectorFor } = await import('../src/gardenos/focus-target.ts');
  assert.equal(focusSelectorFor(2), '.dosTrackBtn[data-track-idx="2"]');
});
