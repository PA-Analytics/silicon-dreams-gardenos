import * as THREE from 'three/webgpu';
import type { ProjectDossier, TodoTrack } from './ingest.ts';
import { getLang, tr } from './i18n.ts';

const CRT_W = 512;
const CRT_H = 384;
const PANEL_W = 512;
const PANEL_H = 384;
const TV_W = 512;
const TV_H = 384;
const FONT = '"MS Sans Serif", Tahoma, Verdana, sans-serif';
const MONO = '"Courier New", monospace';
const TAU = Math.PI * 2;

const CYAN = '#7fe9ff';
const CYAN_SOFT = '#62bfd4';
const CYAN_DIM = '#3b8194';
const INK = '#ecf9fc';
const AMBER = '#f2a84b';
const AMBER_HOT = '#ffe0b0';
const GROUP_PALETTE = ['#7fe9ff', '#8be8c6', '#c9a8ff', '#9fc4ff', '#ff9db0', '#b8f28a', '#ffb07a', '#f0e68c'];
const TICK_MS = 90;

interface GraphNode { id: string; label: string; group: string; x: number; y: number; weight: number; highlight: boolean }
interface GraphEdge { from: string; to: string; kind: 'import' | 'folder' }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; hubLabel: string; totalFiles: number; importEdgeCount: number }
interface CommitData { hash: string; message: string; date: string }
interface ReentryData { archetypeLabel: string; runCommands: string[]; envHints: string[]; nextSteps: string[]; testCommand: string | null }
interface Pulse { x: number; y: number; r: number }

export interface ScreenApplyOpts {
  discoveredCrt: boolean;
  diverted: boolean;
  discoveredTv: boolean;
  activeTodoIndex?: number;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []);

function readGraph(dossier: ProjectDossier): GraphData | null {
  const raw = (dossier as unknown as { graph?: unknown }).graph;
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { nodes?: unknown; edges?: unknown; hubLabel?: unknown; totalFiles?: unknown; importEdgeCount?: unknown };
  if (!Array.isArray(g.nodes)) return null;
  const nodes: GraphNode[] = [];
  for (const item of g.nodes as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const n = item as { id?: unknown; label?: unknown; group?: unknown; x?: unknown; y?: unknown; weight?: unknown; highlight?: unknown };
    if (typeof n.id !== 'string') continue;
    nodes.push({ id: n.id, label: str(n.label, n.id), group: str(n.group, 'other'), x: num(n.x, 0.5), y: num(n.y, 0.5), weight: Math.max(0, num(n.weight, 1)), highlight: n.highlight === true });
  }
  if (nodes.length === 0) return null;
  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  if (minX < 0 || maxX > 1 || minY < 0 || maxY > 1) {
    const sx = Math.max(maxX - minX, 1e-6); const sy = Math.max(maxY - minY, 1e-6);
    for (const n of nodes) { n.x = 0.06 + ((n.x - minX) / sx) * 0.88; n.y = 0.06 + ((n.y - minY) / sy) * 0.88; }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  if (Array.isArray(g.edges)) {
    for (const item of g.edges as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const e = item as { from?: unknown; to?: unknown; kind?: unknown };
      if (typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to)) {
        edges.push({ from: e.from, to: e.to, kind: e.kind === 'folder' ? 'folder' : 'import' });
      }
    }
  }
  return { nodes, edges, hubLabel: str(g.hubLabel), totalFiles: num(g.totalFiles, dossier.fileCount), importEdgeCount: num(g.importEdgeCount, edges.filter((e) => e.kind === 'import').length) };
}

function readCommits(dossier: ProjectDossier): CommitData[] {
  const raw = (dossier as unknown as { commits?: unknown }).commits;
  if (!Array.isArray(raw)) return [];
  const out: CommitData[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const c = item as { hash?: unknown; message?: unknown; date?: unknown };
    const hash = str(c.hash).trim(); const message = str(c.message).trim();
    if (!hash && !message) continue;
    out.push({ hash, message, date: str(c.date).trim() });
  }
  return out;
}

function readReentry(dossier: ProjectDossier): ReentryData | null {
  const raw = (dossier as unknown as { reentry?: unknown }).reentry;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { archetypeLabel?: unknown; runCommands?: unknown; envHints?: unknown; nextSteps?: unknown; testCommand?: unknown };
  const test = str(r.testCommand).trim();
  return { archetypeLabel: str(r.archetypeLabel).trim(), runCommands: strList(r.runCommands), envHints: strList(r.envHints), nextSteps: strList(r.nextSteps), testCommand: test || null };
}

function withAlpha(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (ctx.measureText(clean).width <= maxW) return clean;
  let cut = clean;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const out: string[] = [];
  const push = (line: string): boolean => { out.push(line); return out.length >= maxLines; };
  for (const para of text.split('\n')) {
    let cur = '';
    for (const raw of para.trim().split(/\s+/).filter(Boolean)) {
      let word = raw;
      while (word.length > 1 && ctx.measureText(word).width > maxW) {
        if (cur) { if (push(cur)) return out; cur = ''; }
        let n = word.length - 1;
        while (n > 1 && ctx.measureText(word.slice(0, n)).width > maxW) n--;
        if (push(word.slice(0, n))) return out;
        word = word.slice(n);
      }
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width <= maxW) cur = next;
      else { if (cur && push(cur)) return out; cur = word; }
    }
    if (cur && push(cur)) return out;
  }
  return out;
}

const shortDate = (d: string) => d.slice(0, 10);

function activeTrack(dossier: ProjectDossier, idx = 0): { path: string; lineNumber?: number; excerpt: string; tag: string; idx: number; total: number } {
  const todos = dossier.todos ?? [];
  if (todos.length > 0) {
    const i = ((idx % todos.length) + todos.length) % todos.length;
    const t: TodoTrack = todos[i];
    return { path: t.path, lineNumber: t.lineNumber, excerpt: t.excerpt, tag: t.tag, idx: i, total: todos.length };
  }
  return { path: dossier.tapeClue.path, lineNumber: dossier.tapeClue.lineNumber, excerpt: dossier.tapeClue.excerpt, tag: dossier.isDemo ? 'DEMO' : 'TRACE', idx: 0, total: 1 };
}

function trackRef(track: { path: string; lineNumber?: number }): string {
  return track.lineNumber ? `${track.path}:${track.lineNumber}` : track.path;
}

function drawRepoGraph(ctx: CanvasRenderingContext2D, graph: GraphData, projectName: string, highlightPath: string | null, x: number, y: number, w: number, h: number, pulses: Pulse[]): void {
  const lang = getLang();
  ctx.fillStyle = '#051013';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(110, 210, 224, 0.08)';
  ctx.lineWidth = 1;
  for (let gx = x + 28; gx < x + w; gx += 28) { ctx.beginPath(); ctx.moveTo(gx + 0.5, y); ctx.lineTo(gx + 0.5, y + h); ctx.stroke(); }
  for (let gy = y + 28; gy < y + h; gy += 28) { ctx.beginPath(); ctx.moveTo(x, gy + 0.5); ctx.lineTo(x + w, gy + 0.5); ctx.stroke(); }

  const padX = 24; const topPad = 24; const botPad = 28;
  const gw = w - padX * 2; const gh = h - topPad - botPad;
  const pos = new Map<string, { x: number; y: number; node: GraphNode }>();
  const groupColor = new Map<string, string>();
  for (const n of graph.nodes) {
    if (!groupColor.has(n.group)) groupColor.set(n.group, GROUP_PALETTE[groupColor.size % GROUP_PALETTE.length]);
    pos.set(n.id, { x: x + padX + n.x * gw, y: y + topPad + n.y * gh, node: n });
  }

  // Folder links: faint dashed lines; real import edges: solid glowing cyan.
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(98, 200, 216, 0.16)';
  ctx.beginPath();
  for (const e of graph.edges) {
    if (e.kind !== 'folder') continue;
    const a = pos.get(e.from); const b = pos.get(e.to);
    if (!a || !b) continue;
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = 'rgba(112, 234, 245, 0.44)';
  ctx.beginPath();
  for (const e of graph.edges) {
    if (e.kind !== 'import') continue;
    const a = pos.get(e.from); const b = pos.get(e.to);
    if (!a || !b) continue;
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  const maxW = Math.max(1, ...graph.nodes.map((n) => n.weight));
  const labeled: Array<{ x: number; y: number; w: number; h: number }> = [];
  const sorted = [...graph.nodes].sort((a, b) => {
    const ah = a.highlight || (highlightPath && a.id === highlightPath) ? 1 : 0;
    const bh = b.highlight || (highlightPath && b.id === highlightPath) ? 1 : 0;
    return bh - ah || b.weight - a.weight;
  });
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const labelLimit = Math.min(10, sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    const p = pos.get(n.id)!;
    const active = n.highlight || (!!highlightPath && n.id === highlightPath);
    const col = active ? AMBER : groupColor.get(n.group)!;
    const r = active ? 6.2 : 2.8 + (n.weight / maxW) * 3.8;
    if (active) pulses.push({ x: p.x, y: p.y, r });
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5);
    halo.addColorStop(0, withAlpha(col, active ? 0.52 : 0.25)); halo.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = active ? AMBER_HOT : col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    if (active) { ctx.strokeStyle = AMBER; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, TAU); ctx.stroke(); }

    if (i < labelLimit) {
      ctx.font = active ? `bold 11px ${MONO}` : `10px ${MONO}`;
      const txt = fit(ctx, n.label, 120);
      const tw = ctx.measureText(txt).width + 6; const th = 14;
      const lx = Math.min(Math.max(p.x + r + 4, x + 6), x + w - tw - 6);
      const ly = Math.min(Math.max(p.y - th / 2, y + 4), y + h - botPad - th);
      const box = { x: lx, y: ly, w: tw, h: th };
      const clashes = labeled.some((o) => !(box.x + box.w + 3 < o.x || o.x + o.w + 3 < box.x || box.y + box.h + 2 < o.y || o.y + o.h + 2 < box.y));
      if (!clashes || active) {
        labeled.push(box);
        ctx.fillStyle = 'rgba(3, 9, 12, 0.86)'; ctx.fillRect(box.x - 1, box.y, box.w, box.h);
        ctx.fillStyle = active ? AMBER_HOT : INK; ctx.fillText(txt, box.x + 2, box.y + th / 2 + 0.5);
      }
    }
  }

  ctx.fillStyle = 'rgba(4, 12, 16, 0.9)'; ctx.fillRect(x, y + h - 22, w, 22);
  ctx.fillStyle = CYAN; ctx.font = `11px ${MONO}`; ctx.textBaseline = 'middle';
  const legend = graph.importEdgeCount > 0
    ? `${graph.nodes.length} ${tr('nodes', 'nodos', lang)} · ${graph.importEdgeCount} ${tr('imports', 'imports', lang)} · ${graph.totalFiles} ${tr('files', 'archivos', lang)}`
    : `${graph.nodes.length} ${tr('nodes', 'nodos', lang)} · ${graph.edges.length} ${tr('links', 'enlaces', lang)} · ${graph.totalFiles} ${tr('files', 'archivos', lang)}`;
  ctx.fillText(fit(ctx, legend, w - 16), x + 8, y + h - 11);
  ctx.fillStyle = CYAN_SOFT; ctx.font = `bold 11px ${MONO}`;
  ctx.fillText(fit(ctx, `${tr('MODULE GRAPH', 'GRAFO DE MÓDULOS', lang)} // ${projectName}`, w - 16), x + 8, y + 12);
}

interface Surface { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }
function makeSurface(width: number, height: number): Surface {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  return { canvas, ctx, texture };
}

interface Applied { dossier: ProjectDossier; opts: ScreenApplyOpts; graph: GraphData | null; commits: CommitData[]; reentry: ReentryData | null; img: HTMLImageElement | null }

export interface IslandScreenRig {
  crtTexture: THREE.CanvasTexture;
  leftPanelTexture: THREE.CanvasTexture;
  rightPanelTexture: THREE.CanvasTexture;
  tvTexture: THREE.CanvasTexture;
  applyDossier(dossier: ProjectDossier, opts: ScreenApplyOpts | boolean, discoveredTv?: boolean): void;
  update(timeMs: number): void;
  dispose(): void;
}

export function createIslandScreenRig(reduceMotion = false): IslandScreenRig {
  const crt = makeSurface(CRT_W, CRT_H);
  const left = makeSurface(PANEL_W, PANEL_H);
  const right = makeSurface(PANEL_W, PANEL_H);
  const tv = makeSurface(TV_W, TV_H);
  const crtStatic = document.createElement('canvas'); crtStatic.width = CRT_W; crtStatic.height = CRT_H;
  const crtStaticCtx = crtStatic.getContext('2d')!;

  let cur: Applied | null = null;
  let imgCache: { url: string; img: HTMLImageElement } | null = null;
  let loadToken = 0;
  let lastTick = -Infinity;
  let lastMs = 0;
  const pulses: Pulse[] = [];

  const paintCrt = () => {
    const lang = getLang();
    const ctx = crtStaticCtx;
    pulses.length = 0;
    const bg = ctx.createLinearGradient(0, 0, 0, CRT_H);
    bg.addColorStop(0, '#1c6368'); bg.addColorStop(1, '#10373d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, CRT_W, CRT_H); ctx.textAlign = 'left';

    const wx = 12; const wy = 10; const ww = CRT_W - 24; const wh = CRT_H - 44;
    ctx.fillStyle = '#c4c4bc'; ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(wx, wy, ww, 2); ctx.fillRect(wx, wy, 2, wh);
    ctx.fillStyle = '#40403c'; ctx.fillRect(wx, wy + wh - 2, ww, 2); ctx.fillRect(wx + ww - 2, wy, 2, wh);

    const discovered = cur?.opts.discoveredCrt === true;
    const diverted = cur?.opts.diverted === true;
    const tb = ctx.createLinearGradient(wx, 0, wx + ww, 0);
    tb.addColorStop(0, diverted ? '#6b3a08' : discovered ? '#0f5c4a' : '#0a1f6b');
    tb.addColorStop(1, diverted ? '#c98a32' : discovered ? '#2f9b83' : '#3a6fc0');
    ctx.fillStyle = tb; ctx.fillRect(wx + 4, wy + 4, ww - 8, 24);
    ctx.fillStyle = '#ffffff'; ctx.font = `bold 14px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText(fit(ctx, cur ? `GARDENOS // ${cur.dossier.projectName.toUpperCase()}` : 'GARDENOS', ww - 116), wx + 10, wy + 16);

    const cx = wx + 6; const cy = wy + 31; const cw = ww - 12; const ch = wh - 56;
    ctx.fillStyle = '#060d10'; ctx.fillRect(cx, cy, cw, ch);

    if (!cur) {
      ctx.fillStyle = CYAN_SOFT; ctx.font = `bold 15px ${MONO}`; ctx.textAlign = 'center';
      ctx.fillText(tr('AWAITING DOSSIER', 'ESPERANDO EXPEDIENTE', lang), cx + cw / 2, cy + ch / 2);
      ctx.textAlign = 'left';
    } else {
      const { dossier, graph } = cur;
      const badgeLabel = dossier.isDemo ? 'DEMO' : dossier.presetId ? 'SNAPSHOT' : 'ORIGINAL';
      ctx.fillStyle = dossier.isDemo ? '#e0a458' : '#7fd8b4';
      ctx.fillRect(wx + ww - 92, wy + 6, 82, 20);
      ctx.fillStyle = '#091210'; ctx.font = `bold 11px ${MONO}`; ctx.textAlign = 'center';
      ctx.fillText(badgeLabel, wx + ww - 51, wy + 16); ctx.textAlign = 'left';

      const trk = activeTrack(dossier, cur.opts.activeTodoIndex ?? 0);
      // NEVER occlude the connected dependency graph with a screenshot — the graph stays live on the CRT.
      if (graph) {
        drawRepoGraph(ctx, graph, dossier.projectName, trk.path, cx, cy, cw, ch, pulses);
      } else {
        ctx.fillStyle = '#8be8c6'; ctx.font = `bold 19px ${MONO}`; ctx.textBaseline = 'top';
        ctx.fillText(fit(ctx, dossier.projectName, cw - 24), cx + 12, cy + 14);
        ctx.fillStyle = '#d8e8dc'; ctx.font = `13px ${MONO}`;
        ctx.fillText(`${dossier.knownTotalFiles} files`, cx + 12, cy + 44);
        wrapLines(ctx, dossier.primaryPiece.excerpt, cw - 24, 7).forEach((line, idx) => ctx.fillText(line, cx + 12, cy + 74 + idx * 20));
        ctx.textBaseline = 'middle';
      }
      ctx.fillStyle = '#181a18'; ctx.font = `11px ${FONT}`; ctx.textBaseline = 'middle';
      ctx.fillText(fit(ctx, `${dossier.graph.hubLabel || dossier.primaryPiece.path} · ${dossier.visitorName}`, ww - 20), wx + 10, wy + wh - 13);
    }

    ctx.fillStyle = diverted ? AMBER : '#c0c0b8';
    ctx.fillRect(0, CRT_H - 28, CRT_W, 28);
    ctx.fillStyle = '#101010'; ctx.font = `bold 12px ${FONT}`; ctx.textBaseline = 'middle';
    const barLabel = diverted
      ? tr('SIGNAL DIVERTED -> CHANNEL B (TV)', 'SEÑAL DESVIADA -> CANAL B (TV)', lang)
      : discovered ? tr('RECOGNIZED · LINE 01', 'RECONOCIDO · LÍNEA 01', lang) : tr('WAITING ON THE ISLAND', 'ESPERANDO EN LA ISLA', lang);
    ctx.fillText(barLabel, 12, CRT_H - 14);
    ctx.font = `12px ${MONO}`; ctx.textAlign = 'right';
    ctx.fillText(cur?.dossier.newestDate ?? '', CRT_W - 12, CRT_H - 14); ctx.textAlign = 'left';
  };

  const blitCrt = (timeMs: number) => {
    const ctx = crt.ctx;
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(crtStatic, 0, 0);
    if (pulses.length > 0) {
      const t = reduceMotion ? 0.35 : (timeMs / 1000) % 1;
      ctx.globalCompositeOperation = 'lighter';
      for (const p of pulses) {
        const beat = 0.5 + 0.5 * Math.sin(t * TAU);
        const glowR = p.r * (3.4 + beat * 1.2);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, withAlpha(AMBER, 0.32 + beat * 0.25)); glow.addColorStop(1, withAlpha(AMBER, 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, TAU); ctx.fill();
        ctx.strokeStyle = withAlpha(AMBER_HOT, (1 - t) * 0.85); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4 + t * 15, 0, TAU); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    crt.texture.needsUpdate = true;
  };

  const panelBase = (ctx: CanvasRenderingContext2D, title: string, tone: string) => {
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.textAlign = 'left';
    ctx.fillStyle = '#03080c'; ctx.fillRect(0, 0, PANEL_W, PANEL_H);
    ctx.fillStyle = tone; ctx.font = `bold 21px ${MONO}`; ctx.textBaseline = 'top';
    ctx.fillText(title, 20, 16);
    ctx.fillStyle = withAlpha(tone, 0.55); ctx.fillRect(20, 44, PANEL_W - 40, 2);
  };
  const tag = (ctx: CanvasRenderingContext2D, text: string, y: number) => {
    ctx.fillStyle = CYAN_SOFT; ctx.font = `bold 12px ${MONO}`; ctx.fillText(text, 20, y);
  };

  const paintLeft = () => {
    const lang = getLang();
    const ctx = left.ctx;
    panelBase(ctx, tr('REPO PULSE & CAPTURE', 'PULSO Y CAPTURA', lang), CYAN);
    if (cur) {
      const { dossier, commits, reentry, img } = cur;
      const maxW = PANEL_W - 40;
      const badge = dossier.isDemo ? 'DEMO' : dossier.presetId ? 'SNAPSHOT' : 'ORIGINAL';
      ctx.textAlign = 'right'; ctx.fillStyle = dossier.isDemo ? AMBER : '#8be8c6'; ctx.font = `bold 13px ${MONO}`;
      ctx.fillText(badge, PANEL_W - 20, 20); ctx.textAlign = 'left';

      let y = 56;
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const boxW = maxW; const boxH = 148;
        ctx.fillStyle = '#061116'; ctx.fillRect(20, y, boxW, boxH);
        const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
        const dw = img.naturalWidth * scale; const dh = img.naturalHeight * scale;
        ctx.drawImage(img, 20 + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
        ctx.strokeStyle = withAlpha(CYAN, 0.4); ctx.lineWidth = 1; ctx.strokeRect(20.5, y + 0.5, boxW - 1, boxH - 1);
        y += boxH + 12;
      } else {
        tag(ctx, tr('ARCHETYPE', 'ARQUETIPO', lang), y);
        ctx.fillStyle = INK; ctx.font = `bold 16px ${MONO}`;
        ctx.fillText(fit(ctx, reentry?.archetypeLabel || 'Codebase', maxW - 110), 130, y - 2);
        y += 28;
      }

      tag(ctx, commits.length > 0 ? `${tr('RECENT COMMITS', 'ÚLTIMOS COMMITS', lang)} (${commits.length})` : tr('INVENTORY', 'INVENTARIO', lang), y);
      y += 18;
      if (commits.length > 0) {
        const showCount = img ? 2 : 3;
        commits.slice(0, showCount).forEach((c) => {
          ctx.fillStyle = CYAN; ctx.font = `bold 13px ${MONO}`;
          const hash = c.hash.slice(0, 7) || '·······';
          ctx.fillText(`${hash} · ${shortDate(c.date)}`, 20, y);
          ctx.fillStyle = INK; ctx.font = `14px ${MONO}`;
          ctx.fillText(fit(ctx, c.message || '(no message)', maxW - 8), 24, y + 17);
          y += 40;
        });
      } else {
        const k = dossier.categoryCounts;
        ctx.fillStyle = CYAN_DIM; ctx.font = `14px ${MONO}`;
        ctx.fillText(tr('no git history in local folder scan', 'sin historial git en carpeta local', lang), 20, y);
        ctx.fillStyle = INK; ctx.fillText(`${dossier.knownTotalFiles} ${tr('files cataloged', 'archivos catalogados', lang)}`, 20, y + 24);
        ctx.fillStyle = CYAN_SOFT; ctx.fillText(fit(ctx, `${k.code} code · ${k.docs} docs · ${k.images} img`, maxW), 20, y + 48);
      }

      ctx.fillStyle = withAlpha(CYAN, 0.35); ctx.fillRect(20, PANEL_H - 54, maxW, 1);
      ctx.fillStyle = CYAN_SOFT; ctx.font = `bold 12px ${MONO}`;
      ctx.fillText(fit(ctx, `${dossier.dormantLabel ?? tr('no date', 'sin fecha', lang)} · ${dossier.oldestDate ?? '?'} -> ${dossier.newestDate ?? '?'}`, maxW), 20, PANEL_H - 38);
    }
    left.texture.needsUpdate = true;
  };

  const paintRightCalm = (ctx: CanvasRenderingContext2D) => {
    const lang = getLang();
    panelBase(ctx, tr('RE-ENTRY & COMMANDS', 'REENTRADA / ARRANQUE', lang), CYAN);
    if (!cur) return;
    const { dossier, reentry } = cur;
    const maxW = PANEL_W - 40;
    const none = (text: string, y: number) => { ctx.fillStyle = CYAN_DIM; ctx.font = `14px ${MONO}`; ctx.fillText(text, 20, y); };
    const cmd = (text: string, y: number) => {
      ctx.fillStyle = CYAN; ctx.font = `bold 15px ${MONO}`; ctx.fillText('$', 20, y);
      ctx.fillStyle = INK; ctx.fillText(fit(ctx, text, maxW - 20), 36, y);
    };

    tag(ctx, tr('LAUNCH', 'ARRANQUE', lang), 58);
    const run = reentry?.runCommands.slice(0, 3) ?? [];
    if (run.length > 0) run.forEach((c, i) => cmd(c, 78 + i * 24));
    else none(tr('— no launch script detected —', '— sin comando verificado —', lang), 78);

    tag(ctx, tr('TESTS', 'PRUEBAS', lang), 158);
    if (reentry?.testCommand) cmd(reentry.testCommand, 178);
    else none(tr('— no test runner verified —', '— sin suite detectada —', lang), 178);

    tag(ctx, tr('ENV KEYS (.env)', 'ENTORNO (.env)', lang), 214);
    const env = reentry?.envHints.slice(0, 3) ?? [];
    if (env.length > 0) { ctx.fillStyle = INK; ctx.font = `14px ${MONO}`; ctx.fillText(fit(ctx, env.join(' · '), maxW), 20, 234); }
    else none(tr('— none declared —', '— sin variables —', lang), 234);

    tag(ctx, tr('NEXT STEP', 'SIGUIENTE', lang), 268);
    ctx.font = `14px ${MONO}`; ctx.fillStyle = INK;
    const step = reentry?.nextSteps?.[0] ?? '';
    if (step) wrapLines(ctx, step, maxW, 2).forEach((line, i) => ctx.fillText(line, 20, 288 + i * 20));
    else none('—', 288);

    const trk = activeTrack(dossier, cur.opts.activeTodoIndex ?? 0);
    ctx.fillStyle = CYAN_SOFT; ctx.font = `12px ${MONO}`;
    ctx.fillText(fit(ctx, `${tr('TRACE', 'RASTRO', lang)}: ${trackRef(trk)}`, maxW), 20, PANEL_H - 28);
  };

  const paintRight = () => {
    const lang = getLang();
    const ctx = right.ctx;
    paintRightCalm(ctx);
    if (cur?.opts.diverted) {
      const { dossier } = cur;
      const trk = activeTrack(dossier, cur.opts.activeTodoIndex ?? 0);
      const maxW = PANEL_W - 56;
      let seed = 0x9e3779b9;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 8; i++) {
        const sy = Math.floor(rnd() * (PANEL_H - 20)); const sh = 5 + Math.floor(rnd() * 14); const dx = Math.round((rnd() - 0.5) * 60);
        ctx.drawImage(right.canvas, 0, sy, PANEL_W, sh, dx, sy, PANEL_W, sh);
      }
      ctx.fillStyle = 'rgba(4, 6, 8, 0.88)'; ctx.fillRect(0, 0, PANEL_W, PANEL_H);
      ctx.fillStyle = withAlpha(AMBER, 0.08); ctx.fillRect(0, 0, PANEL_W, PANEL_H);
      ctx.strokeStyle = AMBER; ctx.lineWidth = 4; ctx.strokeRect(6, 6, PANEL_W - 12, PANEL_H - 12);
      ctx.lineWidth = 1; ctx.strokeRect(14.5, 14.5, PANEL_W - 29, PANEL_H - 29);

      ctx.fillStyle = AMBER; ctx.fillRect(24, 24, PANEL_W - 48, 36);
      ctx.fillStyle = '#140a02'; ctx.font = `bold 18px ${MONO}`; ctx.textBaseline = 'middle';
      ctx.fillText(fit(ctx, tr('! SIGNAL DIVERTED -> CHANNEL B (TV)', '! SEÑAL DESVIADA -> CANAL B (TV)', lang), maxW - 16), 34, 42);
      ctx.textBaseline = 'top';

      ctx.fillStyle = AMBER; ctx.font = `bold 12px ${MONO}`;
      ctx.fillText(`${trk.tag} · ${tr('TRACK', 'PISTA', lang)} ${trk.idx + 1}/${trk.total}`, 28, 76);
      ctx.fillStyle = AMBER_HOT; ctx.font = `bold 16px ${MONO}`;
      ctx.fillText(fit(ctx, trackRef(trk), maxW), 28, 96);
      ctx.fillStyle = '#fff0d4'; ctx.font = `15px ${MONO}`;
      wrapLines(ctx, trk.excerpt, maxW, 6).forEach((line, i) => ctx.fillText(line, 28, 128 + i * 24));
      ctx.fillStyle = AMBER; ctx.font = `13px ${MONO}`;
      ctx.fillText(fit(ctx, tr('Check the TV across the tower lawn ->', 'Revisa el televisor al otro lado ->', lang), maxW), 28, PANEL_H - 42);
    }
    right.texture.needsUpdate = true;
  };

  const paintTv = (timeMs: number) => {
    const lang = getLang();
    const ctx = tv.ctx;
    const t = reduceMotion ? 0 : timeMs / 1000;
    const active = cur !== null && (cur.opts.diverted || cur.opts.discoveredTv);
    ctx.globalCompositeOperation = 'source-over'; ctx.textAlign = 'left';
    ctx.fillStyle = active ? '#0b0703' : '#05090c'; ctx.fillRect(0, 0, TV_W, TV_H);

    if (!cur || !active) {
      let seed = reduceMotion ? 7 : (Math.imul(Math.floor(timeMs / TICK_MS), 2654435761) >>> 0) || 7;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 280; i++) {
        ctx.fillStyle = `rgba(190, 215, 225, ${(0.04 + rnd() * 0.1).toFixed(3)})`;
        ctx.fillRect(rnd() * TV_W, rnd() * TV_H, 1 + rnd() * 3, 1);
      }
      ctx.fillStyle = 'rgba(160, 200, 215, 0.05)'; ctx.fillRect(0, ((t * 38) % (TV_H + 40)) - 20, TV_W, 18);
      ctx.fillStyle = 'rgba(150, 190, 205, 0.45)'; ctx.font = `13px ${MONO}`; ctx.textBaseline = 'top';
      ctx.fillText(tr('CHANNEL B · STANDBY', 'CANAL B · SIN SEÑAL', lang), 22, TV_H - 32);
      tv.texture.needsUpdate = true;
      return;
    }

    const { dossier, opts } = cur;
    const trk = activeTrack(dossier, opts.activeTodoIndex ?? 0);
    ctx.fillStyle = 'rgba(242, 168, 75, 0.05)';
    for (let y = 0; y < TV_H; y += 4) ctx.fillRect(0, y, TV_W, 1);

    const inKiro = !dossier.selectedTodoIds || dossier.selectedTodoIds.includes(dossier.todos?.[trk.idx]?.id ?? '');
    ctx.fillStyle = inKiro ? AMBER : CYAN_SOFT; ctx.font = `bold 19px ${MONO}`; ctx.textBaseline = 'top';
    ctx.fillText(`▶ ${tr('CH-B', 'CANAL B', lang)} · ${trk.idx + 1}/${trk.total} [${trk.tag}] · ${inKiro ? tr('IN KIRO', 'EN KIRO', lang) : tr('SKIPPED', 'OMITIDA', lang)}`, 24, 20);
    if (reduceMotion || Math.floor(t * 2) % 2 === 0) { ctx.beginPath(); ctx.arc(TV_W - 28, 30, 6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = AMBER_HOT; ctx.font = `bold 16px ${MONO}`;
    ctx.fillText(fit(ctx, trackRef(trk), TV_W - 48), 24, 52);

    ctx.globalCompositeOperation = 'lighter';
    for (const [width, alpha] of [[6, 0.16], [2.2, 0.95]] as const) {
      ctx.strokeStyle = withAlpha(AMBER, alpha); ctx.lineWidth = width; ctx.beginPath();
      for (let x = 24; x <= TV_W - 24; x += 4) {
        const k = (x - 24) / (TV_W - 48);
        const env = Math.sin(k * Math.PI) * (0.62 + 0.38 * Math.sin(t * 1.7 + k * 4));
        const y = 120 + Math.sin(k * 26 + t * 5.2) * env * 28 + Math.cos(k * 67 - t * 9) * env * 8;
        if (x === 24) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = withAlpha(AMBER, 0.4); ctx.fillRect(24, 162, TV_W - 48, 1);

    ctx.fillStyle = '#fff0d4'; ctx.font = `16px ${MONO}`;
    wrapLines(ctx, trk.excerpt, TV_W - 48, 5).forEach((line, i) => ctx.fillText(line, 24, 178 + i * 24));

    ctx.fillStyle = withAlpha(AMBER, 0.85); ctx.font = `13px ${MONO}`;
    ctx.fillText(fit(ctx, `${dossier.isDemo ? 'DEMO' : dossier.presetId ? 'SNAPSHOT' : 'ORIGINAL'} · ${dossier.projectName}`, TV_W - 150), 24, TV_H - 34);
    ctx.textAlign = 'right';
    ctx.fillText(opts.discoveredTv ? (trk.total > 1 ? tr('[E] NEXT · [R] KIRO', '[E] SIG · [R] KIRO', lang) : tr('[R] KIRO · TAPE READ', '[R] KIRO · LEÍDA', lang)) : tr('INCOMING', 'ENTRANTE', lang), TV_W - 24, TV_H - 34);
    ctx.textAlign = 'left';
    tv.texture.needsUpdate = true;
  };

  const repaint = () => { paintCrt(); blitCrt(lastMs); paintLeft(); paintRight(); paintTv(lastMs); };
  repaint();

  return {
    crtTexture: crt.texture,
    leftPanelTexture: left.texture,
    rightPanelTexture: right.texture,
    tvTexture: tv.texture,
    applyDossier(dossier, optsOrCrt, discoveredTv) {
      const opts: ScreenApplyOpts = typeof optsOrCrt === 'boolean'
        ? { discoveredCrt: optsOrCrt, diverted: false, discoveredTv: discoveredTv === true, activeTodoIndex: dossier.activeTodoIndex }
        : { discoveredCrt: optsOrCrt.discoveredCrt === true, diverted: optsOrCrt.diverted === true, discoveredTv: optsOrCrt.discoveredTv === true, activeTodoIndex: optsOrCrt.activeTodoIndex ?? dossier.activeTodoIndex };
      const token = ++loadToken;
      const url = dossier.primaryImage?.url ?? null;
      const cached = url && imgCache?.url === url ? imgCache.img : null;
      cur = { dossier, opts, graph: readGraph(dossier), commits: readCommits(dossier), reentry: readReentry(dossier), img: cached };
      repaint();
      if (url && !cached && typeof Image !== 'undefined') {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { imgCache = { url, img }; if (token !== loadToken || !cur) return; cur.img = img; paintLeft(); };
        img.src = url;
      }
    },
    update(timeMs) {
      lastMs = timeMs;
      if (reduceMotion || timeMs - lastTick < TICK_MS) return;
      lastTick = timeMs;
      if (pulses.length > 0) blitCrt(timeMs);
      paintTv(timeMs);
    },
    dispose() {
      loadToken++; cur = null; imgCache = null;
      for (const s of [crt, left, right, tv]) s.texture.dispose();
    },
  };
}