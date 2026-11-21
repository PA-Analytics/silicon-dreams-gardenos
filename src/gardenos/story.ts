import type { ProjectDossier, VerdictId } from './ingest.ts';
import type { SavedProjectMemory } from './kiro-export.ts';
import { getLang, tr } from './i18n.ts';

export type StoryAct =
  | 'reception'
  | 'island_day'
  | 'desk_hologram'
  | 'signal_diverted'
  | 'island_night'
  | 'tunnel_verdict'
  | 'epilogue';

export type StoryPace = 'demo' | 'full';

export type StoryEffect =
  | 'deploy_hologram'
  | 'divert_to_tv'
  | 'shift_night_awaken'
  | 'cycle_tv_track'
  | 'toggle_tv_todo'
  | 'toggle_time'
  | 'open_dossier'
  | 'shift_day_dawn'
  | 'night_calm'
  | 'night_keep';

export interface StoryBeat {
  speaker: string;
  text: string;
  effect?: StoryEffect;
  artifact?: 'kiro_revival_spec' | 'archive_card';
}

export interface StoryCommit { hash: string; message: string; date: string }
export interface StoryReentry { archetypeLabel?: string; lastTouchLabel?: string | null; daysAway?: number | null }
export type StoryDossier = ProjectDossier & { commits?: StoryCommit[]; reentry?: StoryReentry; archetypeLabel?: string };

export interface VerdictOption {
  id: VerdictId;
  label: string;
  labelEs: string;
  hint: string;
  hintEs: string;
  veraLine: string;
  veraLineEs: string;
  timeAfter: 'day' | 'night';
  closingSubtitle: string;
  closingSubtitleEs: string;
}

export const VERDICT_OPTIONS: VerdictOption[] = [
  {
    id: 'archive',
    label: 'Archive',
    labelEs: 'Archivar',
    hint: 'Preserve this snapshot with today’s date and your note.',
    hintEs: 'Conservar la pieza con su fecha y tu nota.',
    veraLine: 'Sealed with today’s date. Not everything left unfinished needs to be forced closed.',
    veraLineEs: 'Sellado con la fecha de hoy. No todo lo que quedó a medias necesita terminarse para importar.',
    timeAfter: 'night',
    closingSubtitle: 'Archived · nothing lost',
    closingSubtitleEs: 'Conservado en el archivo · nada se perdió',
  },
  {
    id: 'restore',
    label: 'Restore in Kiro',
    labelEs: 'Restaurar en Kiro',
    hint: 'Reopen the line and export your Kiro Revival Spec (EARS).',
    hintEs: 'Reabrir la línea y llevarte el Kiro Revival Spec (EARS).',
    veraLine: 'Line reopened. The hardest part is done — you came back to face what was left behind.',
    veraLineEs: 'Línea abierta de nuevo. Lo difícil ya lo hiciste: volver a mirar lo que dejaste atrás.',
    timeAfter: 'day',
    closingSubtitle: 'Line reopened · Kiro Revival Pack ready',
    closingSubtitleEs: 'Línea reabierta · Kiro Revival Pack listo',
  },
  {
    id: 'leave',
    label: 'Leave Unfinished',
    labelEs: 'Dejar inconcluso',
    hint: 'Keep your note locally without erasing or forcing closure.',
    hintEs: 'Cerrar sin borrar: guardar tu nota sin forzar un cierre.',
    veraLine: 'Some doors work better left ajar. Your trace stays right here if you return.',
    veraLineEs: 'Algunas puertas están mejor entornadas. Aquí seguirá si algún día decides regresar.',
    timeAfter: 'night',
    closingSubtitle: 'Left ajar · saved locally',
    closingSubtitleEs: 'Sin borrar · guardado en la penumbra',
  },
];

export interface StoryEngine {
  readonly dossier: StoryDossier;
  readonly pace: StoryPace;
  readonly act: StoryAct;
  readonly isNight: boolean;
  readonly hologramDeployed: boolean;
  readonly diverted: boolean;
  readonly tapePlayed: boolean;
  readonly activeTodoIndex: number;
  readonly discoveredCrt: boolean;
  readonly discoveredTv: boolean;
  readonly discoveredDoor: boolean;
  readonly verdict: VerdictId | null;
  readonly creatorNote: string;
  getReceptionLines(): [string, string, string];
  getObjective(): string;
  getPoiActionLabel(poiId: string): string;
  triggerDeskApproach(): StoryBeat;
  triggerDiversion(): StoryBeat;
  interactIslandPoi(poiId: string): StoryBeat;
  toggleActiveTodoForKiro(): StoryBeat;
  isTodoSelected(id: string): boolean;
  openDirectAccess(): StoryBeat;
  setNight(night: boolean): void;
  setCreatorNote(note: string): void;
  chooseVerdict(id: VerdictId): { option: VerdictOption; beat: StoryBeat };
}

export function createStoryEngine(dossier: StoryDossier, pace: StoryPace = 'full', memory?: SavedProjectMemory | null): StoryEngine {
  let act: StoryAct = 'reception';
  let isNight = false;
  let hologramDeployed = false;
  let diverted = false;
  let tapePlayed = false;
  let activeTodoIndex = 0;
  let discoveredCrt = false;
  let discoveredTv = false;
  let discoveredDoor = false;
  let verdict: VerdictId | null = memory?.verdict ?? null;
  let creatorNote = memory?.creatorNote.slice(0, 240) ?? '';
  const cycle = new Map<string, number>();

  const nextIndex = (key: string, len: number) => { const i = cycle.get(key) ?? 0; cycle.set(key, (i + 1) % len); return i; };
  const archetypeLabel = dossier.reentry?.archetypeLabel ?? dossier.archetypeLabel ?? 'codebase';
  const firstCommit: StoryCommit | null = dossier.commits && dossier.commits.length > 0 ? dossier.commits[0] : null;
  const todos = dossier.todos ?? [];
  const currentTrack = () => (todos.length > 0 ? todos[activeTodoIndex % todos.length] : null);
  const tape = dossier.tapeClue;
  const tapeRef = tape.lineNumber ? `${tape.path}:${tape.lineNumber}` : tape.path;
  const snippet = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
  const mark = (next: StoryAct) => { if (act !== 'epilogue') act = next; };

  const triggerDiversion = (): StoryBeat => {
    const lang = getLang();
    hologramDeployed = true; discoveredCrt = true;
    if (!diverted) {
      diverted = true; mark('signal_diverted');
      return {
        speaker: tr('VERA · SIGNAL DIVERTED -> CH-B', 'VERA · SEÑAL DESVIADA -> CANAL B', lang),
        text: tr('The unfinished trace won’t fit on this desk. It just started playing on the TV across the lawn.', 'La parte que se cortó no cabe en esta mesa. Acaba de encenderse en el televisor.', lang),
        effect: 'divert_to_tv',
      };
    }
    return {
      speaker: tr('CHANNEL B · TELEVISION', 'CANAL B · TELEVISOR', lang),
      text: tr('Channel B is active across the lawn. Press E at the TV to play the tape.', 'El televisor sigue encendido al otro lado. Pulsa E para reproducir la cinta.', lang),
      effect: 'divert_to_tv',
    };
  };

  const triggerDeskApproach = (): StoryBeat => {
    const lang = getLang();
    discoveredCrt = true;
    if (!hologramDeployed) {
      hologramDeployed = true; mark('desk_hologram');
      return {
        speaker: tr('VERA · LINE 01', 'VERA · LÍNEA 01', lang),
        text: tr(
          `Same PC you entered through. «${dossier.projectName}» (${dossier.knownTotalFiles} files) is unfolding on the desk.`,
          `Es la misma PC por la que entraste. Los ${dossier.knownTotalFiles} archivos de «${dossier.projectName}» se despliegan en la mesa.`,
          lang,
        ),
        effect: 'deploy_hologram',
      };
    }
    if (!diverted) return triggerDiversion();
    return { speaker: tr('ORIGIN PC', 'PC DEL INICIO', lang), text: `${dossier.primaryPiece.observedFact} (${dossier.primaryPiece.provenance})`, effect: 'deploy_hologram' };
  };

  const toggleTime = (): StoryBeat => {
    const lang = getLang();
    isNight = !isNight;
    mark(isNight ? 'island_night' : 'island_day');
    return {
      speaker: tr('OVERLOOK', 'MIRADOR', lang),
      text: isNight
        ? tr('Daylight folds behind the clouds. The tower windows hold the remaining warmth.', 'El día se repliega detrás de las nubes. Las ventanas de la torre sostienen la luz.', lang)
        : tr('Blue sky returns. What you found stays right here in plain sight.', 'Vuelve el cielo azul de siempre. Lo que encontraste sigue aquí a plena luz.', lang),
      effect: 'toggle_time',
    };
  };

  const openDossier = (atDoor = true): StoryBeat => {
    const lang = getLang();
    if (atDoor) { discoveredDoor = true; mark('tunnel_verdict'); }
    const where = isNight || tapePlayed
      ? tr(`Vera waits inside the lit tunnel with the dossier for «${dossier.projectName}».`, `El túnel está iluminado y Vera sostiene el expediente de «${dossier.projectName}».`, lang)
      : tr(`Vera puts down the receiver and opens «${dossier.projectName}».`, `Vera deja el teléfono y abre la ficha de «${dossier.projectName}» aquí mismo.`, lang);
    return {
      speaker: tr('VERA · THRESHOLD', 'VERA · UMBRAL', lang),
      text: `${where} (${dossier.towerRecord.path})`,
      effect: 'open_dossier',
    };
  };

  return {
    get dossier() { return dossier; },
    get pace() { return pace; },
    get act() { return act; },
    get isNight() { return isNight; },
    get hologramDeployed() { return hologramDeployed; },
    get diverted() { return diverted; },
    get tapePlayed() { return tapePlayed; },
    get activeTodoIndex() { return activeTodoIndex; },
    get discoveredCrt() { return discoveredCrt; },
    get discoveredTv() { return discoveredTv; },
    get discoveredDoor() { return discoveredDoor; },
    get verdict() { return verdict; },
    get creatorNote() { return creatorNote; },

    getReceptionLines(): [string, string, string] {
      const lang = getLang();
      const l1 = tr(`I’m Vera, at Reception. «${dossier.projectName}» got here before you did.`, `Soy Vera, de Recepción. «${dossier.projectName}» llegó antes que tú.`, lang);
      let l2: string;
      if (firstCommit) {
        const finalized = /^docs:\s*finalize/i.test(firstCommit.message);
        l2 = finalized
          ? tr(
              `Latest commit (${firstCommit.date}): «${snippet(firstCommit.message, 64)}». Snapshot archived with open fallback edges.`,
              `Último commit (${firstCommit.date}): «${snippet(firstCommit.message, 64)}». Instantánea archivada con bordes abiertos.`,
              lang,
            )
          : tr(
              `Latest commit (${firstCommit.date}): «${snippet(firstCommit.message, 68)}». Then the line went quiet.`,
              `Tu último commit (${firstCommit.date}): «${snippet(firstCommit.message, 68)}». Después se cortó la línea.`,
              lang,
            );
      } else if (tape.kind === 'unfinished') {
        l2 = tr(`Cataloged ${dossier.knownTotalFiles} files (${archetypeLabel}). Unfinished trace at ${tapeRef}.`, `Catalogué ${dossier.knownTotalFiles} archivos (${archetypeLabel}). Rastro pendiente en ${tapeRef}.`, lang);
      } else {
        l2 = tr(`Cataloged ${dossier.knownTotalFiles} files (${archetypeLabel}). It’s already mounted outside.`, `Catalogué ${dossier.knownTotalFiles} archivos (${archetypeLabel}). Ya está montado del otro lado.`, lang);
      }
      const l3 = tr('Walk through the far door to see it outside, or press Tab for the Direct Dossier.', 'Cruza la puerta del fondo para verlo afuera, o pulsa Tab para abrir la ficha.', lang);
      return [l1, l2, l3];
    },

    getObjective(): string {
      const lang = getLang();
      if (act === 'reception') return tr('Cross the far door or press Tab for the Direct Dossier', 'Cruza la puerta del fondo o pulsa Tab para abrir la ficha', lang);
      if (act === 'epilogue') {
        const v = VERDICT_OPTIONS.find((o) => o.id === verdict);
        if (!v) return tr('The island remains open', 'La isla sigue abierta', lang);
        return `${lang === 'es' ? v.labelEs : v.label} · ${dossier.projectName}`;
      }
      if (act === 'island_day') return hologramDeployed
        ? tr('Signal diverted to the TV: press E at the TV', 'La señal se desvió al televisor: pulsa E en la TV', lang)
        : tr('Walk to the beige PC on the left — your repo is waiting there', 'Acércate a la PC a la izquierda — algo tuyo está encendido ahí', lang);
      if (act === 'desk_hologram') return tr('Inspecting desk hologram · press E or wait for diversion', 'Hologramas desplegados · pulsa E en la PC', lang);
      if (act === 'signal_diverted') return tr('Cross to the TV on the right and press E to play Channel B', 'Cruza al televisor a la derecha y pulsa E para reproducir Canal B', lang);
      if (act === 'island_night') return tr('Enter the lit tower tunnel to meet Vera & export your Kiro Spec', 'Entra al túnel iluminado de la torre para ver a Vera y exportar tu Kiro Spec', lang);
      if (act === 'tunnel_verdict') return tr('Choose: Restore in Kiro, Archive, or Leave Unfinished', 'Elige: Restaurar en Kiro, Archivar o Dejar inconcluso', lang);
      return tr('The island remains open', 'La isla sigue abierta', lang);
    },

    getPoiActionLabel(poiId: string): string {
      const lang = getLang();
      if (poiId === 'crt') {
        if (!hologramDeployed) return tr('Inspect Origin PC', 'Mirar la PC del inicio', lang);
        return diverted ? tr('View module graph', 'Ver grafo del proyecto', lang) : tr('Divert trace to TV', 'Desviar rastro al TV', lang);
      }
      if (poiId === 'tv') {
        if (!tapePlayed) return tr('Play Channel B tape', 'Reproducir Cinta B', lang);
        return todos.length > 1
          ? tr(`Next track (${(activeTodoIndex % todos.length) + 1}/${todos.length}) · R Kiro`, `Siguiente pista (${(activeTodoIndex % todos.length) + 1}/${todos.length}) · R Kiro`, lang)
          : tr('Toggle in Kiro [R] / Replay', 'Marcar para Kiro [R]', lang);
      }
      if (poiId === 'door') return verdict ? tr('Reopen dossier', 'Reabrir expediente', lang) : tr('Open dossier & decide', 'Abrir expediente y decidir', lang);
      if (poiId === 'overlook') return isNight ? tr('Return to daylight', 'Volver al día', lang) : tr('Shift to nightfall', 'Llamar al anochecer', lang);
      if (poiId === 'tree') return tr('Listen to the wind', 'Escuchar el viento', lang);
      if (poiId === 'hydrangeas') return tr('Examine hydrangeas', 'Mirar las hortensias', lang);
      return tr('Examine', 'Examinar', lang);
    },

    triggerDeskApproach,
    triggerDiversion,

    interactIslandPoi(poiId: string): StoryBeat {
      const lang = getLang();
      if (act === 'reception') act = 'island_day';
      if (poiId === 'crt') return triggerDeskApproach();

      if (poiId === 'tv') {
        discoveredTv = true;
        const trk = currentTrack();
        const ref = trk ? `${trk.path}:${trk.lineNumber}` : tapeRef;
        const ex = snippet(trk?.excerpt || tape.excerpt, 84);
        if (!tapePlayed) {
          tapePlayed = true; isNight = true; mark('island_night');
          return {
            speaker: tr('CHANNEL B · TELEVISION', 'CINTA B · TELEVISOR', lang),
            text: tr(
              `Tape clicks in at ${ref} — «${ex}». Night falls; Vera’s lamp lights the tower tunnel.`,
              `La cinta arranca en ${ref} — «${ex}». Cae la noche y Vera ilumina el túnel de la torre.`,
              lang,
            ),
            effect: 'shift_night_awaken',
          };
        }
        if (todos.length > 1) {
          activeTodoIndex = (activeTodoIndex + 1) % todos.length;
          const next = currentTrack()!;
          return {
            speaker: `${tr('CHANNEL B · TRACK', 'CANAL B · PISTA', lang)} ${activeTodoIndex + 1}/${todos.length}`,
            text: `[${next.tag}] ${next.path}:${next.lineNumber} — «${snippet(next.excerpt, 92)}»`,
            effect: 'cycle_tv_track',
          };
        }
        return { speaker: tr('CHANNEL B · TELEVISION', 'CINTA B · TELEVISOR', lang), text: `${ref}: ${tape.interpretation}` };
      }

      if (poiId === 'door') return openDossier();
      if (poiId === 'overlook') return toggleTime();

      if (poiId === 'tree') {
        const lines = isNight
          ? [
              tr(`Roots creak above the mist. Oldest observed timestamp: ${dossier.oldestDate ?? 'unknown'}.`, `Las raíces crujen sobre el vacío. Fecha más antigua: ${dossier.oldestDate ?? 'desconocida'}.`, lang),
              tr(`${dossier.categoryCounts.code} code files and ${dossier.categoryCounts.docs} docs remain indexed.`, `Siguen indexados ${dossier.categoryCounts.code} archivos de código y ${dossier.categoryCounts.docs} notas.`, lang),
            ]
          : [
              tr(`«${dossier.projectName}» holds ${dossier.knownTotalFiles} files (${archetypeLabel}).`, `«${dossier.projectName}» reúne ${dossier.knownTotalFiles} archivos (${archetypeLabel}).`, lang),
              tr(`From here both the PC and the tower fit in one frame.`, `Desde aquí la PC y la torre caben en la misma mirada.`, lang),
            ];
        return { speaker: tr('CLIFF TREE', 'ÁRBOL DEL ACANTILADO', lang), text: lines[nextIndex('tree', lines.length)] };
      }

      if (poiId === 'hydrangeas') {
        const lines = isNight
          ? [
              tr(`Cold air over wet concrete. ${dossier.dormantLabel ? `Status: ${dossier.dormantLabel}.` : 'The room clock stays stopped.'}`, `Aire frío sobre hormigón húmedo. ${dossier.dormantLabel ? `Estado: ${dossier.dormantLabel}.` : 'El reloj sigue parado.'}`, lang),
            ]
          : [
              tr('Blue-violet hydrangeas beside the cable feeding the television.', 'Hortensias azul-violeta junto al cable que alimenta el televisor.', lang),
            ];
        return { speaker: tr('HYDRANGEAS', 'HORTENSIAS', lang), text: lines[nextIndex('hydrangeas', lines.length)] };
      }

      return { speaker: tr('THE ISLAND', 'LA ISLA', lang), text: tr('Quiet.', 'El lugar guarda silencio.', lang) };
    },

    isTodoSelected(id: string) { const picked = dossier.selectedTodoIds ?? todos.map((t) => t.id); return picked.includes(id); },
    toggleActiveTodoForKiro() {
      const lang = getLang();
      const trk = currentTrack();
      if (!trk) return { speaker: tr('CHANNEL B', 'CANAL B', lang), text: tr('No code markers to toggle.', 'Sin marcas para alternar.', lang) };
      const cur = new Set(dossier.selectedTodoIds ?? todos.map((t) => t.id));
      const nowOn = !cur.has(trk.id);
      if (nowOn) cur.add(trk.id); else cur.delete(trk.id);
      dossier.selectedTodoIds = [...cur];
      return {
        speaker: tr('TRIAGE · KIRO SPEC', 'TRIAJE · KIRO SPEC', lang),
        text: nowOn
          ? tr(`Marked ${trk.path}:${trk.lineNumber} for Kiro Revival Spec (${cur.size} selected).`, `Incluido ${trk.path}:${trk.lineNumber} en la Kiro Spec (${cur.size} activas).`, lang)
          : tr(`Excluded ${trk.path}:${trk.lineNumber} from Kiro Revival Spec (${cur.size} selected).`, `Excluido ${trk.path}:${trk.lineNumber} de la Kiro Spec (${cur.size} activas).`, lang),
        effect: 'toggle_tv_todo',
      };
    },
    openDirectAccess() { return openDossier(false); },
    setNight(night: boolean) { isNight = night; if (act !== 'epilogue') act = night ? 'island_night' : 'island_day'; },
    setCreatorNote(note: string) { creatorNote = note.slice(0, 240); },
    chooseVerdict(id: VerdictId) {
      const lang = getLang();
      const option = VERDICT_OPTIONS.find((o) => o.id === id) ?? VERDICT_OPTIONS[0];
      verdict = option.id; act = 'epilogue'; isNight = option.timeAfter === 'night';
      const line = lang === 'es' ? option.veraLineEs : option.veraLine;
      if (option.id === 'restore') {
        return { option, beat: { speaker: 'VERA', text: `${line} (${tapeRef})`, effect: 'shift_day_dawn', artifact: 'kiro_revival_spec' } };
      }
      if (option.id === 'archive') {
        return { option, beat: { speaker: 'VERA', text: `${line} («${dossier.projectName}»)`, effect: 'night_calm', artifact: 'archive_card' } };
      }
      return { option, beat: { speaker: 'VERA', text: line, effect: 'night_keep' } };
    },
  };
}

export const typeDelayMs = (ch: string): number => (/[.,;:]/.test(ch) ? 190 : 46);
export function typingMs(text: string): number { let ms = 0; for (let i = 0; i < text.length - 1; i++) ms += typeDelayMs(text[i]); return ms; }
export const lineSeconds = (text: string): number => typingMs(text) / 1000 + 0.9;
export function receptionCues(lines: readonly string[], pace: 'demo' | 'full', reduceMotion = false): { l1: number; l2: number; l3: number; clr: number } {
  const base = pace === 'demo' ? [4.8, 8.6, 12.2, 15.5] : reduceMotion ? [4.9, 9.2, 13.8, 19.0] : [7.8, 12.2, 16.9, 22.0];
  const cue = [base[0]];
  for (let i = 0; i < 3; i++) cue.push(Math.max(base[i + 1] + (cue[i] - base[i]), cue[i] + lineSeconds(lines[i] ?? '')));
  return { l1: cue[0], l2: cue[1], l3: cue[2], clr: cue[3] };
}