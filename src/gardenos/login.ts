import * as THREE from 'three/webgpu';
import { getLang, tr } from './i18n.ts';

export type Origin = 'Demo' | 'GitHub' | 'Carpeta';
export type PresetId = 'trazo' | 'boundary' | 'sentinel-lab';
export type StoryPace = 'demo' | 'full';
export type Focus = 'name' | 'repo';

export const ORIGINS: Origin[] = ['Demo', 'GitHub', 'Carpeta'];
export const PRESET_CHIPS: Array<{ id: PresetId; label: string }> = [
  { id: 'trazo', label: 'Trazo' },
  { id: 'boundary', label: 'BOUNDARY' },
  { id: 'sentinel-lab', label: 'Sentinel Lab' },
];
export const PACE_CHIPS: Array<{ id: StoryPace; en: string; es: string }> = [
  { id: 'demo', en: '90s Demo', es: 'Demo 90s' },
  { id: 'full', en: '4m Story', es: 'Completa 4m' },
];

export type Hit =
  | 'button'
  | 'name'
  | 'repo'
  | 'folder'
  | 'glass'
  | { chip: Origin }
  | { preset: PresetId }
  | { pace: StoryPace };

const W = 640;
const H = 480;
const SCALE = 1.25;
const FONT = '"MS Sans Serif", Tahoma, Verdana, sans-serif';
const D = { x: 96, y: 76, w: 448, h: 306 } as const;
const CX = 320;
const CY = 229;
const PAD = 16;
const X0 = D.x + PAD;
const IW = D.w - PAD * 2;
const rect = {
  name: [X0, D.y + 68, IW, 26],
  origins: [[X0, D.y + 116, 94, 26], [X0 + 102, D.y + 116, 94, 26], [X0 + 204, D.y + 116, 98, 26]],
  presets: [[X0, D.y + 160, 132, 30], [X0 + 142, D.y + 160, 132, 30], [X0 + 284, D.y + 160, 132, 30]],
  detail: [X0, D.y + 160, IW, 28],
  paces: [[X0, D.y + 236, 108, 28], [X0 + 118, D.y + 236, 118, 28]],
  button: [X0 + 284, D.y + 234, 132, 32],
} as const;
type R = readonly number[];
const inside = (x: number, y: number, r: R) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
const GITHUB = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?[\w-]+\/[\w.-]+?(?:\.git)?\/?$/i;

export interface LoginUI {
  readonly name: string;
  readonly repo: string;
  readonly folder: string;
  readonly origin: Origin;
  readonly presetId: PresetId;
  readonly pace: StoryPace;
  focus: Focus;
  setName(v: string): void;
  setRepo(v: string): void;
  setFolder(name: string, files: number): void;
  setOrigin(o: Origin): void;
  stepOrigin(d: number): void;
  setPreset(id: PresetId): void;
  setPace(p: StoryPace): void;
  setStatus(msg: string): void;
  validate(): string | null;
  hit(u: number, v: number): Hit;
  draw(time: number, cross?: number): void;
  texture: THREE.CanvasTexture;
  reset(): void;
}

export function createLoginUI(): LoginUI {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  let name = '';
  let repo = '';
  let folder = '';
  let files = 0;
  let origin: Origin = 'Demo';
  let presetId: PresetId = 'boundary';
  let pace: StoryPace = 'demo';
  let focus: Focus = 'name';
  let status = '';
  let statusError = false;

  const bevel = (x: number, y: number, w: number, h: number, sunken = false, fill = '#c3c3bd') => {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = sunken ? '#5c5c58' : '#ffffff'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = sunken ? '#ffffff' : '#4a4a46'; ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
  };
  const text = (s: string, x: number, y: number, size = 14, color = '#101010', weight = '') => {
    ctx.font = `${weight} ${size}px ${FONT}`.trim(); ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
  };
  const center = (s: string, cx: number, y: number, size = 13, color = '#101010', weight = '') => {
    ctx.font = `${weight} ${size}px ${FONT}`.trim(); ctx.fillStyle = color; ctx.textBaseline = 'middle';
    ctx.fillText(s, cx - ctx.measureText(s).width / 2, y);
  };
  const fit = (s: string, maxPx: number, size: number) => {
    ctx.font = `${size}px ${FONT}`; let out = s;
    while (out.length > 4 && ctx.measureText(out).width > maxPx) out = '\u2026' + out.slice(2);
    return out;
  };
  const icon = (x: number, y: number, label: string, kind: number) => {
    ctx.fillStyle = kind === 0 ? '#d8d2b8' : kind === 1 ? '#3f6f5b' : '#d8c25a'; ctx.fillRect(x, y, 34, 28);
    ctx.fillStyle = '#10201c'; ctx.fillRect(x + 4, y + 4, 26, 16);
    ctx.fillStyle = kind === 1 ? '#7fd3b0' : '#2f8f93'; ctx.fillRect(x + 6, y + 6, 22, 12);
    ctx.font = '11px ' + FONT; text(label, x + 17 - ctx.measureText(label).width / 2, y + 42, 11, '#f4f4ec');
  };
  const daisy = (cx: number, cy: number) => {
    ctx.fillStyle = '#3d8a3a'; ctx.fillRect(cx - 1, cy + 8, 3, 26);
    ctx.fillStyle = '#5faa4a'; ctx.fillRect(cx + 2, cy + 20, 9, 4); ctx.fillRect(cx - 11, cy + 25, 9, 4);
    ctx.fillStyle = '#f6f6ee';
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, 5, 3.4, a, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#f0c030'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  };
  const field = (r: R, value: string, placeholder: string, active: boolean, caret: boolean) => {
    bevel(r[0], r[1], r[2], r[3], true, '#ffffff');
    if (active) { ctx.strokeStyle = '#0a1f6b'; ctx.strokeRect(r[0] + 2.5, r[1] + 2.5, r[2] - 5, r[3] - 5); }
    if (value) text(fit(value, r[2] - 18, 14) + (active && caret ? '|' : ''), r[0] + 7, r[1] + r[3] / 2 + 1, 14);
    else { text(placeholder, r[0] + 7, r[1] + r[3] / 2 + 1, 14, '#9a9a94'); if (active && caret) text('|', r[0] + 5, r[1] + r[3] / 2 + 1, 14); }
  };
  const chip = (r: R, label: string, on: boolean, size = 13) => {
    bevel(r[0], r[1], r[2], r[3], on, on ? '#a9b6d8' : '#c3c3bd');
    center(label, r[0] + r[2] / 2, r[1] + r[3] / 2 + 1, size, '#101010', on ? 'bold' : '');
  };

  function draw(time: number, cross?: number): void {
    const lang = getLang();
    const caret = Math.floor(time / 500) % 2 === 0;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#37999c'); g.addColorStop(1, '#2a7f86');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    icon(28, 30, tr('System', 'Equipo', lang), 0);
    icon(28, 112, tr('Garden', 'Jardín', lang), 1);
    icon(28, 194, tr('Notes', 'Notas', lang), 2);

    ctx.save(); ctx.translate(CX, CY); ctx.scale(SCALE, SCALE); ctx.translate(-CX, -CY);
    bevel(D.x, D.y, D.w, D.h);
    const tg = ctx.createLinearGradient(D.x, 0, D.x + D.w, 0); tg.addColorStop(0, '#0a1f6b'); tg.addColorStop(1, '#3a6fc0');
    ctx.fillStyle = tg; ctx.fillRect(D.x + 3, D.y + 3, D.w - 6, 24);
    text('SILICON DREAMS // ARCHIVE', D.x + 10, D.y + 15, 13, '#ffffff', 'bold');
    bevel(D.x + D.w - 24, D.y + 6, 18, 18); text('x', D.x + D.w - 18, D.y + 14, 12);

    text(tr('Reopen a paused repo & export a Kiro Revival Spec', 'Elige un proyecto abandonado para volver a abrirlo', lang), D.x + PAD, D.y + 42, 12, '#2b2b27');
    daisy(D.x + D.w - 30, D.y + 84);

    text(tr('Your name', 'Nombre', lang), X0, D.y + 58, 13);
    field(rect.name, name, tr('optional (defaults to Visitor)', 'tu nombre (opcional)', lang), focus === 'name', caret);

    text(tr('Source', 'Origen', lang), X0, D.y + 106, 13);
    const originLabel: Record<Origin, string> = {
      Demo: tr('Samples', 'Muestras', lang),
      GitHub: 'GitHub',
      Carpeta: tr('Folder', 'Carpeta', lang),
    };
    ORIGINS.forEach((o, i) => chip(rect.origins[i], originLabel[o], o === origin));

    if (origin === 'GitHub') {
      field(rect.detail, repo, 'owner/repo or github.com/owner/repo', focus === 'repo', caret);
      text(tr('Public repo (reads tree, commits & top source files)', 'Repo público (lee árbol, commits y archivos fuente)', lang), X0, D.y + 204, 11, '#4a4a46');
    } else if (origin === 'Carpeta') {
      const [fx, fy, fw, fh] = rect.detail;
      bevel(fx, fy, fw, fh);
      const label = folder ? fit(folder, fw - 70, 13) + '  (' + files + ')' : tr('Choose local folder...', 'Elegir carpeta...', lang);
      text(label, fx + 9, fy + fh / 2 + 1, 13, '#101010', folder ? '' : 'bold');
      text(tr('100% read-only in browser · nothing uploaded', 'Solo lectura local · nada se sube', lang), X0, D.y + 204, 11, '#4a4a46');
    } else {
      PRESET_CHIPS.forEach((p, i) => chip(rect.presets[i], p.label, p.id === presetId));
      const notes: Record<PresetId, string> = {
        trazo: tr('TRAZO: real app snapshot with captures & DAG', 'TRAZO: app real con capturas y grafo DAG', lang),
        boundary: tr('BOUNDARY: real Python lab with import graph & TODOs', 'BOUNDARY: lab Python real con grafo y TODOs', lang),
        'sentinel-lab': tr('Sentinel Lab: synthetic Python security course [DEMO]', 'Sentinel Lab: curso de seguridad Python [DEMO]', lang),
      };
      text(notes[presetId], X0, D.y + 204, 11, presetId === 'sentinel-lab' ? '#7a4a12' : '#3a4a68');
    }

    text(tr('Pace', 'Ritmo', lang), X0, D.y + 224, 12);
    PACE_CHIPS.forEach((p, i) => chip(rect.paces[i], lang === 'es' ? p.es : p.en, p.id === pace, 12));
    const [bx, by, bw, bh] = rect.button;
    bevel(bx, by, bw, bh);
    ctx.strokeStyle = '#101010'; ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
    center(tr('Connect', 'Conectar', lang), bx + bw / 2, by + bh / 2 + 1, 14, '#101010', 'bold');

    const hint = status || (origin === 'Demo' ? tr('Ready in 1 click · Tab anytime for No-3D Dossier', 'Listo en 1 clic · Tab abre la ficha sin esperar', lang) : tr('Press Enter to enter the CRT', 'Enter para cruzar el vidrio', lang));
    text(hint, X0, D.y + 290, 11, statusError ? '#a01818' : '#4a4a46');
    ctx.restore();

    bevel(0, H - 34, W, 34);
    bevel(6, H - 29, 74, 24); text(tr('Start', 'Inicio', lang), 20, H - 17, 13, '#101010', 'bold');
    bevel(W - 96, H - 29, 90, 24, true); text('21:07', W - 66, H - 17, 13);

    if (cross !== undefined) {
      const sweep = THREE.MathUtils.clamp((cross - 0.05) / 0.5, 0, 1);
      const y = sweep * H;
      ctx.fillStyle = 'rgba(160,255,240,' + (0.25 * sweep).toFixed(3) + ')'; ctx.fillRect(0, 0, W, y);
      if (sweep > 0 && sweep < 1) { ctx.shadowColor = '#bffff4'; ctx.shadowBlur = 24; ctx.fillStyle = '#f2fffb'; ctx.fillRect(0, y - 2, W, 4); ctx.shadowBlur = 0; }
      const white = THREE.MathUtils.clamp((cross - 0.5) / 0.3, 0, 1);
      ctx.fillStyle = 'rgba(235,255,250,' + (white * white).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
    }
    texture.needsUpdate = true;
  }

  const ui: LoginUI = {
    get name() { return name; },
    get repo() { return repo; },
    get folder() { return folder; },
    get origin() { return origin; },
    get presetId() { return presetId; },
    get pace() { return pace; },
    get focus() { return focus; },
    set focus(f: Focus) { focus = f; },
    setName(v) { name = v.replace(/[^\p{L}\p{N} _.\-]/gu, '').slice(0, 16); },
    setRepo(v) { repo = v.replace(/\s/g, '').slice(0, 80); },
    setFolder(n, count) { folder = n; files = count; status = ''; },
    setOrigin(o) { origin = o; status = ''; focus = o === 'GitHub' ? 'repo' : 'name'; },
    stepOrigin(d) { ui.setOrigin(ORIGINS[(ORIGINS.indexOf(origin) + d + ORIGINS.length) % ORIGINS.length]); },
    setPreset(id) { presetId = id; origin = 'Demo'; status = ''; },
    setPace(p) { pace = p; status = ''; },
    setStatus(msg) { status = msg; statusError = msg.length > 0; },
    validate() {
      const lang = getLang();
      if (origin === 'GitHub' && !GITHUB.test(repo)) return tr('Enter owner/repo or a github.com URL', 'Enlace de GitHub no válido (usa owner/repo)', lang);
      if (origin === 'Carpeta' && !folder) return tr('Pick a folder first', 'Elige una carpeta primero', lang);
      return null;
    },
    hit(u, v) {
      const x = (u * W - CX) / SCALE + CX; const y = (v * H - CY) / SCALE + CY;
      if (inside(x, y, rect.button)) return 'button';
      const oi = rect.origins.findIndex((r) => inside(x, y, r));
      if (oi >= 0) return { chip: ORIGINS[oi] };
      const pi = rect.paces.findIndex((r) => inside(x, y, r));
      if (pi >= 0) return { pace: PACE_CHIPS[pi].id };
      if (origin === 'Demo') {
        const si = rect.presets.findIndex((r) => inside(x, y, r));
        if (si >= 0) return { preset: PRESET_CHIPS[si].id };
      }
      if (inside(x, y, rect.name)) return 'name';
      if (inside(x, y, rect.detail)) return origin === 'GitHub' ? 'repo' : origin === 'Carpeta' ? 'folder' : 'glass';
      return 'glass';
    },
    draw,
    texture,
    reset() { name = ''; repo = ''; folder = ''; files = 0; origin = 'Demo'; presetId = 'boundary'; pace = 'demo'; focus = 'name'; status = ''; },
  };
  return ui;
}