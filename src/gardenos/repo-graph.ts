export interface GraphNode {
  id: string;
  label: string;
  group: string;
  x: number;
  y: number;
  weight: number;
  highlight?: boolean;
}

export type EdgeKind = 'import' | 'folder';

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface RepoGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hubLabel: string;
  totalFiles: number;
  knownTotalFiles: number;
  sampledFiles: number;
  importEdgeCount: number;
}

/** Literal module references, not a claim that an external package lives in the repo. */
export function extractLocalImports(source: string): string[] {
  const refs = new Set<string>();
  const js = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|\b(?:import\s*(?:\(\s*|(?:[\w$*,\s{}]+?\bfrom\s*)?)|export\s+(?:\*|\{[^}]*\})\s+from\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g;
  for (const m of source.matchAll(js)) if (m[1]) refs.add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+(?:\(\s*([\s\S]*?)\s*\)|(?:[\w.]+\s+)?"([^"]+)")/g)) {
    if (m[1]) { for (const q of m[1].matchAll(/"([^"]+)"/g)) if (q[1]) refs.add('go:' + q[1]); }
    if (m[2]) refs.add('go:' + m[2]);
  }
  for (const m of source.matchAll(/^\s*(?:mod\s+(\w+)\s*;|use\s+crate::([\w:]+))/gm)) {
    if (m[1]) refs.add('rs:' + m[1]);
    if (m[2]) refs.add('rs:' + m[2].split('::')[0]);
  }
  for (const line of source.split(/\r?\n/)) {
    const stmt = line.split('#', 1)[0].trim();
    const from = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(stmt);
    if (from) {
      if (!/^\.+$/.test(from[1])) refs.add(from[1]);
      for (const part of from[2].replace(/[()]/g, '').split(',')) {
        const member = /^(\w+)(?:\s+as\s+\w+)?$/.exec(part.trim());
        if (member) refs.add(from[1] + (from[1].endsWith('.') ? '' : '.') + member[1]);
      }
    } else if (/^import\s+[\w., \t]+;?$/.test(stmt) && !/\sfrom\s/.test(stmt)) {
      for (const part of stmt.slice(7).replace(/;$/, '').split(',')) refs.add(part.trim().split(/\s+as\s+/)[0]);
    }
  }
  return [...refs].filter(Boolean);
}

const clean = (s: string) => s.replace(/\\/g, '/').replace(/^\.\//, '');
const leaf = (s: string) => s.slice(s.lastIndexOf('/') + 1);
const groupOf = (s: string) => (s.includes('/') ? s.split('/')[0] : '/');
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function resolveRef(from: string, ref: string, ids: Set<string>): string | undefined {
  const dir = from.split('/').slice(0, -1);
  if (from.endsWith('.go') && ref.startsWith('go:')) {
    const pkg = ref.slice(3).replace(/^\.+\//, '');
    const segs = pkg.split('/').filter(Boolean);
    const tail = segs.slice(-2).join('/');
    const last = segs[segs.length - 1] || '';
    for (const id of ids) {
      if (!id.endsWith('.go') || id === from) continue;
      const idDir = id.split('/').slice(0, -1).join('/');
      if ((tail && (idDir === tail || idDir.endsWith('/' + tail))) || (last && (idDir === last || idDir.endsWith('/' + last)))) return id;
    }
    return undefined;
  }
  if (from.endsWith('.go') && ref.startsWith('go:')) {
    const pkg = ref.slice(3).replace(/^\.+\//, '');
    const segs = pkg.split('/').filter(Boolean);
    const tail = segs.slice(-2).join('/');
    const last = segs[segs.length - 1] || '';
    for (const id of ids) {
      if (!id.endsWith('.go') || id === from) continue;
      const idDir = id.split('/').slice(0, -1).join('/');
      if ((tail && (idDir === tail || idDir.endsWith('/' + tail))) || (last && (idDir === last || idDir.endsWith('/' + last)))) return id;
    }
    return undefined;
  }
  if (from.endsWith('.rs') && ref.startsWith('rs:')) {
    const mod = ref.slice(3);
    for (const base of [dir.join('/'), 'src']) {
      const p = [base, mod].filter(Boolean).join('/');
      for (const file of [p + '.rs', p + '/mod.rs']) if (ids.has(file)) return file;
    }
    return undefined;
  }
  if (from.endsWith('.py') && /^[.\w]+$/.test(ref)) {
    const dots = ref.match(/^\.+/)?.[0].length ?? 0;
    const mod = ref.slice(dots).replace(/\./g, '/');
    const bases = dots ? [dir.slice(0, Math.max(0, dir.length - dots + 1)).join('/')] : ['', 'src', dir.join('/')];
    for (const base of bases) {
      const path = [base, mod].filter(Boolean).join('/');
      for (const file of [path + '.py', path + '/__init__.py']) if (ids.has(file)) return file;
    }
  } else if (/^\.{1,2}\//.test(ref)) {
    for (const part of ref.split('/')) {
      if (part === '..') { if (!dir.length) return; dir.pop(); } else if (part && part !== '.') dir.push(part);
    }
    const path = dir.join('/');
    if (ids.has(path)) return path;
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']) {
      for (const file of [path.replace(/\.js$/, '') + ext, path + '/index' + ext]) if (ids.has(file)) return file;
    }
  }
}

export function buildRepoGraph(
  paths: string[],
  importsByPath = new Map<string, string[]>(),
  highlightPath?: string | null,
  knownTotalFiles?: number,
): RepoGraph {
  const files = [...new Set(paths.map(clean).filter(Boolean))].sort(byName);
  const highlight = clean(highlightPath ?? '');
  const allIds = new Set(files);
  const importedTargets = new Set<string>();
  for (const [source, refs] of importsByPath) {
    const from = clean(source);
    for (const ref of refs) { const to = resolveRef(from, ref, allIds); if (to) importedTargets.add(to); }
  }
  const score = (p: string) =>
    p === highlight ? 100 : /^(?:index|main|app|lib|server|readme|package|pyproject|Cargo)\./i.test(leaf(p)) ? 12 : importsByPath.get(p)?.length ? 9 : importedTargets.has(p) ? 8 : /\.(?:[cm]?[jt]sx?|py|go|rs)$/i.test(p) ? 5 : 1;

  const groups = new Map<string, string[]>();
  for (const path of files.slice().sort((a, b) => score(b) - score(a) || byName(a, b))) {
    const group = groupOf(path);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(path);
  }
  const chosen: string[] = [];
  for (let depth = 0; chosen.length < Math.min(36, files.length); depth++) {
    for (const members of groups.values()) if (members[depth] && chosen.length < 36) chosen.push(members[depth]);
  }
  const ids = new Set(chosen);
  const edges: GraphEdge[] = [];
  const links = new Set<string>();
  const degree = new Map(chosen.map((id) => [id, 0]));
  let importEdgeCount = 0;

  function link(from: string, to: string, kind: EdgeKind) {
    const key = JSON.stringify([from, to]);
    if (from === to || links.has(key) || (kind === 'folder' && links.has(JSON.stringify([to, from])))) return;
    links.add(key); edges.push({ from, to, kind });
    if (kind === 'import') importEdgeCount++;
    degree.set(from, degree.get(from)! + 1); degree.set(to, degree.get(to)! + 1);
  }

  for (const [source, refs] of importsByPath) {
    const from = clean(source); if (!ids.has(from)) continue;
    for (const ref of refs) { const to = resolveRef(from, ref, ids); if (to) link(from, to, 'import'); }
  }

  const hub = chosen.slice().sort((a, b) => degree.get(b)! - degree.get(a)! || score(b) - score(a) || byName(a, b))[0];
  const anchors = new Map<string, string>();
  for (const path of [hub, ...chosen].filter(Boolean)) {
    const group = groupOf(path); const parent = anchors.get(group) ?? hub;
    link(parent, path, 'folder'); if (!anchors.has(group)) anchors.set(group, path);
  }

  const slots: { x: number; y: number; angle: number }[] = [];
  let remaining = chosen.length - 1;
  const rings = remaining <= 7 ? 1 : remaining <= 19 ? 2 : 3;
  for (let ring = 1; remaining > 0; ring++) {
    const n = Math.min(remaining, [7, 12, 16][ring - 1]); remaining -= n;
    for (let i = 0; i < n; i++) {
      const angle = ((i + (ring % 2) * 0.38) * 2 * Math.PI) / n;
      const r = (0.415 * ring) / rings;
      slots.push({ angle, x: 0.5 + Math.cos(angle) * r, y: 0.5 + Math.sin(angle) * r });
    }
  }
  slots.sort((a, b) => a.angle - b.angle);
  const ordered = chosen.filter((p) => p !== hub).sort((a, b) => byName(groupOf(a), groupOf(b)) || byName(a, b));
  if (hub) ordered.unshift(hub);
  const nodes = ordered.map((id, i) => {
    const { x, y } = i ? slots[i - 1] : { x: 0.5, y: 0.5 };
    return { id, label: leaf(id), group: groupOf(id), x, y, weight: degree.get(id)! + 1, ...(id === highlight ? { highlight: true } : {}) };
  });

  const knownTotal = Math.max(files.length, knownTotalFiles ?? files.length);
  return { nodes, edges, hubLabel: hub ?? '', totalFiles: knownTotal, knownTotalFiles: knownTotal, sampledFiles: files.length, importEdgeCount };
}