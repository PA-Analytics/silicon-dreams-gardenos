import { PRESETS } from './presets.ts';
import type { PresetId, RepoArchetype, PresetCommit } from './presets.ts';
import { buildRepoGraph, extractLocalImports } from './repo-graph.ts';
import type { RepoGraph } from './repo-graph.ts';
import { formatKiroRevivalSpec, formatArchiveCard } from './kiro-export.ts';

export type { PresetId, RepoArchetype } from './presets.ts';
export type Origin = 'Demo' | 'GitHub' | 'Carpeta';
export type CommitInfo = PresetCommit;
export type ProvenanceTag = 'ORIGINAL' | 'SNAPSHOT' | 'INTERPRETACION' | 'DEMO';

export interface ReentryPlan {
  archetype: RepoArchetype;
  archetypeLabel: string;
  runCommands: string[];
  testCommand: string | null;
  envHints: string[];
  nextSteps: string[];
}

export interface TodoTrack {
  id: string;
  path: string;
  lineNumber: number;
  excerpt: string;
  contextSnippet?: string;
  tag: 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'STUB';
  score: number;
}

type ProjectImage = { url: string; path: string; name: string };

export interface ArtifactPiece {
  id: string;
  title: string;
  path: string;
  kind: 'image' | 'readme' | 'unfinished' | 'file';
  provenance: ProvenanceTag;
  observedFact: string;
  interpretation: string;
  excerpt: string;
  dateLabel: string | null;
  lineNumber?: number;
  imageUrl?: string;
}

export interface CategoryCounts {
  images: number;
  docs: number;
  code: number;
  media3d: number;
  other: number;
}

export interface ProjectDossier {
  id: string;
  origin: Origin;
  presetId?: PresetId;
  visitorName: string;
  projectName: string;
  sourceLabel: string;
  isDemo: boolean;
  fallbackReason?: string;
  partialWarnings: string[];
  fileCount: number;
  knownTotalFiles: number;
  sampledFiles: number;
  categoryCounts: CategoryCounts;
  oldestDate: string | null;
  newestDate: string | null;
  dormantLabel: string | null;
  commits: CommitInfo[];
  graph: RepoGraph;
  reentry: ReentryPlan;
  archetype: RepoArchetype;
  archetypeLabel: string;
  todos: TodoTrack[];
  selectedTodoIds: string[];
  activeTodoIndex: number;
  primaryImage: ProjectImage | null;
  galleryImages: string[];
  primaryPiece: ArtifactPiece;
  tapeClue: ArtifactPiece;
  towerRecord: ArtifactPiece;
  honestyNote: string;
  honestyNoteEs?: string;
  dispose(): void;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const DOC_EXT = /\.(md|markdown|txt|rst|org|rtf|pdf)$/i;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|cs|cpp|c|h|hpp|java|kt|html|css|scss|json|yaml|yml|toml|gd|lua|sh|sql|wrl)$/i;
const MEDIA3D_EXT = /\.(blend|glb|gltf|fbx|obj|stl|dae|wrl|wav|mp3|ogg|flac|mp4|webm|psd|aseprite|kra)$/i;
const TEXT_READABLE_EXT = /\.(?:md|markdown|rst|txt|toml|mod|[cm]?[jt]sx?|py|rs|go|cs|html|css|gd|lua|c|cpp|h|java|kt|json|ya?ml)$/i;
const SOURCE_CODE_EXT = /\.(?:[cm]?[jt]sx?|py|rs|go|cs|java|kt|gd|lua|c|cpp|h)$/i;
const IGNORED_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|\.cache|__pycache__|target|Library|Temp)\//i;
// Case-sensitive TODO|FIXME|HACK|XXX inside comments or doc tasks, plus explicit code stub markers.
const COMMENT_TODO_RE = /(?:\/\/|#|\/\*|--|<!--)\s*(?:[-*]\s*)?\b(TODO|FIXME|HACK|XXX)\b(?:[:\s\-(]|$)/;
const DOC_TODO_RE = /^(?:[-*]|\[[ xX]\])?\s*\b(TODO|FIXME)\b[:\s\-]/;
const STUB_CODE_RE = /\b(?:todo!|unimplemented!)\s*\(|\bNotImplementedError\b|panic\(\s*["'][^"']*not implemented/i;

export function formatShortDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function describeDormancy(newestMs: number | null, nowMs = Date.now()): string | null {
  if (!newestMs || !Number.isFinite(newestMs)) return null;
  const days = Math.max(0, Math.floor((nowMs - newestMs) / 86_400_000));
  if (days < 1) return 'updated today';
  if (days === 1) return 'last change 1 day ago';
  if (days < 45) return `last change ${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `dormant ~${months} months`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `dormant ~${years} years`;
}

function classifyPath(path: string): keyof CategoryCounts {
  if (IMAGE_EXT.test(path)) return 'images';
  if (DOC_EXT.test(path)) return 'docs';
  if (MEDIA3D_EXT.test(path)) return 'media3d';
  if (CODE_EXT.test(path)) return 'code';
  return 'other';
}

function cleanSnippet(raw: string, maxChars = 240): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('![') && !l.startsWith('---'));
  const joined = lines.slice(0, 5).join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars - 1).trimEnd() + '…';
}

function fnv1aHex(parts: string[]): string {
  let h = 0x811c9dc5;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x0a; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function findTodosInFile(path: string, text: string, recencyRank = 0): TodoTrack[] {
  const hits: TodoTrack[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const isCode = SOURCE_CODE_EXT.test(path);
  const isDoc = /(?:^|\/)readme/i.test(path) || DOC_EXT.test(path);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.length > 320) continue;
    let tag: TodoTrack['tag'] | null = null;
    let matchIdx = 0;
    const cm = COMMENT_TODO_RE.exec(raw);
    if (cm) { tag = cm[1] as TodoTrack['tag']; matchIdx = cm.index; }
    else if (isCode && STUB_CODE_RE.test(raw)) { tag = 'STUB'; matchIdx = 0; }
    else if (isDoc) {
      const dm = DOC_TODO_RE.exec(raw);
      if (dm) { tag = dm[1] as TodoTrack['tag']; matchIdx = dm.index; }
    }
    if (!tag) continue;
    let score = isCode ? 65 : isDoc ? 10 : 30;
    if (tag === 'FIXME' || tag === 'HACK' || tag === 'STUB') score += 20;
    if (/billing|auth|security|payment|validate|checkout|scanner|main|server|index|app/i.test(path)) score += 15;
    score += Math.max(0, 12 - recencyRank);
    const start = Math.max(0, matchIdx - 12);
    const ctxLines: string[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 2); k++) {
      ctxLines.push(`${k + 1}: ${lines[k].slice(0, 120)}`);
    }
    hits.push({
      id: `${path}:${i + 1}`,
      path,
      lineNumber: i + 1,
      excerpt: raw.slice(start, start + 150),
      contextSnippet: ctxLines.join('\n'),
      tag,
      score,
    });
    if (hits.length >= 4) break;
  }
  return hits;
}

function summarizeCounts(c: CategoryCounts): string {
  const parts: string[] = [];
  if (c.code) parts.push(`${c.code} code`);
  if (c.docs) parts.push(`${c.docs} docs`);
  if (c.images) parts.push(`${c.images} images`);
  if (c.media3d) parts.push(`${c.media3d} 3D/audio`);
  if (c.other) parts.push(`${c.other} other`);
  return parts.join(', ') || 'no recognized types';
}

export function createExampleDossier(visitorName: string, fallbackReason?: string): ProjectDossier {
  return createPresetDossier('sentinel-lab', visitorName, fallbackReason);
}

export interface LocalFileLike {
  name: string;
  size: number;
  lastModified: number;
  webkitRelativePath?: string;
  text(): Promise<string>;
}

const MANIFEST_NAME = /^(?:package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Makefile|Dockerfile|(?:docker-)?compose\.ya?ml|\.env\.example)$/i;
function isManifestPath(path: string): boolean {
  const leaf = path.slice(path.lastIndexOf('/') + 1);
  return MANIFEST_NAME.test(leaf);
}

function eligiblePath(path: string): boolean {
  return !!path && !IGNORED_DIRS.test(path) && !/(^|\/)\.env(?:$|\.(?!example$))|\.(?:pem|key|p12|pfx)$/i.test(path);
}

function rankedImages(paths: string[]): string[] {
  const score = (p: string) => (/preview|screen|capture|cover|hero|render/i.test(p) ? 2 : /icon|sprite|logo/i.test(p) ? 0 : 1);
  return paths.filter((p) => IMAGE_EXT.test(p)).sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

export async function ingestLocalFiles(
  files: ArrayLike<LocalFileLike>,
  visitorName: string,
  folderName: string,
  createObjectUrl: (f: LocalFileLike) => string | null = (f) => (typeof Blob !== 'undefined' && f instanceof Blob ? URL.createObjectURL(f) : null),
  revokeObjectUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
): Promise<ProjectDossier> {
  const list = Array.from(files);
  const root = list.find((f) => f.webkitRelativePath)?.webkitRelativePath?.replace(/\\/g, '/').split('/')[0];
  const name = folderName.trim() || root || 'Local Project';
  const inventory = new Map<string, LocalFileLike>();
  for (const f of list) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const path = f.webkitRelativePath && root && rel.startsWith(root + '/') ? rel.slice(root.length + 1) : rel;
    if (eligiblePath(path)) inventory.set(path, f);
  }
  const paths = [...inventory.keys()].sort();
  const docs = new Map<string, string>();
  const recent = paths.filter((p) => inventory.get(p)!.lastModified > 0).sort((a, b) => inventory.get(b)!.lastModified - inventory.get(a)!.lastModified);
  const planFiles = paths.filter((p) => isManifestPath(p) || /(^|\/)readme(?:\.|$)/i.test(p));
  const selected = buildRepoGraph(paths).nodes.map((n) => n.id);
  const codeFirst = paths.filter((p) => SOURCE_CODE_EXT.test(p));
  const candidates = [...new Set([...planFiles, ...recent, ...codeFirst, ...selected, ...paths])]
    .filter((p) => (TEXT_READABLE_EXT.test(p) || isManifestPath(p) || /^readme$/i.test(p)) && inventory.get(p)!.size <= 192 * 1024)
    .slice(0, 256);

  for (const p of candidates) {
    try { docs.set(p, (await inventory.get(p)!.text()).slice(0, 192 * 1024)); } catch { /* skip */ }
  }
  const images: ProjectImage[] = [];
  for (const path of rankedImages(paths)) {
    const f = inventory.get(path)!;
    if (f.size <= 0 || f.size > 14 * 1024 * 1024) continue;
    try { const url = createObjectUrl(f); if (url) images.push({ url, path, name: f.name }); } catch { /* skip */ }
    if (images.length === 3) break;
  }
  const urls = new Set(images.map((i) => i.url));
  const dispose = () => { for (const url of urls) { revokeObjectUrl(url); urls.delete(url); } };
  const ms = (p?: string) => (p ? inventory.get(p)?.lastModified ?? 0 : 0);
  const fingerprint = fnv1aHex(paths.slice(0, 80));
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'folder';
  try {
    return assemble({
      id: `local:${slug}:${fingerprint}`,
      origin: 'Carpeta',
      visitorName,
      projectName: name,
      sourceLabel: `Local folder · ${name}`,
      paths,
      knownTotalFiles: paths.length,
      sampledFiles: docs.size,
      partialWarnings: [],
      docs,
      images,
      commits: [],
      oldest: ms(recent.at(-1)),
      newest: ms(recent[0]),
      latestPath: recent[0],
      recentOrder: recent,
      honestyNote: `Read-only in-browser scan of ${paths.length} local files (${docs.size} text files read). Nothing left your browser.`,
      honestyNoteEs: `Lectura local de solo lectura sobre ${paths.length} archivos (${docs.size} leídos en el navegador). Nada salió de tu equipo.`,
      dispose,
    });
  } catch (error) { dispose(); throw error; }
}

export function parseGitHubOwnerRepo(input: string): { owner: string; repo: string } | null {
  const m = input.trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m && m[2] !== '.' && m[2] !== '..' ? { owner: m[1], repo: m[2] } : null;
}

function rankGitHubManifests(allPaths: string[]): string[] {
  return allPaths.filter((p) => isManifestPath(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, 4);
}

function rankGitHubSourceFiles(allPaths: string[]): string[] {
  const score = (p: string): number => {
    if (!SOURCE_CODE_EXT.test(p)) return -1;
    let s = 30;
    if (/^(?:src|app|lib|server|api|core|crates|cmd|pkg|packages\/[^/]+\/src|apps\/[^/]+\/src)\//i.test(p)) s += 35;
    if (/(?:main|index|app|server|cli|billing|auth|scanner|router|routes)\./i.test(p)) s += 25;
    if (/test|spec|__tests__|fixtures|mock/i.test(p)) s -= 12;
    s -= Math.min(20, p.split('/').length * 3);
    return s;
  };
  return allPaths.filter((p) => !isManifestPath(p) && SOURCE_CODE_EXT.test(p)).sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, 10);
}

export async function ingestGitHubRepo(
  repoUrl: string,
  visitorName: string,
  fetchImpl: typeof fetch = fetch,
  token?: string,
): Promise<ProjectDossier> {
  const parsed = parseGitHubOwnerRepo(repoUrl);
  if (!parsed) return createExampleDossier(visitorName, 'Invalid GitHub link: expected owner/repo.');
  const full = `${parsed.owner}/${parsed.repo}`;
  const key = 'sd_gh_v3:' + full.toLowerCase();
  if (!token) {
    try {
      const cached = globalThis.sessionStorage?.getItem(key);
      if (cached) {
        const d: ProjectDossier = JSON.parse(cached);
        if (d.id === 'github:' + full.toLowerCase() && d.origin === 'GitHub' && d.graph && d.reentry && Array.isArray(d.commits)) {
          return { ...d, visitorName: visitorName.trim() || 'Visitor', dispose() {} };
        }
      }
    } catch { /* sessionStorage optional */ }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  async function request<T>(endpoint: string): Promise<T> {
    const res = await fetchImpl(`https://api.github.com/repos/${full}${endpoint}`, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const detail = res.status === 403 ? ' (rate-limited or forbidden)' : res.status === 404 ? ' (private or not found)' : '';
      throw new Error(`GitHub HTTP ${res.status} on ${full}${endpoint}${detail}.`);
    }
    return res.json() as Promise<T>;
  }

  try {
    const meta = await request<{ name: string; default_branch: string; created_at?: string; pushed_at?: string; description?: string | null }>('');
    const branchRaw = meta.default_branch || 'main';
    const branchApi = encodeURIComponent(branchRaw);
    const branchPath = branchRaw.split('/').map(encodeURIComponent).join('/');
    const partialWarnings: string[] = [];

    const [treeRes, historyRes] = await Promise.all([
      request<{ tree: { type: string; path: string }[]; truncated?: boolean }>(`/git/trees/${branchApi}?recursive=1`).catch((e) => {
        partialWarnings.push(`Tree unavailable (${e instanceof Error ? e.message : String(e)}).`);
        return null;
      }),
      request<{ sha: string; commit: { message: string; author?: { date: string }; committer?: { date: string } } }[]>('/commits?per_page=5').catch((e) => {
        partialWarnings.push(`Commits unavailable (${e instanceof Error ? e.message : String(e)}).`);
        return null;
      }),
    ]);

    const rawEntries = treeRes?.tree ?? [];
    const all = rawEntries.filter((e) => e.type === 'blob' && eligiblePath(e.path)).map((e) => e.path);
    const knownTotalFiles = treeRes?.truncated ? Math.max(all.length, rawEntries.length) : all.length;
    if (treeRes?.truncated) partialWarnings.push(`GitHub tree truncated (${all.length} eligible paths inspected).`);

    const readmePath = all.find((p) => /^readme(?:\.|$)/i.test(p)) ?? all.find((p) => /^(?:docs|\.github)\/readme(?:\.|$)/i.test(p)) ?? 'README.md';
    const manifests = rankGitHubManifests(all);
    const sourceSamples = rankGitHubSourceFiles(all);
    const previewPaths = rankedImages(all).slice(0, 3);
    const paths = [...new Set([readmePath, ...manifests, ...previewPaths, ...sourceSamples, ...all])].filter((p) => all.includes(p)).slice(0, 250);

    const docs = new Map<string, string>();
    async function fetchRaw(path: string): Promise<boolean> {
      const rawUrl = `https://raw.githubusercontent.com/${full}/${branchPath}/${path.split('/').map(encodeURIComponent).join('/')}`;
      try {
        const r = await fetchImpl(rawUrl, { signal: ctrl.signal });
        if (!r.ok) return false;
        const txt = await r.text();
        if (txt) docs.set(path, txt.slice(0, 192 * 1024));
        return true;
      } catch { return false; }
    }

    async function fetchReadmeApi(): Promise<void> {
      try {
        const d = await request<{ content?: string; encoding?: string; path?: string }>('/readme');
        if (typeof d.content !== 'string') return;
        const text = d.encoding === 'base64' ? new TextDecoder().decode(Uint8Array.from(atob(d.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))) : d.content;
        docs.set(d.path || readmePath, text.slice(0, 192 * 1024));
      } catch {
        const ok = await fetchRaw(readmePath);
        if (!ok) partialWarnings.push('README missing or skipped while keeping repository data.');
      }
    }

    // Dedicated quotas: up to 4 manifests AND up to 10 source code files (never crowded out by monorepo manifests).
    const targetDocs = [...new Set([...manifests, ...sourceSamples])].filter((p) => p !== readmePath);
    await Promise.all([
      fetchReadmeApi(),
      ...targetDocs.map(async (p) => {
        const ok = await fetchRaw(p);
        if (!ok && isManifestPath(p)) {
          try {
            const d = await request<{ content?: string; encoding?: string; path?: string }>(`/contents/${encodeURIComponent(p)}`);
            if (typeof d.content === 'string') {
              const text = d.encoding === 'base64' ? new TextDecoder().decode(Uint8Array.from(atob(d.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))) : d.content;
              docs.set(d.path || p, text.slice(0, 192 * 1024));
            }
          } catch { /* partial ok */ }
        }
      }),
    ]);

    const commits: CommitInfo[] = (historyRes ?? []).slice(0, 5).map((c) => ({
      hash: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      date: (c.commit.committer?.date || c.commit.author?.date || '').slice(0, 10),
    }));
    const images = previewPaths.map((path) => ({
      path,
      name: path.split('/').pop()!,
      url: `https://raw.githubusercontent.com/${full}/${branchPath}/${path.split('/').map(encodeURIComponent).join('/')}`,
    }));

    const finalPaths = paths.length > 0 ? paths : [...docs.keys()];
    const warnNote = partialWarnings.length > 0 ? ` Notes: ${partialWarnings.join(' ')}` : '';
    const known = Math.max(knownTotalFiles, finalPaths.length);
    const dossier = assemble({
      id: 'github:' + full.toLowerCase(),
      origin: 'GitHub',
      visitorName,
      projectName: meta.name || parsed.repo,
      sourceLabel: `GitHub · ${full}`,
      paths: finalPaths,
      knownTotalFiles: known,
      sampledFiles: docs.size,
      partialWarnings,
      docs,
      images,
      commits,
      oldest: Date.parse(meta.created_at || ''),
      newest: Date.parse((historyRes?.[0]?.commit.committer?.date || historyRes?.[0]?.commit.author?.date || meta.pushed_at) || ''),
      honestyNote: `Read-only public GitHub scan of ${full} (${branchRaw}): ${known} known files (${docs.size} source/manifest files sampled).${warnNote}`,
      honestyNoteEs: `Lectura pública de solo lectura en GitHub (${full}, rama ${branchRaw}): ${known} archivos conocidos (${docs.size} fuentes/manifiestos muestreados).${warnNote}`,
      dispose() {},
    });

    if (!token) {
      try { globalThis.sessionStorage?.setItem(key, JSON.stringify({ ...dossier, visitorName: '' })); } catch { /* optional */ }
    }
    return dossier;
  } catch (error) {
    const reason = ctrl.signal.aborted
      ? `Timeout reading ${full} (9 s).`
      : error instanceof Error && error.message.startsWith('GitHub HTTP')
        ? error.message
        : `Could not read ${full}: ${error instanceof Error ? error.message : String(error)}.`;
    return createExampleDossier(visitorName, reason);
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

export type VerdictId = 'archive' | 'restore' | 'leave';

export function formatRecoveryCardMarkdown(dossier: ProjectDossier, verdict: VerdictId, creatorNote: string): string {
  return verdict === 'archive' ? formatArchiveCard(dossier, creatorNote) : formatKiroRevivalSpec(dossier, verdict, creatorNote);
}

export function detectArchetype(paths: string[], pkgText = ''): Pick<ReentryPlan, 'archetype' | 'archetypeLabel'> {
  const names = paths.map((p) => p.toLowerCase().replace(/\\/g, '/'));
  const signals = names.join('\n') + '\n' + pkgText.toLowerCase();
  const rules: [RepoArchetype, string, boolean][] = [
    ['course', 'Course / Lab', /\.ipynb\b|(?:^|[\s/_.-])(?:notebooks?|m[oó]dulos?|ejercicios?|lessons?|exercises?)(?:[\s/_.\d-]|$)/m.test(signals)],
    ['security', 'Security & Audit', /(?:scanner|audit|exploit|pentest|\bkali\b|\bnmap\b|\bctf\b)/i.test(signals.replace(/_/g, '-'))],
    ['saas', 'SaaS / Backend', /(?:prisma|stripe|(?:^|[^a-z])auth(?:entication)?(?:[^a-z]|$)|billing|docker-compose|\.env\.example)/m.test(signals)],
    ['app', 'Web / App', names.some((p) => /(^|\/)(?:package\.json|index\.html|pubspec\.yaml)$/.test(p))],
    ['creative', 'Creative / 3D', names.some((p) => /\.(?:blend|glb|gltf|godot|unity)$/i.test(p) || IMAGE_EXT.test(p))],
  ];
  const [archetype, archetypeLabel] = rules.find((r) => r[2]) ?? ['general', 'Codebase'];
  return { archetype, archetypeLabel };
}

export function detectReentryPlan(paths: string[], contents: ReadonlyMap<string, string> = new Map()): ReentryPlan {
  const run = new Set<string>();
  const hints = new Set<string>();
  let testCommand: string | null = null;
  let allPkgText = '';

  // Process manifests in deterministic priority order so the first launch command isn't Dockerfile ahead of package.json/Cargo.
  const ordered = [...contents.entries()].sort(([a], [b]) => {
    const pri = (p: string) => (/package\.json|Cargo\.toml|go\.mod|pyproject\.toml/i.test(p) ? 0 : /Makefile|requirements\.txt/i.test(p) ? 1 : 2);
    return pri(a) - pri(b) || a.localeCompare(b);
  });

  for (const [mPath, text] of ordered) {
    const leaf = mPath.slice(mPath.lastIndexOf('/') + 1);
    const dir = mPath.includes('/') ? mPath.slice(0, mPath.lastIndexOf('/')) : '';
    const prefix = dir ? `cd ${dir} && ` : '';

    if (leaf === 'package.json') {
      allPkgText += '\n' + text;
      try {
        const data = JSON.parse(text);
        const scripts = data?.scripts;
        const manager = /^(npm|pnpm|yarn|bun)@/.exec(String(data?.packageManager))?.[1]
          ?? (paths.some((p) => p.endsWith('pnpm-lock.yaml')) ? 'pnpm' : paths.some((p) => p.endsWith('yarn.lock')) ? 'yarn' : paths.some((p) => /(?:^|\/)bun\.lockb?$/.test(p)) ? 'bun' : 'npm');
        for (const key of ['dev', 'start', 'build', 'test']) {
          if (typeof scripts?.[key] === 'string' && scripts[key].trim()) {
            const cmd = `${prefix}${manager} ${manager === 'npm' && (key === 'start' || key === 'test') ? '' : 'run '}${key}`;
            if (key === 'test') { if (!/no test specified/i.test(scripts.test)) testCommand ??= cmd; }
            else run.add(cmd);
          }
        }
      } catch { /* invalid JSON */ }
    } else if (leaf === 'Cargo.toml') {
      if (/\[package\]/m.test(text)) {
        run.add(`${prefix}cargo build`);
        const crateMain = dir ? `${dir}/src/main.rs` : 'src/main.rs';
        if (paths.includes(crateMain) || /\[\[bin\]\]/m.test(text)) run.add(`${prefix}cargo run`);
        testCommand ??= `${prefix}cargo test`;
      }
    } else if (leaf === 'go.mod') {
      if (/^module\s+\S+/m.test(text)) {
        run.add(`${prefix}go build ./...`);
        testCommand ??= `${prefix}go test ./...`;
      }
    } else if (leaf === 'requirements.txt') {
      run.add(`${prefix}pip install -r requirements.txt`);
      if (/^\s*pytest\s*(?:$|[;#<>=~!\[])/im.test(text)) testCommand ??= `${prefix}pytest`;
    } else if (leaf === 'pyproject.toml') {
      let section = '';
      for (const line of text.split(/\r?\n/)) {
        const header = /^\s*\[([^\]]+)\]/.exec(line);
        if (header) section = header[1];
        if (section === 'project.scripts' || section === 'tool.poetry.scripts') {
          const entry = /^\s*([\w][\w.-]*)\s*=\s*['"][\w.]+:[\w.]+['"]/.exec(line);
          if (entry) run.add(entry[1]);
        }
      }
      if (/^\s*\[tool\.pytest(?:\.|\])|^\s*pytest\s*=|["']pytest(?:["'<>=~!;\[])/im.test(text.replace(/^\s*#.*$/gm, ''))) testCommand ??= `${prefix}pytest`;
    } else if (leaf === 'Makefile') {
      for (const m of text.matchAll(/^([\w.-]+(?: +[\w.-]+)*)\s*:(?!=)/gm)) {
        for (const target of m[1].split(/ +/)) {
          if (/^(dev|start|run|serve|build)$/.test(target)) run.add(`${prefix}make ${target}`);
          if (/^(test|check)$/.test(target)) testCommand ??= `${prefix}make ${target}`;
        }
      }
    } else if (/^(docker-)?compose\.ya?ml$/i.test(leaf) && /^services\s*:/m.test(text)) {
      run.add(`${prefix}docker compose up`);
    } else if (leaf === 'Dockerfile' && /^\s*FROM\s+\S/im.test(text)) {
      run.add(`${prefix}docker build .`);
    } else if (leaf === '.env.example') {
      for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) hints.add(m[1]);
    }
  }

  return {
    ...detectArchetype(paths, allPkgText),
    runCommands: [...run],
    envHints: [...hints],
    testCommand,
    nextSteps: [
      'Inspect the top-ranked TODO/FIXME marker and write a reproducible check.',
      run.size ? `Verify the manifest command "${[...run][0]}".` : 'Identify and document the entry point before editing.',
      testCommand ? `Run "${testCommand}" and record baseline results.` : 'Document one manual check with expected output.',
    ],
  };
}

export function createPresetDossier(presetId: PresetId, visitorName: string, fallbackReason?: string): ProjectDossier {
  const { id, archetype, archetypeLabel, runCommands, envHints, testCommand, nextSteps, todos, graph, honestyNoteEs, ...data } = structuredClone(PRESETS[presetId]);
  const edges = graph.edges.map((e) => ({ from: e.from, to: e.to, kind: (e.kind ?? 'import') as 'import' | 'folder' }));
  const mappedTodos: TodoTrack[] = todos.map((t) => ({ ...t }));
  return {
    ...data,
    id,
    presetId,
    origin: 'Demo',
    visitorName: visitorName.trim() || 'Visitor',
    fallbackReason,
    partialWarnings: fallbackReason ? [fallbackReason] : [],
    knownTotalFiles: graph.knownTotalFiles ?? data.fileCount,
    sampledFiles: graph.sampledFiles ?? graph.nodes.length,
    archetype,
    archetypeLabel,
    commits: data.commits,
    graph: {
      ...graph,
      edges,
      knownTotalFiles: graph.knownTotalFiles ?? data.fileCount,
      sampledFiles: graph.sampledFiles ?? graph.nodes.length,
      importEdgeCount: graph.importEdgeCount ?? edges.filter((e) => e.kind === 'import').length,
    },
    reentry: { archetype, archetypeLabel, runCommands, envHints, testCommand, nextSteps },
    todos: mappedTodos,
    selectedTodoIds: mappedTodos.map((t) => t.id),
    activeTodoIndex: 0,
    honestyNote: [fallbackReason, data.honestyNote].filter(Boolean).join(' '),
    honestyNoteEs: [fallbackReason, honestyNoteEs ?? data.honestyNote].filter(Boolean).join(' '),
    dispose() {},
  };
}

interface Inventory {
  id: string;
  origin: 'Carpeta' | 'GitHub';
  visitorName: string;
  projectName: string;
  sourceLabel: string;
  paths: string[];
  knownTotalFiles: number;
  sampledFiles: number;
  partialWarnings: string[];
  docs: Map<string, string>;
  images: ProjectImage[];
  commits: CommitInfo[];
  oldest: number;
  newest: number;
  latestPath?: string;
  recentOrder?: string[];
  honestyNote: string;
  honestyNoteEs?: string;
  dispose(): void;
}

function assemble(input: Inventory): ProjectDossier {
  const { paths, docs, images, projectName, latestPath, commits, recentOrder } = input;
  const counts: CategoryCounts = { images: 0, docs: 0, code: 0, media3d: 0, other: 0 };
  for (const p of paths) counts[classifyPath(p)]++;
  const reentry = detectReentryPlan(paths, docs);
  const imports = new Map<string, string[]>();
  const allTodos: TodoTrack[] = [];
  const recencyIndex = new Map((recentOrder ?? []).map((p, i) => [p, i]));

  for (const [path, source] of docs) {
    if (/\.(?:[cm]?[jt]sx?|py|rs|go)$/i.test(path)) imports.set(path, extractLocalImports(source));
    if (path !== '.env.example' && !isManifestPath(path)) {
      allTodos.push(...findTodosInFile(path, source, recencyIndex.get(path) ?? 12));
    }
  }
  allTodos.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber);
  const todos = allTodos.slice(0, 6);
  const primaryTodo = todos[0];

  const graph = buildRepoGraph(paths, imports, primaryTodo?.path || latestPath, input.knownTotalFiles);
  const readme = [...docs.keys()].find((p) => /(^|\/)readme(?:\.|$)/i.test(p));
  const oldestDate = formatShortDate(input.oldest) || null;
  const newestDate = formatShortDate(input.newest) || null;
  const piece = (id: string, path: string, kind: ArtifactPiece['kind'], observedFact: string, excerpt: string, interpretation: string): ArtifactPiece => ({
    id, path, kind, title: path || projectName, observedFact, excerpt, interpretation, provenance: 'ORIGINAL', dateLabel: null,
  });

  const inventoryPath = latestPath || graph.hubLabel || '';
  const towerRecord = readme
    ? piece('readme', readme, 'readme', `Read ${readme} (${docs.size} files sampled).`, cleanSnippet(docs.get(readme)!), 'Document may reflect the original intent when the project started.')
    : piece('inventory', inventoryPath, 'file', `Inventory holds ${input.knownTotalFiles} files (${summarizeCounts(counts)}).`, inventoryPath, 'File structure helps locate the main entry module.');
  const primaryImage = images[0] || null;
  const primaryPiece = primaryImage
    ? { ...piece('image', primaryImage.path, 'image', `Image file found at ${primaryImage.path}.`, primaryImage.name, 'Visual capture helps recognize the project state at a glance.'), imageUrl: primaryImage.url }
    : { ...towerRecord, id: 'overview' };
  const tapeClue = primaryTodo
    ? { ...piece('todo', primaryTodo.path, 'unfinished', `${primaryTodo.tag} found at ${primaryTodo.path}:${primaryTodo.lineNumber} (${todos.length} markers ranked).`, primaryTodo.excerpt, 'This code marker points to work left pending before the repo paused.'), lineNumber: primaryTodo.lineNumber }
    : piece('trace', latestPath || commits[0]?.message || inventoryPath, 'file', latestPath ? `Most recent local file: ${latestPath} (${newestDate || 'no date'}).` : 'No TODO/FIXME marker found in sampled code files.', commits[0]?.message || latestPath || inventoryPath || projectName, 'Shows where activity last touched the tree, without claiming why work stopped.');

  return {
    id: input.id,
    origin: input.origin,
    visitorName: input.visitorName.trim() || 'Visitor',
    projectName,
    sourceLabel: input.sourceLabel,
    isDemo: false,
    partialWarnings: input.partialWarnings,
    fileCount: input.knownTotalFiles,
    knownTotalFiles: input.knownTotalFiles,
    sampledFiles: input.sampledFiles,
    categoryCounts: counts,
    oldestDate,
    newestDate,
    dormantLabel: describeDormancy(input.newest),
    commits,
    graph,
    reentry,
    archetype: reentry.archetype,
    archetypeLabel: reentry.archetypeLabel,
    todos,
    selectedTodoIds: todos.map((t) => t.id),
    activeTodoIndex: 0,
    primaryImage,
    galleryImages: images.map((i) => i.url),
    primaryPiece,
    tapeClue,
    towerRecord,
    honestyNote: input.honestyNote,
    honestyNoteEs: input.honestyNoteEs,
    dispose: input.dispose,
  };
}