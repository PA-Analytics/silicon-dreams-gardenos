import type { ProjectDossier, TodoTrack, VerdictId } from './ingest.ts';
import type { Lang } from './i18n.ts';

// Redacted values are held as a private-use marker until the final render. Escaping never touches the marker.
const REDACTED = '\uE000';
const SENSITIVE_KEY = /token|secret|passw|pwd|apikey|api[_-]?key|credential|private[_-]?key|access[_-]?key|auth(?!or)/i;
const HYPOTHESIS = 'Hypothesis (unconfirmed)';

// Replaces secret-like values with the marker and keeps any key name visible.
function markSecrets(text: string): string {
  let out = text.replace(/[\uE000\uE001]/g, '');
  out = out.replace(/\b([A-Za-z_][\w.-]*)(["']?\s*[=:]\s*)(["']?)([^\s"'`,;&]+)\3/g,
    (match, key: string, sep: string, quote: string) => (SENSITIVE_KEY.test(key) ? `${key}${sep}${quote}${REDACTED}${quote}` : match));
  out = out.replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA|AIza)[A-Za-z0-9_-]{12,}/g, REDACTED);
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, (_m, keyword: string) => keyword + REDACTED);
  return out.replace(/[A-Za-z0-9_+=]{16,}/g, (token) => (isSecretLike(token) ? REDACTED : token));
}
// A long token with letters and digits is treated as a credential. Identifiers such as exp_0001_baseline_v2 are names and stay visible.
function isSecretLike(token: string): boolean {
  if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) return false;
  if (token.includes('_') && token.split('_').filter(Boolean).every((segment) => /^(?:[A-Za-z]+|\d+[a-z]*|v\d+)$/.test(segment))) return false;
  return true;
}
const renderRedacted = (text: string) => text.replace(/\uE000/g, '<redacted>');

// Redacts secret-like values in text that is written as-is, such as a code block.
export const redactSecrets = (text: string): string => renderRedacted(markSecrets(text));

const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, ' ').trim();
const plain = (text: string) => renderRedacted(oneLine(markSecrets(text)).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)).replace(/[\\`*_\[\]#!|]/g, '\\$&'));
function codeSpan(value: string): string {
  const fence = '`'.repeat(Math.max(0, ...Array.from(value.matchAll(/`+/g), (m) => m[0].length)) + 1);
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}
const literal = (text: string): string => renderRedacted(codeSpan(oneLine(markSecrets(text))));
// Git hashes are hex and would match the generic token rule, so a hex hash is shown as observed.
const hashLiteral = (hash: string): string => (/^[0-9a-f]{7,64}$/i.test(hash.trim()) ? codeSpan(hash.trim()) : literal(hash));
const slugOf = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72).replace(/-$/, '') || 'project';
const location = (d: ProjectDossier) => (d.tapeClue.path || 'unknown-path') + (d.tapeClue.lineNumber ? ':' + d.tapeClue.lineNumber : '');
// Configuration files hold data, so their markers are not code-behavior criteria.
const isConfigPath = (path: string) => /\.(?:json|ya?ml|toml|ini|cfg|conf|xml|properties)$/i.test(path) || /(^|\/)\.env[^/]*$/i.test(path);

// The visitor placeholder is not an author. Only a name the visitor typed counts.
function authorName(d: ProjectDossier): string | null {
  const name = d.visitorName?.trim();
  return name && name !== 'Visitor' ? plain(name) : null;
}
function creatorLabel(d: ProjectDossier): string {
  const name = authorName(d);
  return name ? `Creator note (${name}):` : 'Creator note:';
}
function hypothesis(text: string): string {
  const body = plain(text);
  return body.startsWith(HYPOTHESIS) ? body : `${HYPOTHESIS}: ${body}`;
}

function selectedTracks(d: ProjectDossier): TodoTrack[] {
  const all = d.todos ?? [];
  if (all.length === 0) return [];
  const picked = new Set(d.selectedTodoIds ?? all.map((t) => t.id));
  return all.filter((t) => picked.has(t.id));
}

function originLabel(origin: ProjectDossier['origin'], lang: Lang): string {
  if (origin === 'Carpeta') return lang === 'es' ? 'Carpeta local' : 'Local Folder';
  if (origin === 'Demo') return lang === 'es' ? 'Muestra' : 'Sample';
  return 'GitHub';
}

function header(d: ProjectDossier, lang: Lang): string[] {
  const ev = d.isDemo
    ? (lang === 'es' ? 'DEMO — expediente sintético de muestra, no un repo real.' : 'DEMO — synthetic sample fixture, not a real repository.')
    : d.presetId
      ? (lang === 'es' ? 'SNAPSHOT — instantánea empaquetada de un repo real.' : 'SNAPSHOT — bundled read-only snapshot from a real repository.')
      : (lang === 'es' ? 'ORIGINAL — lectura directa en navegador.' : 'ORIGINAL — read-only live scan.');
  return [
    `- Project: ${plain(d.projectName)}`,
    `- Source: ${originLabel(d.origin, lang)} · ${plain(d.sourceLabel)}`,
    `- Archetype: ${plain(d.reentry.archetypeLabel)} (${d.reentry.archetype})`,
    `- Date (UTC): ${new Date().toISOString().slice(0, 10)}`,
    `- Provenance: ${ev}`,
    ...(d.fallbackReason ? [`- Fallback reason: ${plain(d.fallbackReason)}`] : []),
  ];
}

function observations(d: ProjectDossier): string[] {
  const files = [...new Set([d.primaryPiece.path, d.tapeClue.path, d.towerRecord.path, ...d.todos.map((t) => t.path)].filter(Boolean))];
  const commits = d.commits.length
    ? d.commits.slice(0, 5).map((c) => `  - ${hashLiteral(c.hash)} (${plain(c.date)}): ${plain(c.message)}`).join('\n')
    : '  - No git commit history available in this scan.';
  const tracks = selectedTracks(d);
  const todoBlock = d.todos.length
    ? `- Discovered TODO/FIXME tracks (${tracks.length}/${d.todos.length} selected for Kiro):\n` +
      d.todos.map((t) => `  - [${tracks.some((s) => s.id === t.id) ? 'x' : ' '}] ${literal(`${t.path}:${t.lineNumber}`)} [${t.tag}]: ${literal(t.excerpt)}`).join('\n')
    : '- No TODO/FIXME line markers verified in sampled files.';
  return [
    `- Inventory: ${d.knownTotalFiles} known files (${d.sampledFiles} sampled). Key paths: ${files.length ? files.slice(0, 8).map(literal).join(', ') : 'none'}.`,
    `- Graph: ${d.graph.nodes.length} mapped nodes, ${d.graph.edges.length} edges (${d.graph.importEdgeCount} real local imports), hub ${literal(d.graph.hubLabel || 'none')}.`,
    `- Recent commits:\n${commits}`,
    `- Primary trace: ${literal(location(d))} — ${plain(d.tapeClue.observedFact)}`,
    todoBlock,
    `- Declared launch/build commands (unverified): ${d.reentry.runCommands.length ? d.reentry.runCommands.map(literal).join(', ') : 'none verified'}.`,
    `- Declared test command (unverified): ${d.reentry.testCommand ? literal(d.reentry.testCommand) : 'none verified'}.`,
    `- Environment hints: ${d.reentry.envHints.length ? d.reentry.envHints.map(literal).join(', ') : 'none detected'}.`,
  ];
}

export function formatKiroHookJson(dossier: ProjectDossier): string {
  const name = redactSecrets(dossier.projectName);
  const test = dossier.reentry.testCommand;
  // A test command that redaction would alter is not emitted as an executable hook action.
  const command = test && redactSecrets(test) === test ? test : null;
  const hook = {
    version: 'v1',
    hooks: [
      {
        name: command ? `Verify ${name} revival` : `Manual check for ${name}`,
        description: command
          ? 'Generated by Silicon Dreams: runs the test command declared in the manifest (unverified) after a revival spec task finishes.'
          : 'Generated by Silicon Dreams: prompts for a manual verification when no test runner was detected.',
        trigger: 'PostTaskExec',
        enabled: false,
        action: command
          ? { type: 'command', command }
          : { type: 'agent', prompt: 'manual: ask the creator to verify the change against the baseline and record the result. Do not invent test commands.' },
      },
    ],
  };
  return JSON.stringify(hook, null, 2);
}

export function formatKiroDesignMd(dossier: ProjectDossier, lang: Lang = 'en'): string {
  const hubs = dossier.graph.nodes.slice().sort((a, b) => b.weight - a.weight).slice(0, 6);
  const tracks = selectedTracks(dossier).filter((t) => t.contextSnippet);
  const intro = lang === 'es'
    ? 'Resumen arquitectónico derivado únicamente del grafo, manifiestos y contexto de código leído.'
    : 'Architecture summary derived strictly from the read dependency graph, manifests, and code context.';
  const ctxSection = tracks.length > 0
    ? ['', '## Code Context Around Selected Tracks', ...tracks.slice(0, 3).flatMap((t) => [`### ${literal(`${t.path}:${t.lineNumber}`)}`, '```', redactSecrets(t.contextSnippet!), '```'])]
    : [];
  return [
    `# Design — ${plain(dossier.projectName)}`,
    '',
    intro,
    '',
    `- **Hub module:** ${literal(dossier.graph.hubLabel || 'not resolved')}`,
    `- **Graph coupling:** ${dossier.graph.nodes.length} nodes · ${dossier.graph.importEdgeCount} local import edges · ${dossier.graph.edges.length - dossier.graph.importEdgeCount} folder links`,
    `- **Top connected modules:** ${hubs.length ? hubs.map((n) => literal(n.id)).join(', ') : 'none'}`,
    `- **Environment variables / config:** ${dossier.reentry.envHints.length ? dossier.reentry.envHints.map(literal).join(', ') : 'none verified'}`,
    `- **Commits inspected (${dossier.commits.length}):** ${dossier.commits.length ? dossier.commits.map((c) => `${hashLiteral(c.hash)} ${plain(c.message)}`).join(' · ') : 'none'}`,
    ...ctxSection,
  ].join('\n');
}

export function formatKiroTasksMd(dossier: ProjectDossier, creatorNote: string, lang: Lang = 'en'): string {
  // creatorNote is intentionally unused here: creator notes stay in their own section and never become tasks.
  void creatorNote;
  const first = dossier.reentry.runCommands[0];
  const test = dossier.reentry.testCommand;
  const picked = selectedTracks(dossier).slice(0, 4);
  const tasks = picked.map((t) => {
    const loc = t.lineNumber ? `${t.path}:${t.lineNumber}` : t.path;
    return isConfigPath(t.path)
      ? `- [ ] Review the configuration at ${literal(loc)} and confirm the marker text ${literal(t.excerpt)}.`
      : `- [ ] Inspect ${literal(loc)} and resolve ${literal(t.excerpt)}.`;
  });
  if (tasks.length === 0) {
    tasks.push(dossier.todos.length === 0
      ? `- ${HYPOTHESIS} example, not a verified marker and not a task: ${literal(dossier.tapeClue.excerpt)} appears near ${literal(location(dossier))}.`
      : '- [ ] Review the observed repository inventory and pick the next target module.');
  }
  tasks.push(first
    ? `- [ ] Verify the declared manifest command ${literal(first)} in a clean local environment. Declared in manifest (unverified).`
    : '- [ ] Identify and document the entry point before running changes.');
  tasks.push(test
    ? `- [ ] Run ${literal(test)} and confirm baseline pass/fail status. Declared in manifest (unverified).`
    : '- [ ] Document one reproducible manual check and expected output.');
  return [lang === 'es' ? '# Tasks (Primeros pasos en Kiro)' : '# Tasks (First Steps in Kiro)', '', ...tasks].join('\n');
}

export function formatKiroRequirementsMd(dossier: ProjectDossier, creatorNote: string, lang: Lang = 'en'): string {
  const d = dossier;
  const project = plain(d.projectName);
  const first = d.reentry.runCommands[0];
  const test = d.reentry.testCommand;
  const tracks = selectedTracks(d).slice(0, 4);
  const ears: string[] = [];
  if (tracks.length > 0) {
    tracks.forEach((t, idx) => {
      const ref = literal(`${t.path}:${t.lineNumber}`);
      ears.push(isConfigPath(t.path)
        ? `${idx + 1}. WHEN the configuration at ${ref} is revisited, THE ${project} SHALL review the marker text ${literal(t.excerpt)} as a documented note and confirm the intended value with a reproducible check.`
        : `${idx + 1}. WHEN the code at ${ref} is exercised, THE SYSTEM SHALL resolve ${literal(t.excerpt)} with a reproducible verification check.`);
    });
  } else if (d.todos.length === 0) {
    ears.push(`1. ${HYPOTHESIS} example: WHEN the component at ${literal(location(d))} is reopened, THE SYSTEM SHALL preserve the observed baseline behavior before modifications.`);
  } else {
    ears.push('1. WHEN all TODO tracks are deselected in triage, THE SYSTEM SHALL preserve the repository baseline without inventing extra requirements.');
  }
  const n1 = ears.length + 1;
  const hints = d.reentry.envHints.length ? d.reentry.envHints.slice(0, 3).map(literal).join(', ') : 'none detected';
  ears.push(first
    ? `${n1}. Declared in manifest (unverified): launch command ${literal(first)}. Silicon Dreams did not run it. Environment hints: ${hints}.`
    : `${n1}. WHEN no launch script is verified in manifests, THE SYSTEM SHALL require manual entry-point confirmation before automation.`);
  ears.push(test
    ? `${n1 + 1}. Declared in manifest (unverified): test command ${literal(test)}. Silicon Dreams did not run it. Run it and record its exit status before marking a revival task complete.`
    : `${n1 + 1}. WHEN no test runner is verified, THE SYSTEM SHALL require a documented manual verification check before marking a task complete.`);

  return [
    `# Requirements — ${project}`,
    '',
    `> ${hypothesis(d.tapeClue.interpretation)}`,
    ...(creatorNote.trim() ? [`> ${creatorLabel(d)} ${plain(creatorNote)}`] : []),
    '',
    '## Acceptance Criteria (EARS)',
    ...ears,
    '',
    lang === 'es' ? plain(d.honestyNoteEs || d.honestyNote) : plain(d.honestyNote),
  ].join('\n');
}

export function formatKiroRevivalSpec(dossier: ProjectDossier, verdict: VerdictId | null, creatorNote: string, lang: Lang = 'en'): string {
  const d = dossier;
  const slug = slugOf(redactSecrets(d.projectName));
  const verdictLabels: Record<VerdictId, string> = {
    archive: lang === 'es' ? 'Archivar' : 'Archive',
    restore: lang === 'es' ? 'Restaurar' : 'Restore in Kiro',
    leave: lang === 'es' ? 'Dejar inconcluso' : 'Leave Unfinished',
  };
  const noteBlock = creatorNote.trim() ? creatorNote.trim().split(/\r?\n/).map((line) => '> ' + plain(line)).join('\n') : '_No creator note supplied._';
  const author = authorName(d);
  const reqLines = formatKiroRequirementsMd(d, creatorNote, lang).split('## Acceptance Criteria (EARS)\n')[1]?.split('\n\n')[0] || '';
  return [
    `# Kiro Revival Pack — ${plain(d.projectName)}`,
    `Target folder: \`.kiro/specs/revive-${slug}/\``,
    '',
    ...header(d, lang),
    `- Decision: ${verdict ? verdictLabels[verdict] : 'Pending'}`,
    '',
    '## 1. Observed Facts (Verified Read-Only)',
    ...observations(d),
    '',
    '## 2. Hypothesis (Unconfirmed)',
    hypothesis(d.tapeClue.interpretation),
    '',
    `## 3. Creator Note${author ? ` (${author})` : ''}`,
    noteBlock,
    '',
    '## 4. Requirements (EARS — requirements.md)',
    reqLines,
    '',
    '## 5. Architecture & Context (design.md)',
    formatKiroDesignMd(d, lang),
    '',
    '## 6. Revival Checklist (tasks.md)',
    formatKiroTasksMd(d, creatorNote, lang).split('\n').slice(2).join('\n'),
    '',
    '## 7. Suggested Kiro v1 Hook (.kiro/hooks/revival-check.json)',
    'Disabled by default (`enabled: false`). Review the command before enabling in Kiro.',
    '```json',
    formatKiroHookJson(d),
    '```',
    '',
    lang === 'es' ? plain(d.honestyNoteEs || d.honestyNote) : plain(d.honestyNote),
    '',
  ].join('\n');
}

export function formatArchiveCard(dossier: ProjectDossier, creatorNote: string, lang: Lang = 'en'): string {
  const noteBlock = creatorNote.trim() ? creatorNote.trim().split(/\r?\n/).map((line) => '> ' + plain(line)).join('\n') : '_No creator note supplied._';
  const author = authorName(dossier);
  return [
    `# ARCHIVE_CARD.md — ${plain(dossier.projectName)}`,
    '',
    ...header(dossier, lang),
    '',
    '## Observed State at Archive',
    ...observations(dossier),
    '',
    `## Creator Note${author ? ` (${author})` : ''}`,
    noteBlock,
    '',
    '## Decision',
    lang === 'es' ? 'Conservar el proyecto tal como quedó. Esta ficha no modifica ni elimina archivos.' : 'Preserve the project as it stood. This card never modifies or deletes files and schedules no reactivation tasks.',
    '',
    lang === 'es' ? plain(dossier.honestyNoteEs || dossier.honestyNote) : plain(dossier.honestyNote),
    '',
  ].join('\n');
}

export interface SavedProjectMemory { creatorNote: string; verdict: VerdictId | null; savedAt?: string }
type MemoryStore = Pick<Storage, 'getItem' | 'setItem'>;
const memoryKey = (id: string) => 'sd_memory_v1:' + id;
function isMemory(value: unknown): value is SavedProjectMemory {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<SavedProjectMemory>;
  return typeof m.creatorNote === 'string' && (m.verdict === null || m.verdict === 'archive' || m.verdict === 'restore' || m.verdict === 'leave') && (m.savedAt === undefined || typeof m.savedAt === 'string');
}
export function loadProjectMemory(projectId: string, storage?: Pick<MemoryStore, 'getItem'>): SavedProjectMemory | null {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(memoryKey(projectId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isMemory(value) ? value : null;
  } catch { return null; }
}
// Never throws: String() is used instead of template literals so Symbol or throwing name/message fields cannot escape the catch block.
function describeStorageError(error: unknown): string {
  try {
    if (error instanceof Error) return `${String(error.name)}: ${String(error.message)}`;
  } catch { /* fall through to the generic message */ }
  return 'Storage unavailable.';
}
export function saveProjectMemory(projectId: string, data: SavedProjectMemory, storage?: Pick<MemoryStore, 'setItem'>): { ok: boolean; error?: string } {
  try {
    if (!isMemory(data)) return { ok: false, error: 'Invalid project memory record.' };
    (storage ?? globalThis.localStorage).setItem(memoryKey(projectId), JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeStorageError(error) };
  }
}
