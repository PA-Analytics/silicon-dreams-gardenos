import * as THREE from 'three/webgpu';
import { abs, dot, float, floor, fract, length, max, mix, normalize, pass, positionLocal, positionWorldDirection, pow, renderOutput, screenCoordinate, screenUV, sin, smoothstep, texture, time as tslTime, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createLoginUI } from './login.ts';
import { createHologram } from './hologram.ts';
import { focusSelectorFor, type DossierFocusTarget } from './focus-target.ts';
import { loadReception, makeDust, WALK, type Reception } from './reception.ts';
import { colorRamp, getSharedNoiseTexture, type TSLNode } from '../shaders/noise.ts';
import { ISLAND_EYE, loadIsland, type Island } from './island.ts';
import type { Body } from './island-physics.ts';
import type { IslandPoi } from '../explore.ts';
import { createAmbience } from './ambience.ts';
import { createPresetDossier, ingestGitHubRepo, ingestLocalFiles, type ProjectDossier, type PresetId, type VerdictId } from './ingest.ts';
import { createStoryEngine, VERDICT_OPTIONS, type StoryEngine, type StoryBeat, lineSeconds, typeDelayMs } from './story.ts';
import { formatArchiveCard, formatKiroDesignMd, formatKiroHookJson, formatKiroRequirementsMd, formatKiroRevivalSpec, formatKiroTasksMd, loadProjectMemory, saveProjectMemory } from './kiro-export.ts';
import { getLang, setLang, tr } from './i18n.ts';

interface CamMeta { position: [number, number, number]; quaternion: [number, number, number, number]; lensMm: number; sensorWidthMm: number }
interface LightMeta { name: string; type: 'POINT' | 'AREA' | 'SPOT' | 'SUN'; position: [number, number, number]; direction: [number, number, number]; color: [number, number, number]; energy: number; size: number }
interface GardenMeta { exposure: number; sky: Array<[number, [number, number, number]]>; cameras: Record<string, CamMeta>; lights: LightMeta[] }

const LIGHT_GAIN = 0.85;
const isMobile = matchMedia('(pointer: coarse)').matches;
type V3 = [number, number, number];
const lin = (r: number, g: number, b: number): V3 => [r, g, b];

function timber(across: V3, along: V3, dark: V3, light: V3, varnish?: V3): TSLNode {
  const lut = getSharedNoiseTexture();
  const puv = vec2(dot(positionLocal, vec3(...across)), dot(positionLocal, vec3(...along)));
  const n = texture(lut, puv).r;
  const fine = texture(lut, puv.mul(vec2(3.1, 2.3)).add(0.37)).g;
  const grain = colorRamp(n.mul(0.75).add(fine.mul(0.25)), [[0.36, dark], [0.64, light]]);
  if (!varnish) return grain;
  const wear = smoothstep(0.52, 0.6, texture(lut, puv.mul(vec2(0.35, 0.6)).add(0.61)).r);
  return mix(grain, vec3(...varnish), wear);
}
const PROCEDURAL: Record<string, () => TSLNode> = {
  'Oiled walnut': () => timber([0, 2.2, 2.2], [0.12, 0, 0], lin(0.042, 0.022, 0.012), lin(0.235, 0.133, 0.062), lin(0.072, 0.085, 0.068)),
  'Bare timber': () => timber([0, 2.6, 2.6], [0.15, 0, 0], lin(0.085, 0.043, 0.02), lin(0.33, 0.21, 0.112), lin(0.072, 0.085, 0.068)),
  M_Wood_Wall: () => timber([1.6, 0, 1.6], [0, 0.07, 0], lin(0.032, 0.016, 0.009), lin(0.184, 0.086, 0.036)),
  'Painted sage': () => timber([2.4, 0, 2.4], [0, 0.18, 0], lin(0.07, 0.085, 0.072), lin(0.1, 0.118, 0.1), lin(0.2, 0.115, 0.055)),
  'Upholstery | worn tan': () => timber([7, 5, 0], [0, 5, 7], lin(0.16, 0.09, 0.048), lin(0.22, 0.13, 0.07)),
  M_Wood_Floor: () => timber([1.8, 0, 0], [0, 0, 0.09], lin(0.048, 0.025, 0.014), lin(0.21, 0.102, 0.043)),
};
const OUTSIDE = /Pine|Dusk|Exterior|Shed|Cabin/;
const MOON_DIR: [number, number, number] = [0.2, 0.2, -1];

function islandFov(aspect: number): number {
  if (aspect >= 4 / 3) return 46;
  return Math.min(74, THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(23)) * (4 / 3)) / Math.max(aspect, 0.54))));
}
function fovFor(cam: CamMeta, aspect: number): number {
  const h = 2 * Math.atan(cam.sensorWidthMm / 2 / cam.lensMm);
  const v = (a: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / a));
  return Math.max(v(aspect), v(16 / 9));
}

async function init(): Promise<void> {
  const byId = (id: string) => document.getElementById(id)!;
  const modal = byId('dossierModal') as HTMLDialogElement;
  const note = byId('creatorNote') as HTMLTextAreaElement;
  const quickBar = byId('quickBar');
  const recHud = byId('recHud');
  const dlg = byId('dlg');
  const dlgTxt = byId('dlgTxt');
  const poiEl = byId('poi');
  const whoEl = byId('who');
  const recInfo = byId('recInfo');
  const flash = byId('flash');
  const veil = byId('veil');
  const recTitle = byId('recTitle');
  const reception = byId('reception');
  const prompt = byId('prompt');
  const nameInput = byId('nameInput') as HTMLInputElement;
  const folderInput = byId('folderInput') as HTMLInputElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  type Phase = 'idle' | 'zoomed' | 'crossing' | 'loading' | 'reception' | 'island';
  let phase: Phase = 'idle';
  let ready3D = false;
  let activeDossier: ProjectDossier | null = null;
  let dossierPromise: Promise<ProjectDossier> | null = null;
  let story: StoryEngine | null = null;
  let island: Island | null = null;
  let rec: Reception | null = null;
  let recPromise: Promise<Reception> | null = null;
  let islandPromise: Promise<Island> | null = null;
  let triggerResetToCrt: () => void = () => {};
  let triggerEnter3DFromDossier: () => void = () => {};
  let folderCallback: ((files: File[]) => void) | null = null;
  let saveMessage = '';
  let saveError = false;
  let activePoi: IslandPoi | null = null;
  let transition = 0; let diversionAt = 0; let ringAt = 0; let islandTime = 0;
  let inTunnel = false; let entering = false; let doorOpened = false; let islandAt = 0; let islandLive = false;
  let exitTimer = 0; let poiTimer = 0;
  let beepCtx: AudioContext | null = null;
  const ambience = createAmbience(() => beepCtx);
  const loginUI = createLoginUI();
  const heldKeys = new Set<string>();
  const joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  const resetInput = () => { heldKeys.clear(); joy.id = -1; joy.x = joy.y = 0; };
  const walking = () => phase === 'reception' || phase === 'island';

  const unlockAudio = () => {
    if (ambience.muted) return;
    try { if (!beepCtx) { beepCtx = new AudioContext(); ambience.setZone('room'); } if (beepCtx.state === 'suspended') void beepCtx.resume().catch(() => {}); } catch { /* optional */ }
  };
  const ensureAudio = () => { unlockAudio(); return !ambience.muted && beepCtx?.state === 'running' ? beepCtx : null; };

  // ---- Zero-GPU / Pre-3D Dossier & Language UI (mounted BEFORE WebGPURenderer!) ----
  const syncLangUi = () => {
    const lang = getLang();
    document.documentElement.lang = lang;
    const nextCode = lang === 'en' ? 'ES' : 'EN';
    for (const id of ['btnLangTop', 'btnLangHud', 'btnLangModal']) byId(id).textContent = nextCode;
    byId('btnQuickDossier').textContent = tr('Quick Dossier (No 3D)', 'Ficha directa (Sin 3D)', lang);
    byId('btnDossier').textContent = tr('Dossier [Tab]', 'Expediente [Tab]', lang);
    byId('btnSkipIsland').textContent = tr('Skip to Island', 'Ir a la isla', lang);
    byId('btnTime').textContent = tr('Day / Night', 'Día / Noche', lang);
    byId('btnExitHud').textContent = tr('Exit', 'Salir', lang);
    byId('btnMute').textContent = ambience.muted ? tr('Audio: off', 'Audio: no', lang) : 'Audio';
    byId('dosOverline').textContent = tr('Archive of Unfinished Things · Recovery Dossier', 'Archivo de lo inconcluso · Ficha de recuperación', lang);
    byId('btnCloseDossier').textContent = tr('Close [Esc]', 'Cerrar [Esc]', lang);
    byId('btnLoadRepo').textContent = tr('Load GitHub', 'Cargar GitHub', lang);
    byId('btnLoadFolder').textContent = tr('Folder', 'Carpeta', lang);
    byId('btnCopyKiroTop').textContent = tr('Copy Kiro Spec', 'Copiar Kiro Spec', lang);
    byId('sec01').textContent = tr('01 · Observed Evidence & Hypothesis', '01 · Evidencia observada e hipótesis', lang);
    byId('sec02').textContent = tr('02 · Creator Note (Local Browser Only)', '02 · Tu recuerdo del creador (Solo local)', lang);
    note.placeholder = tr('What were you trying to finish here?', '¿Qué estabas intentando resolver aquí?', lang);
    byId('sec03').textContent = tr('03 · Verdict', '03 · Veredicto', lang);
    byId('sec04').textContent = tr('04 · Kiro Revival Pack (.kiro/specs/revive-*)', '04 · Kiro Revival Pack (.kiro/specs/revive-*)', lang);
    byId('btnCopyKiro').textContent = tr('Copy Kiro Spec', 'Copiar Kiro Spec', lang);
    byId('btnAnother').textContent = tr('Back to CRT', 'Volver al CRT', lang);
    byId('veilText').textContent = tr('Connecting to reception', 'Conectando con recepción', lang);
    byId('back').textContent = tr('Back to start', 'Volver al inicio', lang);
    for (const v of VERDICT_OPTIONS) {
      const b = modal.querySelector<HTMLButtonElement>(`[data-verdict="${v.id}"]`);
      if (!b) continue;
      b.querySelector('b')!.textContent = lang === 'es' ? v.labelEs : v.label;
      b.querySelector('small')!.textContent = lang === 'es' ? v.hintEs : v.hint;
    }
    if (modal.open && activeDossier && story) {
      byId('dosHonest').textContent = lang === 'es' ? (activeDossier.honestyNoteEs || activeDossier.honestyNote) : activeDossier.honestyNote;
      renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro);
      renderVerdict();
      byId('btnResume').textContent = !ready3D ? tr('3D Unavailable (Dossier Active)', 'Sin 3D (Ficha activa)', lang) : phase === 'idle' || phase === 'zoomed' ? tr('Enter 3D World', 'Entrar al mundo 3D', lang) : phase === 'reception' ? tr('Go to Island', 'Ir a la isla', lang) : tr('Resume Island', 'Seguir en la isla', lang);
    }
  };

  const updateSaveStatus = () => {
    const status = byId('saveStatus'); status.textContent = saveMessage; status.dataset.error = String(saveError);
  };
  const persist = () => {
    if (!story) return;
    const result = saveProjectMemory(story.dossier.id, { creatorNote: story.creatorNote, verdict: story.verdict, savedAt: new Date().toISOString() });
    saveError = !result.ok;
    saveMessage = result.ok ? tr('Saved locally in this browser.', 'Guardado en este navegador.', getLang()) : tr(`Save failed: ${result.error ?? 'storage unavailable'}`, `No se pudo guardar: ${result.error ?? 'almacenamiento no disponible'}`, getLang());
    updateSaveStatus();
  };
  const renderVerdict = (message?: string) => {
    const lang = getLang();
    const option = VERDICT_OPTIONS.find((v) => v.id === story?.verdict);
    for (const btn of modal.querySelectorAll<HTMLButtonElement>('[data-verdict]')) btn.setAttribute('aria-pressed', String(btn.dataset.verdict === option?.id));
    const fallback = option ? (lang === 'es' ? option.closingSubtitleEs : option.closingSubtitle) : '';
    byId('verdictBanner').textContent = message ?? fallback;
    byId('verdictBanner').classList.toggle('on', !!(message || option));
  };

  const selectTodo = (idx: number) => {
    if (!activeDossier || !story) return;
    activeDossier.activeTodoIndex = idx;
    if (island) island.applyDossier(activeDossier, story);
    renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro, idx);
  };
  const toggleTodoInKiro = (todoId: string) => {
    if (!activeDossier || !story) return;
    const allIds = (activeDossier.todos ?? []).map((t) => t.id);
    const cur = new Set(activeDossier.selectedTodoIds ?? allIds);
    if (cur.has(todoId)) cur.delete(todoId); else cur.add(todoId);
    activeDossier.selectedTodoIds = [...cur];
    if (island) island.applyDossier(activeDossier, story);
    renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro, 'kiro');
  };

  const placePoi = () => {
    const dlgVisible = dlg.classList.contains('on');
    const showPoi = phase === 'island' && !!activePoi && !dlgVisible && !modal.open;
    poiEl.hidden = !showPoi;
    poiEl.classList.toggle('on', showPoi);
  };

  const updateHud = () => {
    byId('storyObj').textContent = story?.getObjective() ?? '';
    byId('btnSkipIsland').hidden = phase !== 'reception';
    byId('btnTime').hidden = phase !== 'island';
    byId('btnTime').setAttribute('aria-pressed', String(!!island?.isNight));
    if (activePoi && story) byId('poiAct').textContent = story.getPoiActionLabel(activePoi.id);
    placePoi();
  };

  const refreshDossierDom = () => {
    if (!activeDossier || !story) return;
    const d = activeDossier; const lang = getLang();
    byId('dosTitle').textContent = d.projectName;
    byId('dosMeta').textContent = `${d.archetypeLabel} · ${d.origin} · ${d.sourceLabel}`;
    const badgeText = d.isDemo ? 'DEMO' : d.presetId ? 'SNAPSHOT' : 'ORIGINAL';
    byId('dosBadge').textContent = badgeText;
    byId('dosBadge').classList.toggle('demo', d.isDemo);
    byId('dosHonest').textContent = lang === 'es' ? (d.honestyNoteEs || d.honestyNote) : d.honestyNote;
    byId('dosHonest').classList.toggle('demo', d.isDemo);
    renderEvidence(byId('dosGrid'), d, story, selectTodo, toggleTodoInKiro);
    byId('creatorNoteLbl').textContent = tr(`Creator Note (${d.visitorName}) · Stored only in localStorage`, `Recuerdo de ${d.visitorName} · Solo se guarda en localStorage`, lang);
    note.value = story.creatorNote;
    updateSaveStatus();
    renderVerdict();
    byId('exportStatus').textContent = '';
    byId('btnResume').textContent = !ready3D ? tr('3D Unavailable (Dossier Active)', 'Sin 3D (Ficha activa)', lang) : phase === 'idle' || phase === 'zoomed' ? tr('Enter 3D World', 'Entrar al mundo 3D', lang) : phase === 'reception' ? tr('Go to Island', 'Ir a la isla', lang) : tr('Resume Island', 'Seguir en la isla', lang);
  };
  const mountDossierIntoModal = (d: ProjectDossier) => {
    const lang = getLang();
    if (activeDossier && activeDossier !== d) activeDossier.dispose();
    activeDossier = d;
    const mem = loadProjectMemory(d.id);
    story = createStoryEngine(d, loginUI.pace, mem);
    saveMessage = mem ? tr('Restored saved note from this browser.', 'Memoria recuperada de este navegador.', lang) : tr('No saved note yet.', 'Todavía no hay nota guardada.', lang);
    saveError = false;
    if (rec) rec.setLines(story.getReceptionLines());
    if (island) island.applyDossier(d, story);
    refreshDossierDom();
  };

  const openDossier = async (direct = true, overrideDossier?: ProjectDossier) => {
    if (modal.open && !overrideDossier) return;
    if (!overrideDossier && !activeDossier) {
      byId('exportStatus').textContent = tr('Loading repository dossier...', 'Cargando expediente...', getLang());
      const d = await (dossierPromise ?? Promise.resolve(createPresetDossier(loginUI.presetId, loginUI.name || 'Visitor')));
      mountDossierIntoModal(d);
    } else if (overrideDossier) {
      mountDossierIntoModal(overrideDossier);
    } else if (activeDossier && !story) {
      mountDossierIntoModal(activeDossier);
    } else {
      refreshDossierDom();
    }
    if (direct && story) story.openDirectAccess();
    if (phase === 'reception' && entering) { ++transition; entering = false; flash.style.opacity = '0'; }
    window.clearTimeout(exitTimer); resetInput();
    if (document.pointerLockElement) document.exitPointerLock();
    recHud.classList.add('modal-open');
    if (!modal.open) modal.showModal();
    byId('dossierCard').scrollTop = 0;
    byId('dosTitle').focus();
    updateHud();
  };

  const closeDossier = () => {
    if (!modal.open) return;
    modal.close(); resetInput();
    recHud.classList.remove('modal-open');
    updateHud();
    const targetFocus = walking() ? byId('btnDossier') : byId('btnQuickDossier');
    targetFocus.focus({ preventScroll: true });
  };

  const loadRepoIntoDossier = async (repoStr: string) => {
    const q = repoStr.trim();
    if (!q) return;
    byId('dosHonest').textContent = tr(`Fetching public repository ${q}…`, `Consultando repositorio público ${q}…`, getLang());
    const d = await ingestGitHubRepo(q, loginUI.name || 'Visitor');
    loginUI.setOrigin('GitHub'); loginUI.setRepo(q);
    await openDossier(true, d);
  };

  const loadPresetIntoDossier = async (id: PresetId) => {
    loginUI.setPreset(id);
    const d = createPresetDossier(id, loginUI.name || 'Visitor');
    await openDossier(true, d);
  };

  byId('btnQuickDossier').onclick = () => void openDossier(true);
  byId('btnDossier').onclick = () => void openDossier(true);
  byId('btnCloseDossier').onclick = closeDossier;
  byId('btnLoadRepo').onclick = () => void loadRepoIntoDossier((byId('quickRepoInput') as HTMLInputElement).value);
  byId('quickRepoInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void loadRepoIntoDossier((byId('quickRepoInput') as HTMLInputElement).value); } });
  byId('btnLoadTrazo').onclick = () => void loadPresetIntoDossier('trazo');
  byId('btnLoadBoundary').onclick = () => void loadPresetIntoDossier('boundary');
  byId('btnLoadSentinel').onclick = () => void loadPresetIntoDossier('sentinel-lab');
  byId('btnLoadFolder').onclick = () => {
    folderCallback = async (files) => {
      if (!files.length) return;
      const first = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      const name = first.split('/')[0] || files[0].name;
      const d = await ingestLocalFiles(files, loginUI.name || 'Visitor', name);
      await openDossier(true, d);
    };
    folderInput.click();
  };
  byId('btnBootDossier').onclick = () => {
    const val = (byId('bootRepoInput') as HTMLInputElement).value.trim();
    if (val) void loadRepoIntoDossier(val); else void openDossier(true);
  };
  const toggleLanguage = () => { setLang(getLang() === 'en' ? 'es' : 'en'); syncLangUi(); };
  byId('btnLangTop').onclick = toggleLanguage;
  byId('btnLangHud').onclick = toggleLanguage;
  byId('btnLangModal').onclick = toggleLanguage;
  note.addEventListener('input', () => { story?.setCreatorNote(note.value); persist(); });
  modal.addEventListener('cancel', (e) => { e.preventDefault(); closeDossier(); });

  const downloadText = (filename: string, content: string, mime = 'text/markdown;charset=utf-8') => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: mime }));
    link.download = filename;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    byId('exportStatus').textContent = tr(`Downloaded: ${filename}`, `Descarga solicitada: ${filename}`, getLang());
  };
  const curSlug = () => (activeDossier?.projectName || 'project').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48).replace(/^-|-$/g, '') || 'project';
  const copyKiro = async () => {
    if (!story) return;
    try { await navigator.clipboard.writeText(formatKiroRevivalSpec(story.dossier, story.verdict, story.creatorNote, getLang())); byId('exportStatus').textContent = tr('Kiro Revival Pack copied to clipboard.', 'Kiro Revival Pack copiado al portapapeles.', getLang()); }
    catch { byId('exportStatus').textContent = tr('Clipboard unavailable — use the Markdown download buttons.', 'Portapapeles no disponible — usa los botones de descarga.', getLang()); }
  };
  byId('btnCopyKiro').onclick = copyKiro;
  byId('btnCopyKiroTop').onclick = copyKiro;
  byId('btnDownloadReqs').onclick = () => { if (story) downloadText('requirements.md', formatKiroRequirementsMd(story.dossier, story.creatorNote, getLang())); };
  byId('btnDownloadKiro').onclick = () => { if (story) downloadText(`kiro-revival-${curSlug()}.md`, formatKiroRevivalSpec(story.dossier, story.verdict, story.creatorNote, getLang())); };
  const chooseVerdictZeroGpu = (id: VerdictId) => {
    if (!story) return;
    const { beat } = story.chooseVerdict(id);
    if (phase === 'island' && island) { island.setNight(id !== 'restore'); island.setSeraph(id === 'leave'); island.setTunnelVera(true, id !== 'leave'); ambience.setZone(id !== 'restore' ? 'island-night' : 'island-day'); ringAt = 0; }
    ambience.playVerdict(id); persist(); renderVerdict(saveError ? `${beat.text} ${saveMessage}` : beat.text); updateHud();
  };
  for (const v of VERDICT_OPTIONS) modal.querySelector<HTMLButtonElement>(`[data-verdict="${v.id}"]`)!.onclick = () => chooseVerdictZeroGpu(v.id);
  byId('btnAnother').onclick = () => { if (ready3D) triggerResetToCrt(); else { closeDossier(); } };
  byId('btnResume').onclick = () => { closeDossier(); if (ready3D) triggerEnter3DFromDossier(); };
  folderInput.addEventListener('change', () => {
    const list = [...(folderInput.files ?? [])];
    if (folderCallback) { const cb = folderCallback; folderCallback = null; void cb(list); }
  });
  byId('btnDownloadDesign').onclick = () => { if (story) downloadText('design.md', formatKiroDesignMd(story.dossier, getLang())); };
  byId('btnDownloadTasks').onclick = () => { if (story) downloadText('tasks.md', formatKiroTasksMd(story.dossier, story.creatorNote, getLang())); };
  byId('btnDownloadHook').onclick = () => { if (story) downloadText('revival-check.json', formatKiroHookJson(story.dossier), 'application/json;charset=utf-8'); };
  byId('btnDownloadCard').onclick = () => { if (story) downloadText(`ARCHIVE_CARD-${curSlug()}.md`, formatArchiveCard(story.dossier, story.creatorNote, getLang())); };

  syncLangUi();

  // Check URL ?repo=owner/name or ?preset=trazo|boundary|sentinel-lab BEFORE starting WebGPU!
  const qs = new URLSearchParams(location.search);
  const urlRepo = qs.get('repo');
  const urlPreset = qs.get('preset');
  if (urlRepo) {
    void loadRepoIntoDossier(urlRepo);
  } else if (urlPreset === 'trazo' || urlPreset === 'boundary' || urlPreset === 'sentinel-lab') {
    void loadPresetIntoDossier(urlPreset);
  }

  // ---- 3D WebGPU Stage (if WebGPU/GLB fails, Direct Dossier remains 100% functional) ----
  let renderer: THREE.WebGPURenderer;
  let meta: GardenMeta;
  let gltf: { scene: THREE.Group };
  try {
    renderer = new THREE.WebGPURenderer({ antialias: false });
    await renderer.init();
    renderer.setPixelRatio(isMobile ? 0.8 : 0.85);
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    byId('app').appendChild(renderer.domElement);
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    [meta, gltf] = await Promise.all([
      fetch('/gardenos-meta.json').then((r) => r.json() as Promise<GardenMeta>),
      new GLTFLoader().setDRACOLoader(draco).loadAsync('/models/gardenos-v03.glb'),
    ]);
    renderer.toneMappingExposure = 2 ** meta.exposure;
  } catch (err) {
    console.error(err);
    byId('bootErrMsg').textContent = tr(
      `3D WebGPU scene could not initialize (${err instanceof Error ? err.message : String(err)}). Direct Dossier & Kiro Export remain fully active:`,
      `La escena 3D WebGPU no pudo iniciar (${err instanceof Error ? err.message : String(err)}). La Ficha directa y Kiro Export siguen activos:`,
      getLang(),
    );
    byId('bootFallback').classList.add('on');
    return;
  }

  const scene = new THREE.Scene();
  const skyRamp: TSLNode = colorRamp(positionWorldDirection.y.mul(0.5).add(0.5), meta.sky.map(([p, c]) => [0.5 + p * 0.5, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.75]] as [number, V3]));
  const dir: TSLNode = positionWorldDirection;
  const sp: TSLNode = dir.xz.div(abs(dir.y).add(0.35)).mul(26);
  const starCell: TSLNode = floor(sp);
  const rnd: TSLNode = fract(sin(dot(starCell, vec2(12.9898, 78.233))).mul(43758.5453));
  const twinkle: TSLNode = sin(tslTime.mul(rnd.mul(3).add(0.8)).add(rnd.mul(40))).mul(0.35).add(0.65);
  const star: TSLNode = smoothstep(0.16, 0.02, length(fract(sp).sub(0.5))).mul(smoothstep(0.9, 0.97, rnd)).mul(smoothstep(0.06, 0.3, dir.y)).mul(twinkle);
  const moonDot: TSLNode = max(dot(dir, normalize(vec3(...MOON_DIR))), 0);
  const moon: TSLNode = smoothstep(0.99962, 0.99974, moonDot).mul(1.1).add(pow(moonDot, float(900)).mul(0.22)).add(pow(moonDot, float(60)).mul(0.035));
  scene.backgroundNode = skyRamp.add(vec3(0.75, 0.82, 1.0).mul(star).mul(0.5)).add(vec3(0.95, 0.93, 0.8).mul(moon));
  scene.add(gltf.scene);

  const replaced = new Map<THREE.Material, THREE.Material>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    const outside = OUTSIDE.test(mesh.name) || OUTSIDE.test(mesh.parent?.name ?? '');
    mesh.castShadow = !outside; mesh.receiveShadow = !outside;
    const src = mesh.material as THREE.MeshStandardMaterial; src.flatShading = true;
    const make = PROCEDURAL[src.name]; if (!make) return;
    let mat = replaced.get(src);
    if (!mat) {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.84, metalness: 0, name: src.name });
      m.flatShading = true; m.colorNode = make(); replaced.set(src, (mat = m)); src.dispose();
    }
    mesh.material = mat;
  });

  scene.add(new THREE.HemisphereLight(0x22355c, 0x1a1008, 0.9));
  let shadowCaster = true;
  const roomLights: Record<string, { light: THREE.Light; base: number }> = {};
  for (const l of [...meta.lights].sort((a, b) => b.energy - a.energy)) {
    const color = new THREE.Color().setRGB(...l.color, THREE.LinearSRGBColorSpace);
    const intensity = (l.energy / (4 * Math.PI)) * LIGHT_GAIN * (l.type === 'AREA' ? (l.name === 'LGT_Exterior_Twilight' ? 1.2 : 4.5) : 1);
    const light = l.type === 'AREA' ? new THREE.SpotLight(color, intensity, 0, Math.PI / 2.4, 1, 2) : new THREE.PointLight(color, intensity, 0, 2);
    light.name = l.name; light.position.set(...l.position);
    if (light instanceof THREE.SpotLight) { light.target.position.set(...l.position).add(new THREE.Vector3(...l.direction)); scene.add(light.target); }
    if (shadowCaster && light instanceof THREE.PointLight && l.position[1] < 3) {
      light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.002; light.shadow.radius = 3; shadowCaster = false;
    }
    scene.add(light); roomLights[l.name] = { light, base: intensity };
  }
  scene.add(makeDust({ min: [-1.7, 0.75, -2.3], max: [1.7, 2.3, 0.9], count: 260, color: [1.0, 0.72, 0.42], gain: 0.4 }));

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 120);
  let active = meta.cameras.CAM_LOGIN_FRONT;
  const from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 50 };
  const to = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 50 };
  let t = 1;
  const goTo = (name: string, instant = false) => {
    active = meta.cameras[name] ?? meta.cameras.CAM_LOGIN_FRONT;
    from.p.copy(camera.position); from.q.copy(camera.quaternion); from.fov = camera.fov;
    to.p.set(...active.position); to.q.set(...active.quaternion); to.fov = fovFor(active, camera.aspect);
    t = instant ? 1 : 0;
    if (instant) { camera.position.copy(to.p); camera.quaternion.copy(to.q); camera.fov = to.fov; camera.updateProjectionMatrix(); }
  };
  goTo('CAM_LOGIN_FRONT', true);

  let screenMesh: THREE.Mesh | null = null;
  const pickables: THREE.Object3D[] = [];
  gltf.scene.traverse((o) => {
    if (o.name === 'SM_CRT_Screen') screenMesh = o as THREE.Mesh;
    if ((o as THREE.Mesh).isMesh && /^SM_(CRT|PC)_/.test(o.name)) pickables.push(o);
  });
  if (!screenMesh) throw new Error('SM_CRT_Screen not found in gardenos-v03.glb');
  const screen = screenMesh as THREE.Mesh;
  const screenSrc = screen.material as THREE.MeshStandardMaterial;
  const scanAmt = uniform(0);
  const screenMat = new THREE.MeshStandardNodeMaterial({ name: screenSrc.name, color: screenSrc.color, roughness: 0.42, metalness: 0 });
  screenMat.flatShading = true;
  {
    const suv: TSLNode = uv();
    const img: TSLNode = texture(loginUI.texture, suv).rgb;
    const lines: TSLNode = mix(float(1), sin(suv.y.mul(120 * 2 * Math.PI)).mul(0.5).add(0.5).mul(0.42).add(0.7), scanAmt);
    const d: TSLNode = suv.sub(0.5);
    const corner: TSLNode = float(1).sub(dot(d, d).mul(1.1));
    const roll: TSLNode = smoothstep(0.09, 0.0, abs(fract(suv.y.add(tslTime.mul(0.12))).sub(0.5))).mul(0.07);
    const hum: TSLNode = sin(tslTime.mul(83)).mul(0.012).add(1);
    screenMat.emissiveNode = img.mul(0.86).mul(lines).mul(corner).mul(hum).add(img.mul(roll)).add(vec3(0.006, 0.014, 0.012));
  }
  screen.material = screenMat; screenSrc.dispose(); screen.updateWorldMatrix(true, false);
  const glassCenter = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  let crossT = -1;
  const crossFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const crossQ = new THREE.Quaternion();
  const glassFront = glassCenter.clone().add(new THREE.Vector3(0, 0, 0.045));
  const glassBeyond = glassCenter.clone().add(new THREE.Vector3(0, 0, -0.06));
  crossQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(glassFront, glassCenter, new THREE.Vector3(0, 1, 0)));
  const pcBox = new THREE.Box3();
  for (const o of pickables) pcBox.expandByObject(o);
  const holo = createHologram(new THREE.Vector3((pcBox.min.x + pcBox.max.x) / 2, pcBox.max.y, pcBox.max.z), reduceMotion);
  scene.add(holo.group);
  const idleTargets = [...pickables, ...holo.hitTargets];
  let ctaOn = true;
  const updateCta = () => { ctaOn = phase === 'idle'; };

  for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'touchend'] as const) addEventListener(ev, unlockAudio, { passive: true });
  const pi = () => {
    if (!ctaOn || ambience.muted) return;
    if (!beepCtx && navigator.userActivation?.hasBeenActive) unlockAudio();
    if (!beepCtx) return;
    if (beepCtx.state !== 'running') { void beepCtx.resume(); return; }
    const t0 = beepCtx.currentTime;
    const o = beepCtx.createOscillator(); const g = beepCtx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1480, t0); o.frequency.setValueAtTime(1180, t0 + 0.05);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
    o.connect(g).connect(beepCtx.destination); o.start(t0); o.stop(t0 + 0.12);
  };
  const setPrompt = (text: string | null) => { if (text) { prompt.textContent = text; prompt.classList.add('quiet'); prompt.hidden = false; } else prompt.hidden = true; updateCta(); };

  const noise = (ac: AudioContext, sec: number) => {
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * sec), ac.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; return src;
  };
  const relay = () => {
    try {
      const ac = ensureAudio(); if (!ac) return;
      const click = (at: number, f: number) => {
        const src = noise(ac, 0.05); const bp = ac.createBiquadFilter(); const g = ac.createGain();
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.2; g.gain.value = 0.5;
        src.connect(bp).connect(g).connect(ac.destination); src.start(ac.currentTime + at);
      };
      click(0, 1800); click(0.09, 900);
      const o = ac.createOscillator(); const og = ac.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(60, ac.currentTime + 0.2); o.frequency.exponentialRampToValueAtTime(900, ac.currentTime + 2.1);
      og.gain.setValueAtTime(0.0001, ac.currentTime + 0.2); og.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + 1.6); og.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 2.4);
      o.connect(og).connect(ac.destination); o.start(ac.currentTime + 0.2); o.stop(ac.currentTime + 2.5);
    } catch { /* optional */ }
  };

  const syncInput = () => {
    const repoFocus = loginUI.focus === 'repo';
    nameInput.value = repoFocus ? loginUI.repo : loginUI.name;
    nameInput.maxLength = repoFocus ? 80 : 16;
    nameInput.inputMode = repoFocus ? 'url' : 'text';
  };
  const focusField = (f: 'name' | 'repo') => { loginUI.focus = f; syncInput(); nameInput.focus(); };
  const flyTo = (p: THREE.Vector3, q: THREE.Quaternion) => {
    from.p.copy(camera.position); from.q.copy(camera.quaternion); from.fov = camera.fov;
    to.p.copy(p); to.q.copy(q); to.fov = camera.fov; t = 0;
  };
  const zoomIn = () => {
    if (phase !== 'idle') return;
    phase = 'zoomed';
    recPromise ??= loadReception(); recPromise.catch(() => { recPromise = null; });
    const dist = 0.25 / 0.7 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const pos = glassCenter.clone().add(new THREE.Vector3(0, 0.004, Math.max(dist, 0.3)));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, glassCenter, new THREE.Vector3(0, 1, 0)));
    flyTo(pos, q);
    setPrompt(tr('Esc · back · Tab · switch source', 'Esc · salir · Tab · cambiar origen', getLang()));
    loginUI.setStatus(''); focusField('name');
  };
  const zoomOut = () => {
    if (phase !== 'zoomed') return;
    phase = 'idle'; nameInput.blur(); goTo('CAM_LOGIN_FRONT'); setPrompt(null);
  };
  let localFiles: File[] = [];
  const buildDossier = async (): Promise<ProjectDossier> => {
    if (activeDossier && ((loginUI.origin === 'Demo' && activeDossier.presetId === loginUI.presetId) || (loginUI.origin === 'GitHub' && activeDossier.id === 'github:' + loginUI.repo.trim().toLowerCase()))) {
      return activeDossier;
    }
    switch (loginUI.origin) {
      case 'Carpeta': return ingestLocalFiles(localFiles, loginUI.name, loginUI.folder);
      case 'GitHub': return ingestGitHubRepo(loginUI.repo, loginUI.name);
      case 'Demo': return createPresetDossier(loginUI.presetId, loginUI.name);
    }
  };
  const lockEl = renderer.domElement;
  lockEl.tabIndex = -1;
  const lockPointer = () => {
    if (modal.open || document.pointerLockElement === lockEl) return;
    try { void Promise.resolve((lockEl as HTMLElement).requestPointerLock()).catch(() => {}); } catch { /* drag fallback */ }
  };
  const connect = () => {
    if (phase !== 'zoomed' && phase !== 'idle') return;
    const error = loginUI.validate();
    if (error) { loginUI.setStatus(error); return; }
    if (!loginUI.name.trim()) loginUI.setName('Visitor');
    dossierPromise = buildDossier();
    void dossierPromise.catch(() => {});
    nameInput.blur(); quickBar.hidden = true;
    phase = 'crossing'; setPrompt(null);
    crossFrom.p.copy(camera.position); crossFrom.q.copy(camera.quaternion);
    t = 1; crossT = 0; relay(); lockPointer();
  };

  const recEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let recYaw = 0; let recPitch = 0; let recFromYaw = 0; let recFromPitch = 0; let recToYaw = 0; let recToPitch = 0;
  let lastUnlock = 0;
  const recPos = new THREE.Vector3(); const recBase = new THREE.Quaternion();
  const recFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 50 };
  const recTo = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 50 };
  let recT = 1; let camYawVel = 0; let camPitchVel = 0;
  const isl = { body: null as Body | null, camY: 0, bob: 0 };
  const prefetchIsland = () => { islandPromise ??= loadIsland(renderer, { reduceMotion }); islandPromise.catch(() => { islandPromise = null; }); return islandPromise; };

  addEventListener('keydown', (e) => { if (!modal.open && walking()) heldKeys.add(e.key.toLowerCase()); });
  addEventListener('keyup', (e) => heldKeys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => heldKeys.clear());
  const moveInput = () => ({
    fwd: THREE.MathUtils.clamp((heldKeys.has('w') || heldKeys.has('arrowup') ? 1 : 0) - (heldKeys.has('s') || heldKeys.has('arrowdown') ? 1 : 0) - joy.y, -1, 1),
    side: THREE.MathUtils.clamp((heldKeys.has('d') || heldKeys.has('arrowright') ? 1 : 0) - (heldKeys.has('a') || heldKeys.has('arrowleft') ? 1 : 0) + joy.x, -1, 1),
  });
  const lookBy = (dx: number, dy: number) => {
    if (modal.open) return;
    recYaw -= dx * 0.0022; recPitch = THREE.MathUtils.clamp(recPitch - dy * 0.0022, -1.35, 1.35); recT = 1;
  };
  document.addEventListener('mousemove', (e) => { if ((walking() || phase === 'loading') && document.pointerLockElement === lockEl) lookBy(e.movementX, e.movementY); });
  document.addEventListener('pointerlockchange', () => {
    const on = document.pointerLockElement === lockEl;
    if (on && modal.open) { document.exitPointerLock(); return; }
    recHud.classList.toggle('locked', on);
    if (!on) lastUnlock = performance.now();
  });
  lockEl.addEventListener('pointerdown', (e) => {
    if (!walking() && phase !== 'loading' && phase !== 'crossing') return;
    lockEl.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      if (walking() && joy.id < 0 && e.clientX < innerWidth * 0.42) { joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0; }
      return;
    }
    if (document.pointerLockElement !== lockEl) lockPointer(); else e.preventDefault();
  });
  lockEl.addEventListener('pointermove', (e) => {
    if (!walking()) return;
    if (e.pointerId === joy.id) { joy.x = THREE.MathUtils.clamp((e.clientX - joy.ox) / 46, -1, 1); joy.y = THREE.MathUtils.clamp((e.clientY - joy.oy) / 46, -1, 1); return; }
    if (document.pointerLockElement !== lockEl && (e.buttons & 1 || e.pointerType === 'touch')) lookBy(e.movementX * 1.4, e.movementY * 1.4);
  });
  const joyEnd = (e: PointerEvent) => { if (e.pointerId === joy.id) { joy.id = -1; joy.x = joy.y = 0; } };
  lockEl.addEventListener('pointerup', joyEnd); lockEl.addEventListener('pointercancel', joyEnd);

  const ring = () => {
    unlockAudio(); if (ambience.muted || !beepCtx || beepCtx.state !== 'running') return;
    const t0 = beepCtx.currentTime;
    for (const [at, len] of [[0, 0.38], [0.5, 0.38]] as const) for (const f of [440, 480]) {
      const o = beepCtx.createOscillator(); const g = beepCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.linearRampToValueAtTime(0.05, t0 + at + 0.02); g.gain.setValueAtTime(0.05, t0 + at + len - 0.03); g.gain.linearRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(beepCtx.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.02);
    }
  };
  let typeTimer = 0;
  const blip = (ch: string) => {
    const ac = ensureAudio(); if (!ac) return;
    const t0 = ac.currentTime; const o = ac.createOscillator(); const g = ac.createGain(); const lp = ac.createBiquadFilter();
    o.type = 'square'; o.frequency.value = 190 + (ch.toLowerCase().charCodeAt(0) % 13) * 26 + Math.random() * 18;
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.04, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    o.connect(lp).connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.06);
  };
  const say = (text: string) => {
    window.clearTimeout(typeTimer);
    dlg.classList.toggle('on', text.length > 0);
    dlg.classList.remove('done');
    dlg.style.minHeight = ''; dlgTxt.textContent = text;
    if (text) dlg.style.minHeight = `${dlg.offsetHeight}px`;
    dlgTxt.textContent = '';
    placePoi();
    if (!text) return;
    let i = 0;
    const step = () => {
      i++; dlgTxt.textContent = text.slice(0, i);
      const ch = text[i - 1]; if (/[\p{L}\p{N}]/u.test(ch) && i % 2 === 1) blip(ch);
      if (i < text.length) typeTimer = window.setTimeout(step, typeDelayMs(ch)); else dlg.classList.add('done');
    };
    step();
  };
  const doorSfx = () => {
    const ac = ensureAudio(); if (!ac) return; const t0 = ac.currentTime;
    const w = noise(ac, 0.8); const bp = ac.createBiquadFilter(); const wg = ac.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.1; bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.35); bp.frequency.exponentialRampToValueAtTime(500, t0 + 0.75);
    wg.gain.setValueAtTime(0.0001, t0); wg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.3); wg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.78);
    w.connect(bp).connect(wg).connect(ac.destination); w.start(t0); w.stop(t0 + 0.8);
  };
  const scareSfx = (beat: 'blackout' | 'dash' | 'hit') => {
    if (beat === 'blackout') ambience.setZone('blackout'); else if (beat === 'hit') ambience.setZone('corridor');
    const ac = ensureAudio(); if (!ac) return; const t0 = ac.currentTime;
    const tone = (type: OscillatorType, f0: number, f1: number, at: number, len: number, gain: number, lpHz = 6000) => {
      const o = ac.createOscillator(); const g = ac.createGain(); const lp = ac.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(f0, t0 + at); o.frequency.exponentialRampToValueAtTime(f1, t0 + at + len);
      lp.type = 'lowpass'; lp.frequency.value = lpHz;
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(lp).connect(g).connect(ac.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.02);
    };
    const hiss = (at: number, len: number, gain: number, f0: number, f1: number, q = 0.9) => {
      const n = noise(ac, len); const bp = ac.createBiquadFilter(); const g = ac.createGain();
      bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(f0, t0 + at); bp.frequency.exponentialRampToValueAtTime(f1, t0 + at + len);
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(gain, t0 + at + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      n.connect(bp).connect(g).connect(ac.destination); n.start(t0 + at); n.stop(t0 + at + len);
    };
    if (beat === 'blackout') { tone('sine', 110, 38, 0, 0.35, 0.5); hiss(0, 0.06, 0.6, 2400, 1800, 2); tone('sawtooth', 120, 60, 0, 0.25, 0.04, 400); }
    else if (beat === 'dash') { hiss(0, 0.42, 0.55, 280, 3400); tone('sawtooth', 70, 420, 0, 0.42, 0.06, 1200); }
    else { for (const fq of [466, 494, 523, 554, 1046]) tone('sawtooth', fq, fq * 0.94, 0, 1.4, fq > 1000 ? 0.04 : 0.07, 3200); hiss(0, 0.3, 0.7, 900, 5200, 0.6); tone('sine', 72, 30, 0, 0.6, 0.85); }
  };

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const seed = uniform(0); const scareU = uniform(0); const recU = uniform(0);
  const scenePass = pass(scene, camera);
  const col = scenePass.getTextureNode();
  const texel = uniform(new THREE.Vector2(1 / 680, 1 / 380));
  const syncTexel = () => { const { width, height } = renderer.domElement; if (width > 0 && height > 0) texel.value.set(1 / width, 1 / height); };
  syncTexel();
  const px = texel; const edge = screenUV.sub(0.5); const radius = float(0.3).add(dot(edge, edge).mul(1.6)); const o = px.mul(radius);
  const chroma = edge.mul(dot(edge, edge)).mul(float(0.012).add(scareU.mul(0.045))).add(px.mul(float(0.6).add(scareU.mul(1.8))));
  const sampleSoft = (suv: TSLNode) => col.sample(suv).mul(0.4).add(col.sample(suv.add(vec2(o.x, o.y))).mul(0.15)).add(col.sample(suv.add(vec2(o.x.negate(), o.y))).mul(0.15)).add(col.sample(suv.add(vec2(o.x, o.y.negate()))).mul(0.15)).add(col.sample(suv.add(vec2(o.x.negate(), o.y.negate()))).mul(0.15));
  const soft = vec4(sampleSoft(screenUV.add(chroma)).r, sampleSoft(screenUV).g, sampleSoft(screenUV.sub(chroma)).b, 1);
  const glow = bloom(col, 0.3, 0.5, 1.2);
  const lit = soft.rgb.add(glow.rgb.mul(vec3(1.0, 0.8, 0.55)));
  const outLin = renderOutput(vec4(lit, 1)) as unknown as TSLNode;
  const luma = dot(outLin.rgb, vec3(0.299, 0.587, 0.114));
  const muted = mix(vec3(luma), outLin.rgb, 0.82);
  const warm = muted.mul(mix(vec3(1.04, 0.98, 0.88), vec3(1.06, 1.0, 0.92), luma)).add(vec3(0.014, 0.009, 0.004).mul(float(1).sub(luma)));
  const vig = float(1).sub(smoothstep(0.25, 0.85, dot(edge, edge).mul(2.4)).mul(float(0.5).add(recU.mul(0.22))));
  const cell = screenCoordinate.xy.floor().add(vec2(seed, seed.mul(1.7)));
  const n = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
  const scan = float(1).sub(sin(screenCoordinate.y.mul(Math.PI)).mul(0.5).add(0.5).mul(0.07));
  const corridor = mix(warm, warm.mul(1.06).add(vec3(0.0, 0.014, 0.011).mul(float(1).sub(luma))).mul(vec3(0.93, 1.0, 0.95)), recU);
  const cold = mix(corridor, vec3(luma).mul(vec3(0.78, 0.92, 1.04)).mul(luma.mul(0.5).add(0.6)), scareU.mul(0.55));
  const noisy = cold.mul(vig).mul(scan).add(n.mul(float(0.075).add(scareU.mul(0.05)).mul(float(1).sub(luma.mul(0.55)))));
  const bayer = fract(screenCoordinate.x.mul(0.5).add(screenCoordinate.y.mul(0.75))).sub(0.5);
  const q = float(31);
  pipeline.outputNode = vec4(noisy.mul(q).add(bayer.mul(0.9)).add(0.5).floor().div(q), 1);

  const recGoTo = (name: string, instant = false) => {
    if (!rec) return;
    const c = rec.meta.cameras[name]; if (!c) return;
    recFrom.p.copy(recPos); recFrom.fov = camera.fov; recFromYaw = recYaw; recFromPitch = recPitch;
    recTo.p.set(...c.position); recTo.q.set(...c.quaternion); recTo.fov = Math.min(fovFor(c, camera.aspect), 80);
    const te = new THREE.Euler().setFromQuaternion(recTo.q, 'YXZ'); recToYaw = te.y; recToPitch = te.x;
    recT = instant ? 1 : 0;
    if (instant) { recPos.copy(recTo.p); recYaw = recToYaw; recPitch = recToPitch; camera.fov = recTo.fov; camera.updateProjectionMatrix(); }
  };

  const exitReception = () => {
    ++transition; window.clearTimeout(exitTimer); window.clearTimeout(poiTimer); say('');
    phase = 'idle';
    scenePass.scene = scene; scareU.value = 0; recU.value = 0;
    renderer.toneMappingExposure = 2 ** meta.exposure;
    camera.near = 0.02; camera.far = 120; camera.updateProjectionMatrix();
    entering = false; doorOpened = false; activePoi = null; poiEl.hidden = true; poiEl.classList.remove('on'); whoEl.textContent = 'VERA';
    if (modal.open) modal.close();
    recHud.classList.remove('island', 'modal-open', 'cine', 'on', 'locked');
    ambience.setZone('room'); ambience.setNightSeraph(false);
    island?.setHologram(false, false, false); island?.setSeraph(false); island?.setTunnelVera(false, false);
    island?.setNight(false, true);
    activeDossier?.dispose(); activeDossier = null; dossierPromise = null; story = null; localFiles = [];
    diversionAt = 0; ringAt = 0; islandTime = 0; inTunnel = false; islandLive = false; isl.body = null;
    if (document.pointerLockElement === lockEl) document.exitPointerLock();
    lockEl.classList.remove('rec'); flash.style.transition = 'none'; flash.classList.remove('off'); flash.style.opacity = '0';
    veil.classList.remove('on'); recTitle.classList.remove('show');
    crossT = -1; loginUI.reset(); folderInput.value = ''; syncInput();
    quickBar.hidden = false;
    goTo('CAM_LOGIN_FRONT', true); updateCta();
  };

  const nextFrame = () => new Promise<void>((r) => { requestAnimationFrame(() => r()); });
  const enterIsland = async () => {
    if (phase !== 'reception' || entering) return;
    const token = ++transition; entering = true;
    flash.classList.remove('off'); flash.style.transition = reduceMotion ? 'none' : 'opacity .8s ease-in'; flash.style.opacity = '1';
    const whited = new Promise<void>((r) => { window.setTimeout(r, reduceMotion ? 0 : 850); });
    try { island = await prefetchIsland(); await whited; } catch (err) {
      console.error(err); entering = false; flash.style.opacity = '0';
      whoEl.textContent = 'VERA'; say(tr('The door isn’t yielding yet.', 'La puerta no cede todavía.', getLang())); return;
    }
    if (phase !== 'reception' || token !== transition) { entering = false; return; }
    phase = 'island'; islandAt = Infinity; islandTime = 0; diversionAt = 0; ringAt = 0; inTunnel = false;
    window.clearTimeout(exitTimer); say('');
    scenePass.scene = island.scene; recU.value = 0; scareU.value = 0;
    island.setNight(false, true); island.setHologram(false, false, false); island.setSeraph(false); island.setTunnelVera(false, false);
    if (activeDossier && story) island.applyDossier(activeDossier, story);
    ambience.setZone('island-day'); ambience.setNightSeraph(false);
    ambience.setRepoMetrics(activeDossier?.dormantLabel ? 0.6 : 0.2, activeDossier?.todos?.length ?? 0);
    renderer.toneMappingExposure = island.exposure;
    const sp = island.spawn; isl.body = island.physics.spawn(sp.x, sp.z); isl.camY = isl.body.y + ISLAND_EYE; isl.bob = 0;
    recYaw = sp.yaw; recPitch = sp.pitch; recT = 1;
    camera.near = 0.1; camera.far = 800; camera.fov = islandFov(camera.aspect); camera.updateProjectionMatrix();
    recHud.classList.remove('cine'); recHud.classList.add('island'); updateHud();
    recInfo.textContent = `${tr('The Island', 'La isla', getLang())} · ${activeDossier?.projectName ?? ''}`;
    recTitle.querySelector('b')!.textContent = tr('THE ISLAND', 'LA ISLA', getLang());
    recTitle.querySelector('i')!.textContent = `${activeDossier?.projectName ?? ''} · ${activeDossier?.archetypeLabel ?? ''}`;
    islandLive = false;
    for (let quick = 0, last = performance.now(), t0 = last; quick < 4 && last - t0 < 8000;) {
      await nextFrame(); const now = performance.now(); quick = now - last < 90 ? quick + 1 : 0; last = now;
    }
    if (phase !== 'island' || token !== transition) { entering = false; return; }
    islandLive = true;
    flash.style.transition = reduceMotion ? 'none' : 'opacity 2.4s ease-out'; flash.style.opacity = '0';
    recTitle.classList.remove('show'); void recTitle.offsetWidth; recTitle.classList.add('show');
    islandAt = performance.now(); entering = false;
  };

  const speak = (beat: StoryBeat) => {
    whoEl.textContent = beat.speaker; say(beat.text); window.clearTimeout(poiTimer);
    poiTimer = window.setTimeout(() => { say(''); placePoi(); }, Math.max(5200, beat.text.length * 55 + 2200));
  };
  const applyNight = (night: boolean, seraph: boolean, vera: boolean, calm = false) => {
    island?.setNight(night); island?.setSeraph(seraph); island?.setTunnelVera(vera, calm);
    ambience.setZone(night ? 'island-night' : 'island-day'); ambience.setNightSeraph(night && seraph);
    if (!night || calm) ringAt = 0;
  };
  const handleBeat = (beat: StoryBeat) => {
    if (!story || !island || !activeDossier) return;
    switch (beat.effect) {
      case 'deploy_hologram':
        if (!story.diverted && !diversionAt) {
          island.applyDossier(activeDossier, story); island.setHologram(true, false, false); ambience.playHologramDeploy();
          diversionAt = islandTime + Math.max(story.pace === 'demo' ? 3.8 : 5.5, lineSeconds(beat.text));
        }
        break;
      case 'divert_to_tv':
        diversionAt = 0; island.applyDossier(activeDossier, story); island.setHologram(true, true, true); ambience.playDiversionGlitch(); break;
      case 'shift_night_awaken':
        activeDossier.activeTodoIndex = story.activeTodoIndex;
        island.applyDossier(activeDossier, story);
        island.setHologram(true, true, false);
        ambience.playDuskShift(true); applyNight(true, true, true); ringAt = islandTime + 2.2; break;
      case 'cycle_tv_track':
      case 'toggle_tv_todo':
        activeDossier.activeTodoIndex = story.activeTodoIndex;
        island.applyDossier(activeDossier, story);
        if (modal.open) renderEvidence(byId('dosGrid'), activeDossier, story, selectTodo, toggleTodoInKiro);
        break;
      case 'toggle_time': {
        const calm = story.verdict === 'archive' || story.verdict === 'restore';
        ambience.playDuskShift(story.isNight); applyNight(story.isNight, story.isNight && !calm, story.isNight || calm, calm); break;
      }
      case 'open_dossier': void openDossier(false); break;
    }
    if (beat.effect !== 'open_dossier') speak(beat);
    updateHud();
  };
  const triggerDiversion = () => { if (phase === 'island' && story && !story.diverted) handleBeat(story.triggerDiversion()); };
  const examine = () => {
    if (modal.open || phase !== 'island' || !activePoi || !story || !islandLive) return;
    if (activePoi.id === 'tv') { if (!story.diverted) triggerDiversion(); ambience.playTapeClick(); }
    handleBeat(story.interactIslandPoi(activePoi.id));
  };
  poiEl.addEventListener('click', examine);

  triggerResetToCrt = exitReception;
  triggerEnter3DFromDossier = () => {
    if (phase === 'reception') void enterIsland();
    else if (phase === 'idle' || phase === 'zoomed') connect();
  };
  byId('btnSkipIsland').onclick = () => void enterIsland();
  byId('btnExitHud').onclick = exitReception;
  byId('btnTime').onclick = () => { if (phase === 'island' && story) handleBeat(story.interactIslandPoi('overlook')); };
  byId('btnMute').onclick = () => {
    ambience.setMuted(!ambience.muted);
    if (ambience.muted) void beepCtx?.suspend().catch(() => {}); else unlockAudio();
    const btn = byId('btnMute'); btn.setAttribute('aria-pressed', String(ambience.muted)); syncLangUi();
  };

  const finishCross = async () => {
    phase = 'loading'; prefetchIsland();
    veil.classList.add('on'); flash.classList.add('off');
    const collapsed = new Promise<void>((r) => { window.setTimeout(r, reduceMotion ? 0 : 620); });
    try {
      rec = await (recPromise ??= loadReception());
      const d = await dossierPromise;
      if (!d) throw new Error('Dossier missing.');
      mountDossierIntoModal(d);
      rec.warm(true);
      try { await renderer.compileAsync(rec.scene, camera); } finally { rec.warm(false); }
    } catch (err) {
      console.error(err); recPromise = null; veil.classList.remove('on'); flash.classList.remove('off'); flash.style.opacity = '0';
      if (document.pointerLockElement) document.exitPointerLock();
      byId('receptionInfo').textContent = `${err instanceof Error ? err.message : String(err)}`;
      reception.classList.add('on'); return;
    }
    await collapsed;
    scenePass.scene = rec.scene; recU.value = 1;
    rec.setRing(ring); rec.setDoor(doorSfx); rec.setLine((text) => { whoEl.textContent = 'VERA'; say(text); }); rec.setScare(scareSfx); ambience.setZone('corridor'); rec.begin(loginUI.pace);
    lockPointer(); lockEl.classList.add('rec');
    recInfo.textContent = `${tr('Reception', 'Recepción', getLang())} · ${activeDossier!.visitorName} · ${activeDossier!.projectName}`;
    recHud.classList.add('on'); recGoTo('CAM_RECEP_SPAWN', true); phase = 'reception'; updateHud();
    flash.classList.remove('off'); flash.style.opacity = '0'; veil.classList.remove('on');
    recTitle.querySelector('b')!.textContent = tr('RECEPTION', 'RECEPCIÓN', getLang());
    recTitle.querySelector('i')!.textContent = tr('Archive of Unfinished Things · Ground Floor', 'Archivo de lo inconcluso · planta baja', getLang());
    recTitle.classList.remove('show'); void recTitle.offsetWidth; recTitle.classList.add('show');
  };
  byId('back').onclick = () => { reception.classList.remove('on'); phase = 'reception'; exitReception(); };

  const keyClick = (heavy = false) => {
    const ac = ensureAudio(); if (!ac) return; const t0 = ac.currentTime;
    const n = noise(ac, 0.04); const hp = ac.createBiquadFilter(); const ng = ac.createGain();
    hp.type = 'bandpass'; hp.frequency.value = (heavy ? 1700 : 2600) + Math.random() * 900; hp.Q.value = 1.4;
    ng.gain.setValueAtTime(heavy ? 0.34 : 0.26, t0); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.028);
    n.connect(hp).connect(ng).connect(ac.destination); n.start(t0); n.stop(t0 + 0.04);
    const o = ac.createOscillator(); const og = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime((heavy ? 150 : 200) + Math.random() * 50, t0); o.frequency.exponentialRampToValueAtTime(80, t0 + 0.05);
    og.gain.setValueAtTime(heavy ? 0.2 : 0.13, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    o.connect(og).connect(ac.destination); o.start(t0); o.stop(t0 + 0.06);
  };
  nameInput.addEventListener('input', () => { keyClick(); if (loginUI.focus === 'repo') loginUI.setRepo(nameInput.value); else loginUI.setName(nameInput.value); loginUI.setStatus(''); syncInput(); });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); connect(); }
    else if (e.key === 'Tab') {
      e.preventDefault(); keyClick(true);
      if (e.shiftKey) loginUI.stepOrigin(-1);
      else if (loginUI.origin === 'GitHub') loginUI.focus = loginUI.focus === 'name' ? 'repo' : 'name';
      else loginUI.stepOrigin(1);
      syncInput();
    }
  });
  addEventListener('paste', (e) => {
    if (phase !== 'zoomed' || modal.open) return;
    const text = e.clipboardData?.getData('text') ?? ''; if (!text) return; e.preventDefault();
    if (loginUI.origin === 'GitHub' && loginUI.focus !== 'name') loginUI.setRepo(text.trim());
    else if (loginUI.origin === 'GitHub') { loginUI.focus = 'repo'; loginUI.setRepo(text.trim()); }
    else loginUI.setName(text.trim());
    loginUI.setStatus(''); syncInput();
  });
  folderInput.addEventListener('change', () => {
    const list = [...(folderInput.files ?? [])]; localFiles = list;
    if (!list.length) { loginUI.setFolder('', 0); return; }
    const first = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    loginUI.setFolder(first.split('/')[0] || list[0].name, list.length);
  });
  addEventListener('keydown', (e) => {
    if (modal.open) {
      if (e.key === 'Escape') { e.preventDefault(); closeDossier(); return; }
      if (e.key === 'Tab') {
        const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled])'));
        if (controls.length > 0) {
          const i = controls.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (i <= 0 ? controls.length - 1 : i - 1) : (i < 0 || i >= controls.length - 1 ? 0 : i + 1);
          e.preventDefault(); controls[next].focus();
        }
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key) && document.activeElement?.tagName !== 'INPUT') {
        const delta = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1;
        if (e.target === note && !e.altKey && (e.shiftKey || note.selectionStart !== note.selectionEnd || (delta > 0 ? note.selectionEnd < note.value.length : note.selectionStart > 0))) return;
        e.preventDefault(); const controls = Array.from(modal.querySelectorAll<HTMLElement>('button,input,textarea'));
        const i = controls.indexOf(document.activeElement as HTMLElement);
        controls[i < 0 ? (delta > 0 ? 0 : controls.length - 1) : (i + delta + controls.length) % controls.length].focus();
      }
      return;
    }
    if (phase === 'loading' || walking()) {
      if (walking() && e.key === 'Tab') { e.preventDefault(); if (!e.repeat) void openDossier(); return; }
      if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
      if (walking() && e.key === 'Escape' && document.pointerLockElement !== lockEl && performance.now() - lastUnlock > 600) exitReception();
      else if (phase === 'island' && e.key.toLowerCase() === 'e') examine();
      else if (phase === 'island' && e.key.toLowerCase() === 'r' && activePoi?.id === 'tv' && story && islandLive) handleBeat(story.toggleActiveTodoForKiro());
      else if (phase === 'island' && e.key === ' ') { e.preventDefault(); if (island && isl.body && !e.repeat) island.physics.jump(isl.body); }
      return;
    }
    if (phase === 'crossing' || reception.classList.contains('on')) return;
    if (phase === 'idle') {
      if (e.key === 'Tab') { e.preventDefault(); if (!e.repeat) void openDossier(true); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target === document.body) { e.preventDefault(); zoomIn(); }
      return;
    }
    if (e.key === 'Escape') { zoomOut(); return; }
    if (document.activeElement !== nameInput && (e.key.length === 1 || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) nameInput.focus();
    else if (e.key === 'Enter') connect();
  });

  updateCta();
  const pointerNdc = (e: PointerEvent) => new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (phase !== 'idle') { renderer.domElement.classList.remove('pick'); return; }
    raycaster.setFromCamera(pointerNdc(e), camera);
    renderer.domElement.classList.toggle('pick', raycaster.intersectObjects(idleTargets, false).length > 0);
  });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (phase !== 'idle' && phase !== 'zoomed') return;
    e.preventDefault();
    raycaster.setFromCamera(pointerNdc(e), camera);
    if (phase === 'idle') { if (raycaster.intersectObjects(idleTargets, false).length > 0) zoomIn(); return; }
    const hit = raycaster.intersectObject(screen, false)[0];
    if (!hit?.uv) { if (raycaster.intersectObjects(pickables, false).length === 0) zoomOut(); return; }
    const where = loginUI.hit(hit.uv.x, hit.uv.y);
    if (where === 'button') connect();
    else if (typeof where === 'object') {
      if ('chip' in where) loginUI.setOrigin(where.chip);
      else if ('preset' in where) loginUI.setPreset(where.preset);
      else loginUI.setPace(where.pace);
      loginUI.setStatus(''); syncInput();
    }
    else if (where === 'folder') folderInput.click();
    else if (where === 'repo') focusField('repo');
    else focusField('name');
  });

  if (qs.has('debug')) Object.assign(window, { __gardenos: {
    get island() { return island; }, isl, look: (yaw: number, pitch: number) => { recYaw = yaw; recPitch = pitch; },
    getPhase: () => phase, getIslandLive: () => islandLive, getDossier: () => activeDossier, getStory: () => story,
    openDossier, triggerDiversion, enterIslandNow: enterIsland, selectPreset: (id: PresetId) => loginUI.setPreset(id),
  } });

  const look = new THREE.Vector2(); const lookTarget = new THREE.Vector2();
  addEventListener('pointermove', (e) => lookTarget.set((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2));
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight); syncTexel(); placePoi();
    camera.aspect = innerWidth / innerHeight; to.fov = fovFor(active, camera.aspect);
    if (phase === 'island') camera.fov = islandFov(camera.aspect); else if (phase !== 'reception' && t >= 1) camera.fov = to.fov;
    camera.updateProjectionMatrix();
  });

  const base = new THREE.Quaternion(); const tilt = new THREE.Quaternion(); const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const clock = new THREE.Timer(); let grainTick = 0;
  await Promise.all([renderer.compileAsync(scene, camera), new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, 1400 - performance.now())))]);
  ready3D = true;
  if (modal.open) syncLangUi();
  byId('loading').classList.add('done');

  renderer.setAnimationLoop((time) => {
    clock.update(time);
    const elapsed = clock.getDelta(); const dt = Math.min(elapsed, 0.05);
    if (phase === 'island' && island) renderer.toneMappingExposure = island.update(dt, time);
    if (modal.open) { pipeline.render(); return; }
    if (phase === 'island' && island) {
      const body = (isl.body ??= island.physics.spawn(island.spawn.x, island.spawn.z));
      const { fwd, side } = moveInput();
      const moving = Math.abs(fwd) > 0.05 || Math.abs(side) > 0.05;
      const mag = Math.max(1, Math.hypot(fwd, side));
      const sprint = heldKeys.has('shift');
      const speed = moving && islandLive ? (sprint ? 5.6 : 3.3) * dt : 0;
      const sy = Math.sin(recYaw); const cy = Math.cos(recYaw);
      const px0 = body.x; const pz0 = body.z;
      const fell = island.physics.step(body, ((-sy * fwd + cy * side) / mag) * speed, ((-cy * fwd - sy * side) / mag) * speed, dt);
      if (fell) {
        isl.body = island.physics.spawn(island.spawn.x, island.spawn.z);
        isl.camY = isl.body.y + ISLAND_EYE; recYaw = island.spawn.yaw; recPitch = island.spawn.pitch;
        flash.style.transition = 'none'; flash.style.opacity = '1';
        requestAnimationFrame(() => { flash.style.transition = reduceMotion ? 'none' : 'opacity 1.4s ease-out'; flash.style.opacity = '0'; });
      }
      const b = isl.body ?? body;
      if (b.grounded && !reduceMotion) isl.bob += Math.hypot(b.x - px0, b.z - pz0) * 2.9;
      const wantY = b.y + ISLAND_EYE;
      isl.camY = b.grounded ? isl.camY + (wantY - isl.camY) * Math.min(1, dt * 18) : wantY;
      const bob = !reduceMotion && moving && b.grounded ? Math.sin(isl.bob) * 0.03 : 0;
      const eyeY = isl.camY;
      camera.position.set(b.x, eyeY + bob, b.z);
      camera.quaternion.setFromEuler(recEuler.set(recPitch, recYaw, 0));
      if (islandLive && story) {
        islandTime += elapsed;
        if (!story.hologramDeployed && Math.hypot(b.x + 7.7, b.z - 1.1) < 5.2) handleBeat(story.triggerDeskApproach());
        if (diversionAt && islandTime >= diversionAt) triggerDiversion();
        if (ringAt && islandTime >= ringAt) { ringAt = 0; ambience.playTunnelPhoneRing(); }
        const reached = island.isNight && b.z < -3.8 && Math.abs(b.x) < 2.2;
        if (reached && !inTunnel) handleBeat(story.interactIslandPoi('door'));
        inTunnel = reached;
      }
      const poi = time - islandAt > 4400 ? island.poiAt(b.x, eyeY - (ISLAND_EYE - 1.62), b.z, recYaw) : null;
      if (poi !== activePoi) { activePoi = poi; if (poi) poiEl.querySelector('b')!.textContent = poi.label; updateHud(); }
    } else if (phase === 'reception' && rec) {
      if (recT < 1) {
        recT = Math.min(1, recT + dt / 1.3); const k = recT * recT * (3 - 2 * recT);
        recPos.lerpVectors(recFrom.p, recTo.p, k);
        const dy = Math.atan2(Math.sin(recToYaw - recFromYaw), Math.cos(recToYaw - recFromYaw));
        recYaw = recFromYaw + dy * k; recPitch = THREE.MathUtils.lerp(recFromPitch, recToPitch, k);
        camera.fov = THREE.MathUtils.lerp(recFrom.fov, recTo.fov, k); camera.updateProjectionMatrix();
      }
      const { fwd, side } = moveInput();
      if (fwd || side) {
        recT = 1; const sy = Math.sin(recYaw); const cy = Math.cos(recYaw);
        recPos.x += (-sy * fwd + cy * side) * 1.7 * dt; recPos.z += (-cy * fwd - sy * side) * 1.7 * dt;
        recPos.x = THREE.MathUtils.clamp(recPos.x, WALK.minX, WALK.maxX); recPos.z = THREE.MathUtils.clamp(recPos.z, WALK.minZ, WALK.maxZ);
      }
      if (!doorOpened && recPos.z < -20.2) { doorOpened = true; rec.openExit(); prefetchIsland(); }
      if (doorOpened && recPos.z < -22.9) void enterIsland();
      rec.update(dt, time, { x: recPos.x, z: recPos.z, dirZ: -Math.cos(recYaw) });
      const fx = rec.fx;
      if (fx.focus > 0.001) {
        recT = 1;
        const dx = fx.target.x - recPos.x; const dy = fx.target.y - recPos.y; const dz = fx.target.z - recPos.z;
        const wantYaw = Math.atan2(-dx, -dz); const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        const w = (reduceMotion ? 3.5 : 13) * fx.focus;
        const ey = Math.atan2(Math.sin(wantYaw - recYaw), Math.cos(wantYaw - recYaw)); const ep = wantPitch - recPitch;
        const yaw0 = recYaw; const pitch0 = recPitch; const h = dt / 4;
        for (let i = 0; i < 4; i++) {
          const ey2 = ey - (recYaw - yaw0); const ep2 = ep - (recPitch - pitch0);
          camYawVel += (w * w * ey2 - 2 * w * camYawVel) * h; camPitchVel += (w * w * ep2 - 2 * w * camPitchVel) * h;
          recYaw += camYawVel * h; recPitch += camPitchVel * h;
        }
      } else { camYawVel = 0; camPitchVel = 0; }
      if (recT >= 1) { const want = recTo.fov * (1 - 0.3 * fx.zoom); const f = camera.fov + (want - camera.fov) * Math.min(1, dt * 9); if (Math.abs(camera.fov - f) > 0.001) { camera.fov = f; camera.updateProjectionMatrix(); } }
      const s = reduceMotion ? 0 : fx.shake; const tt = time * 0.001;
      const sx = Math.sin(tt * 47) * 0.6 + Math.sin(tt * 83 + 1.3) * 0.4; const sy = Math.sin(tt * 53 + 2.1) * 0.6 + Math.sin(tt * 71) * 0.4;
      camera.position.set(recPos.x + sx * 0.022 * s, recPos.y + sy * 0.022 * s, recPos.z);
      camera.quaternion.setFromEuler(recEuler.set(recPitch + sy * 0.02 * s, recYaw + sx * 0.02 * s, Math.sin(tt * 29) * 0.045 * s));
      scareU.value = reduceMotion ? 0 : fx.scare;
      recHud.classList.toggle('cine', fx.focus > 0.5);
    } else {
      if (t < 1) { t = Math.min(1, t + dt / 1.1); const k = t * t * (3 - 2 * t); camera.position.lerpVectors(from.p, to.p, k); base.slerpQuaternions(from.q, to.q, k); camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, k); camera.updateProjectionMatrix(); } else base.copy(to.q);
      look.lerp(lookTarget, 1 - Math.exp(-dt * 3));
      const br = reduceMotion ? 0 : 1; const ts = time * 0.001;
      euler.set(-look.y * 0.035 + Math.sin(ts * 0.61) * 0.0035 * br, -look.x * 0.06 + Math.sin(ts * 0.43 + 1.2) * 0.0045 * br, Math.sin(ts * 0.37 + 0.5) * 0.002 * br);
      const waver = reduceMotion ? 0 : Math.sin(ts * 7.3) * Math.sin(ts * 2.9 + 0.4);
      for (const n of ['LGT_FilingLamp', 'LGT_Corner_Sconce']) { const r = roomLights[n]; if (r) r.light.intensity = r.base * (1 + waver * 0.045); }
      const glow = roomLights.LGT_CRT_Glow; if (glow) glow.light.intensity = glow.base * (1 + (reduceMotion ? 0 : Math.sin(ts * 83) * 0.03) + (crossT > 0 ? crossT * crossT * 5 : 0));
      scanAmt.value += ((phase === 'idle' ? 0 : 1) - scanAmt.value) * Math.min(1, dt * 2.2);
      camera.quaternion.copy(base).multiply(tilt.setFromEuler(euler));
    }
    if (holo.update(time, dt, ctaOn)) pi();
    loginUI.draw(time, crossT >= 0 ? crossT : undefined);
    if (crossT >= 0 && crossT < 1) {
      crossT = Math.min(1, crossT + dt / (reduceMotion ? 1 : 2.8));
      if (!reduceMotion) {
        const k = Math.min(1, crossT / 0.85); const e = k * k * (3 - 2 * k);
        camera.position.lerpVectors(crossFrom.p, glassFront, e);
        if (crossT > 0.85) camera.position.lerp(glassBeyond, (crossT - 0.85) / 0.15);
        camera.quaternion.slerpQuaternions(crossFrom.q, crossQ, e);
      }
      flash.style.opacity = String(THREE.MathUtils.clamp((crossT - 0.72) / 0.13, 0, 1));
      if (crossT >= 1) void finishCross();
    }
    const tick = Math.floor(time / 66); if (tick !== grainTick) { grainTick = tick; seed.value = (tick % 97) * 13.1; }
    if (texel.value.x > 0.0014 || tick % 30 === 0) syncTexel();
    pipeline.render();
  });
}

init().catch((err: unknown) => {
  console.error(err);
});

function renderEvidence(
  grid: HTMLElement,
  d: ProjectDossier,
  story: StoryEngine,
  onSelectTodo: (idx: number) => void,
  onToggleKiro: (todoId: string) => void,
  focusTarget?: DossierFocusTarget,
) {
  const lang = getLang();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, cls = '') => {
    const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node;
  };

  const cardA = el('article', '', 'dosPiece');
  cardA.append(el('header', tr('PRIMARY TRACE & VISUAL', 'RASTRO PRINCIPAL Y CAPTURA', lang)));
  if (d.primaryImage?.url) {
    const img = document.createElement('img'); img.alt = d.primaryImage.name; img.referrerPolicy = 'no-referrer'; img.src = d.primaryImage.url;
    cardA.append(img);
  }
  const todos = d.todos ?? [];
  const activeTodo = todos[d.activeTodoIndex ?? 0];
  if (todos.length > 1) {
    cardA.append(el('div', tr(`Discovered markers (${todos.length})`, `Marcas detectadas (${todos.length})`, lang), 'dosSubLabel'));
    const row = el('div', '', 'dosTracks');
    todos.forEach((t, i) => {
      const picked = story.isTodoSelected(t.id);
      const b = el('button', `${picked ? '✓ ' : ''}${t.tag} · ${t.path.split('/').pop()}:${t.lineNumber}`, 'dosTrackBtn');
      b.type = 'button'; b.dataset.trackIdx = String(i);
      b.setAttribute('aria-pressed', String(i === (d.activeTodoIndex ?? 0)));
      b.onclick = () => onSelectTodo(i);
      row.append(b);
    });
    cardA.append(row);
  }
  if (activeTodo) {
    const picked = story.isTodoSelected(activeTodo.id);
    const kiroBtn = el('button', picked ? tr('✓ Included in Kiro Spec', '✓ Incluida en Kiro Spec', lang) : tr('+ Include in Kiro Spec', '+ Incluir en Kiro Spec', lang), 'dosTrackBtn');
    kiroBtn.type = 'button'; kiroBtn.setAttribute('aria-pressed', String(picked));
    kiroBtn.setAttribute('data-kiro-toggle', '');
    kiroBtn.onclick = () => onToggleKiro(activeTodo.id);
    cardA.append(kiroBtn);
  }
  const traceTitle = activeTodo ? `${activeTodo.tag} at ${activeTodo.path.split('/').pop()}:${activeTodo.lineNumber}` : d.tapeClue.title;
  const tracePath = activeTodo ? `${activeTodo.path}:${activeTodo.lineNumber}` : d.tapeClue.path + (d.tapeClue.lineNumber ? `:${d.tapeClue.lineNumber}` : '');
  const traceExcerpt = activeTodo?.contextSnippet || (activeTodo ? activeTodo.excerpt : d.tapeClue.excerpt);
  cardA.append(el('h3', traceTitle), el('code', tracePath, 'dosPath'), el('p', traceExcerpt, 'dosExcerpt'));
  cardA.append(el('p', `${tr('Observed', 'Observación', lang)}: ${d.tapeClue.observedFact}`, 'dosFact'));
  cardA.append(el('p', `${tr('Hypothesis (unconfirmed)', 'Hipótesis (no confirmada)', lang)}: ${d.tapeClue.interpretation}`, 'dosHyp'));

  const cardB = el('article', '', 'dosPiece');
  cardB.append(el('header', tr('COMMITS, GRAPH & RE-ENTRY', 'COMMITS, GRAFO Y REENTRADA', lang)));
  cardB.append(el('div', `${tr('Module hub', 'Módulo central', lang)}: ${d.graph.hubLabel || 'none'} (${d.graph.nodes.length} nodes · ${d.graph.importEdgeCount} imports)`, 'dosRow'));
  cardB.append(el('div', tr('Recent Commits', 'Últimos commits', lang), 'dosSubLabel'));
  const commitsList = el('div', '', 'dosList');
  if (d.commits.length > 0) {
    d.commits.slice(0, 3).forEach((c) => {
      const r = el('div', '', 'dosRow');
      r.append(el('b', `${c.hash.slice(0, 7)} · ${c.date}`), document.createTextNode(` — ${c.message}`));
      commitsList.append(r);
    });
  } else {
    commitsList.append(el('div', tr('No git commit history in local folder scan.', 'Sin historial git en escaneo de carpeta local.', lang), 'dosRow'));
  }
  cardB.append(commitsList);

  const { runCommands, testCommand, envHints } = d.reentry;
  cardB.append(el('div', tr('Launch & Test Commands', 'Comandos de arranque y prueba', lang), 'dosSubLabel'));
  const cmdList = el('div', '', 'dosList');
  for (const cmd of runCommands.slice(0, 3)) cmdList.append(el('div', `$ ${cmd}`, 'dosRow'));
  if (runCommands.length === 0) cmdList.append(el('div', tr('No launch script verified in manifests.', 'Sin comando de arranque verificado.', lang), 'dosRow'));
  cmdList.append(el('div', testCommand ? `test: ${testCommand}` : tr('test: none verified', 'pruebas: sin comando verificado', lang), 'dosRow'));
  cardB.append(cmdList);

  if (envHints.length > 0) {
    cardB.append(el('div', tr('Environment Hints', 'Variables de entorno', lang), 'dosSubLabel'));
    const pills = el('div', '', 'dosPills');
    envHints.slice(0, 5).forEach((h) => pills.append(el('span', h, 'dosPill')));
    cardB.append(pills);
  }
  cardB.append(el('p', `${tr('Context', 'Contexto', lang)}: ${d.towerRecord.observedFact}`, 'dosFact'));
  if (story.creatorNote.trim()) cardB.append(el('p', `${tr('Saved note', 'Nota guardada', lang)}: ${story.creatorNote}`, 'dosHyp'));

  grid.replaceChildren(cardA, cardB);
  if (focusTarget !== undefined) {
    grid.querySelector<HTMLButtonElement>(focusSelectorFor(focusTarget))?.focus({ preventScroll: true });
  }
}