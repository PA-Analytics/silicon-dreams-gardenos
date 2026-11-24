/**
 * GardenOS presets — three "gardens" the reception can project.
 *
 * Two of them (trazo, boundary) are built from metadata read off real repositories on disk;
 * one (sentinel-lab) is a clearly-labelled demo used when no local repository is available.
 *
 * Only `type` imports / type-only syntax so the file also loads under
 * `node --experimental-strip-types` without a build step.
 */

export type PresetId = 'trazo' | 'boundary' | 'sentinel-lab';

export type RepoArchetype = 'course' | 'app' | 'saas' | 'security' | 'creative' | 'general';

export interface PresetGraphNode {
  id: string;
  label: string;
  group: string;
  x: number;
  y: number;
  weight: number;
  highlight?: boolean;
}

export interface PresetGraphEdge {
  from: string;
  to: string;
  kind?: 'import' | 'folder';
}

export interface PresetTodoTrack {
  id: string;
  path: string;
  lineNumber: number;
  excerpt: string;
  tag: 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'STUB';
  score: number;
}

export interface PresetCommit {
  hash: string;
  message: string;
  date: string;
}

export type PresetProvenance = 'SNAPSHOT' | 'DEMO';

export interface PresetSpec {
  id: PresetId;
  label: string;
  shortDesc: string;
  projectName: string;
  sourceLabel: string;
  isDemo: boolean;
  archetype: RepoArchetype;
  archetypeLabel: string;
  fileCount: number;
  categoryCounts: { images: number; docs: number; code: number; media3d: number; other: number };
  oldestDate: string | null;
  newestDate: string | null;
  dormantLabel: string | null;
  commits: PresetCommit[];
  graph: { nodes: PresetGraphNode[]; edges: PresetGraphEdge[]; hubLabel: string; totalFiles: number; knownTotalFiles: number; sampledFiles: number; importEdgeCount: number };
  todos: PresetTodoTrack[];
  runCommands: string[];
  envHints: string[];
  testCommand: string | null;
  nextSteps: string[];
  primaryImage: { url: string; path: string; name: string } | null;
  galleryImages: string[];
  primaryPiece: {
    id: string;
    title: string;
    path: string;
    kind: 'image' | 'readme' | 'unfinished' | 'file';
    provenance: PresetProvenance;
    observedFact: string;
    interpretation: string;
    excerpt: string;
    dateLabel: string | null;
    imageUrl?: string;
  };
  tapeClue: {
    id: string;
    title: string;
    path: string;
    kind: 'unfinished' | 'file';
    provenance: PresetProvenance;
    lineNumber?: number;
    observedFact: string;
    interpretation: string;
    excerpt: string;
    dateLabel: string | null;
  };
  towerRecord: {
    id: string;
    title: string;
    path: string;
    kind: 'readme' | 'file';
    provenance: PresetProvenance;
    observedFact: string;
    interpretation: string;
    excerpt: string;
    dateLabel: string | null;
  };
  honestyNote: string;
  honestyNoteEs?: string;
}

const TRAZO_NODES: PresetGraphNode[] = [
  { id: 'main', label: 'main.tsx', group: 'entry', x: 0.09, y: 0.34, weight: 3 },
  { id: 'app', label: 'App.tsx', group: 'entry', x: 0.16, y: 0.5, weight: 10 },
  { id: 'chapternav', label: 'ChapterNavigation', group: 'ui', x: 0.1, y: 0.14, weight: 3 },
  { id: 'hudbar', label: 'HudBar', group: 'ui', x: 0.22, y: 0.1, weight: 4 },
  { id: 'missionpanel', label: 'MissionPanel', group: 'ui', x: 0.3, y: 0.22, weight: 6 },
  { id: 'coachcockpit', label: 'CoachCockpit', group: 'ui', x: 0.38, y: 0.32, weight: 5 },
  { id: 'calibrationview', label: 'CreatorCalibrationView', group: 'ui', x: 0.42, y: 0.18, weight: 4 },
  { id: 'identityentry', label: 'IdentityEntry', group: 'ui', x: 0.12, y: 0.66, weight: 4 },
  { id: 'rolegateway', label: 'RoleGateway', group: 'ui', x: 0.09, y: 0.84, weight: 4 },
  { id: 'questmap', label: 'QuestMap', group: 'map', x: 0.22, y: 0.72, weight: 8 },
  { id: 'questnode', label: 'QuestNode', group: 'map', x: 0.26, y: 0.86, weight: 4 },
  { id: 'questedge', label: 'QuestEdge', group: 'map', x: 0.36, y: 0.8, weight: 3 },
  { id: 'junction', label: 'JunctionNode', group: 'map', x: 0.4, y: 0.9, weight: 3 },
  { id: 'territory', label: 'TerritoryNode', group: 'map', x: 0.44, y: 0.7, weight: 3 },
  { id: 'mapcontrols', label: 'MapControls', group: 'map', x: 0.16, y: 0.92, weight: 2 },
  { id: 'companionavatar', label: 'CompanionAvatar', group: 'companion', x: 0.3, y: 0.44, weight: 5 },
  { id: 'trazzcharacter', label: 'TrazzCharacter', group: 'companion', x: 0.34, y: 0.58, weight: 4 },
  { id: 'usecompanion', label: 'useCompanionTraveler', group: 'companion', x: 0.38, y: 0.46, weight: 3 },
  { id: 'domaincourse', label: 'domain/course.ts', group: 'domain', x: 0.54, y: 0.5, weight: 12 },
  { id: 'progression', label: 'domain/progression.ts', group: 'domain', x: 0.5, y: 0.62, weight: 6 },
  { id: 'identity', label: 'domain/identity.ts', group: 'domain', x: 0.64, y: 0.56, weight: 6 },
  { id: 'learner', label: 'domain/learner.ts', group: 'domain', x: 0.58, y: 0.66, weight: 4 },
  { id: 'companion', label: 'domain/companion.ts', group: 'domain', x: 0.6, y: 0.38, weight: 4 },
  { id: 'evalpolicy', label: 'domain/evaluationPolicy.ts', group: 'domain', x: 0.68, y: 0.42, weight: 4 },
  { id: 'methodadapter', label: 'methodologyAdapter.ts', group: 'domain', x: 0.64, y: 0.26, weight: 4 },
  { id: 'methodruntime', label: 'methodologyRuntime.ts', group: 'domain', x: 0.58, y: 0.14, weight: 4 },
  { id: 'packs', label: 'data/packs/index.ts', group: 'data', x: 0.5, y: 0.78, weight: 6 },
  { id: 'pack1', label: 'packs/primer-cliente.ts', group: 'data', x: 0.52, y: 0.9, weight: 3 },
  { id: 'serverindex', label: 'server/index.ts', group: 'server', x: 0.9, y: 0.14, weight: 5 },
  { id: 'serverapp', label: 'server/app.ts', group: 'server', x: 0.84, y: 0.3, weight: 8 },
  { id: 'service', label: 'server/service.ts', group: 'server', x: 0.78, y: 0.5, weight: 7 },
  { id: 'repository', label: 'server/repository.ts', group: 'server', x: 0.88, y: 0.6, weight: 5 },
  { id: 'identityservice', label: 'identityService.ts', group: 'server', x: 0.9, y: 0.44, weight: 4 },
  { id: 'evaluationservice', label: 'evaluator/evaluatorService.ts', group: 'server', x: 0.7, y: 0.62, weight: 5 },
  { id: 'geminiinterp', label: 'geminiInterpreter.ts', group: 'ai', x: 0.76, y: 0.76, weight: 4 },
  { id: 'companionservice', label: 'companion/companionService.ts', group: 'ai', x: 0.86, y: 0.88, weight: 4 },
  { id: 'autonomyservice', label: 'autonomy/autonomyService.ts', group: 'ai', x: 0.7, y: 0.86, weight: 5 },
  { id: 'stalldetector', label: 'autonomy/stallDetector.ts', group: 'ai', x: 0.62, y: 0.92, weight: 4 },
  { id: 'airuntime', label: 'ai/runtime.ts', group: 'ai', x: 0.72, y: 0.08, weight: 4 },
];

const TRAZO_EDGES: PresetGraphEdge[] = [
  { from: 'main', to: 'app' },
  { from: 'app', to: 'chapternav' },
  { from: 'app', to: 'hudbar' },
  { from: 'app', to: 'missionpanel' },
  { from: 'app', to: 'questmap' },
  { from: 'app', to: 'coachcockpit' },
  { from: 'app', to: 'identityentry' },
  { from: 'app', to: 'rolegateway' },
  { from: 'app', to: 'packs' },
  { from: 'app', to: 'domaincourse' },
  { from: 'app', to: 'progression' },
  { from: 'app', to: 'identity' },
  { from: 'chapternav', to: 'domaincourse' },
  { from: 'hudbar', to: 'domaincourse' },
  { from: 'hudbar', to: 'identity' },
  { from: 'missionpanel', to: 'domaincourse' },
  { from: 'missionpanel', to: 'learner' },
  { from: 'coachcockpit', to: 'domaincourse' },
  { from: 'coachcockpit', to: 'identity' },
  { from: 'coachcockpit', to: 'calibrationview' },
  { from: 'calibrationview', to: 'domaincourse' },
  { from: 'calibrationview', to: 'identity' },
  { from: 'identityentry', to: 'identity' },
  { from: 'rolegateway', to: 'identity' },
  { from: 'questmap', to: 'domaincourse' },
  { from: 'questmap', to: 'progression' },
  { from: 'questmap', to: 'companionavatar' },
  { from: 'questmap', to: 'junction' },
  { from: 'questmap', to: 'mapcontrols' },
  { from: 'questmap', to: 'questedge' },
  { from: 'questmap', to: 'questnode' },
  { from: 'questmap', to: 'territory' },
  { from: 'questnode', to: 'domaincourse' },
  { from: 'questedge', to: 'domaincourse' },
  { from: 'junction', to: 'domaincourse' },
  { from: 'territory', to: 'domaincourse' },
  { from: 'companionavatar', to: 'companion' },
  { from: 'companionavatar', to: 'domaincourse' },
  { from: 'companionavatar', to: 'trazzcharacter' },
  { from: 'companionavatar', to: 'usecompanion' },
  { from: 'usecompanion', to: 'companion' },
  { from: 'usecompanion', to: 'domaincourse' },
  { from: 'progression', to: 'domaincourse' },
  { from: 'learner', to: 'domaincourse' },
  { from: 'companion', to: 'domaincourse' },
  { from: 'evalpolicy', to: 'domaincourse' },
  { from: 'methodadapter', to: 'domaincourse' },
  { from: 'methodruntime', to: 'domaincourse' },
  { from: 'packs', to: 'domaincourse' },
  { from: 'packs', to: 'pack1' },
  { from: 'pack1', to: 'domaincourse' },
  { from: 'serverindex', to: 'serverapp' },
  { from: 'serverindex', to: 'repository' },
  { from: 'serverindex', to: 'service' },
  { from: 'serverindex', to: 'identityservice' },
  { from: 'serverindex', to: 'autonomyservice' },
  { from: 'serverindex', to: 'airuntime' },
  { from: 'serverapp', to: 'domaincourse' },
  { from: 'serverapp', to: 'identity' },
  { from: 'serverapp', to: 'companionservice' },
  { from: 'serverapp', to: 'evaluationservice' },
  { from: 'serverapp', to: 'geminiinterp' },
  { from: 'serverapp', to: 'airuntime' },
  { from: 'serverapp', to: 'autonomyservice' },
  { from: 'serverapp', to: 'repository' },
  { from: 'serverapp', to: 'identityservice' },
  { from: 'serverapp', to: 'service' },
  { from: 'serverapp', to: 'methodadapter' },
  { from: 'serverapp', to: 'methodruntime' },
  { from: 'service', to: 'learner' },
  { from: 'service', to: 'domaincourse' },
  { from: 'service', to: 'progression' },
  { from: 'service', to: 'packs' },
  { from: 'service', to: 'methodadapter' },
  { from: 'service', to: 'methodruntime' },
  { from: 'service', to: 'evaluationservice' },
  { from: 'repository', to: 'domaincourse' },
  { from: 'repository', to: 'identity' },
  { from: 'identityservice', to: 'packs' },
  { from: 'identityservice', to: 'identity' },
  { from: 'identityservice', to: 'service' },
  { from: 'evaluationservice', to: 'evalpolicy' },
  { from: 'evaluationservice', to: 'packs' },
  { from: 'geminiinterp', to: 'domaincourse' },
  { from: 'geminiinterp', to: 'airuntime' },
  { from: 'companionservice', to: 'domaincourse' },
  { from: 'companionservice', to: 'progression' },
  { from: 'companionservice', to: 'packs' },
  { from: 'companionservice', to: 'methodadapter' },
  { from: 'companionservice', to: 'methodruntime' },
  { from: 'autonomyservice', to: 'packs' },
  { from: 'autonomyservice', to: 'domaincourse' },
  { from: 'autonomyservice', to: 'progression' },
  { from: 'autonomyservice', to: 'methodadapter' },
  { from: 'autonomyservice', to: 'methodruntime' },
  { from: 'autonomyservice', to: 'service' },
  { from: 'autonomyservice', to: 'stalldetector' },
  { from: 'stalldetector', to: 'packs' },
  { from: 'stalldetector', to: 'domaincourse' },
  { from: 'stalldetector', to: 'progression' },
  { from: 'stalldetector', to: 'methodadapter' },
  { from: 'stalldetector', to: 'methodruntime' },
];

const BOUNDARY_NODES: PresetGraphNode[] = [
  { id: 'main', label: 'src/main.py', group: 'entry', x: 0.1, y: 0.5, weight: 8, highlight: true },
  { id: 'common_config', label: 'common/config.py', group: 'common', x: 0.18, y: 0.3, weight: 5 },
  { id: 'common_logging', label: 'common/logging.py', group: 'common', x: 0.12, y: 0.2, weight: 3 },
  { id: 'common_paths', label: 'common/paths.py', group: 'common', x: 0.18, y: 0.62, weight: 4 },
  { id: 'data_fetch', label: 'data/fetch.py', group: 'data', x: 0.26, y: 0.14, weight: 5 },
  { id: 'data_normalize', label: 'data/normalize.py', group: 'data', x: 0.26, y: 0.26, weight: 4 },
  { id: 'data_quality', label: 'data/quality.py', group: 'data', x: 0.34, y: 0.1, weight: 4 },
  { id: 'data_schemas', label: 'data/schemas.py', group: 'data', x: 0.34, y: 0.22, weight: 8 },
  { id: 'perp_schemas', label: 'perpetual/schemas.py', group: 'perpetual', x: 0.44, y: 0.12, weight: 7 },
  { id: 'perp_guard', label: 'perpetual/guard.py', group: 'perpetual', x: 0.52, y: 0.1, weight: 8 },
  { id: 'perp_hashing', label: 'perpetual/hashing.py', group: 'perpetual', x: 0.44, y: 0.24, weight: 4 },
  { id: 'perp_quality', label: 'perpetual/quality.py', group: 'perpetual', x: 0.52, y: 0.24, weight: 4 },
  { id: 'perp_persistence', label: 'perpetual/persistence.py', group: 'perpetual', x: 0.6, y: 0.16, weight: 5 },
  { id: 'perp_normalizers', label: 'perpetual/normalizers.py', group: 'perpetual', x: 0.6, y: 0.28, weight: 4 },
  { id: 'perp_materializer', label: 'historical_materializer.py', group: 'perpetual', x: 0.68, y: 0.22, weight: 5 },
  { id: 'perp_funding', label: 'funding_reference_materializer.py', group: 'perpetual', x: 0.76, y: 0.14, weight: 4 },
  { id: 'binance_archive', label: 'sources/binance_archive.py', group: 'perpetual', x: 0.84, y: 0.1, weight: 5 },
  { id: 'domain_perpetual', label: 'domain/perpetual.py', group: 'domain', x: 0.44, y: 0.36, weight: 8 },
  { id: 'strat_base', label: 'strategies/base.py', group: 'strategies', x: 0.26, y: 0.42, weight: 6 },
  { id: 'strat_meanrev', label: 'strategies/mean_reversion.py', group: 'strategies', x: 0.18, y: 0.4, weight: 4 },
  { id: 'strat_momentum', label: 'strategies/momentum.py', group: 'strategies', x: 0.22, y: 0.54, weight: 4 },
  { id: 'strat_tsmom', label: 'strategies/tsmom_4h.py', group: 'strategies', x: 0.22, y: 0.66, weight: 4 },
  { id: 'bt_costs', label: 'backtest/costs.py', group: 'backtest', x: 0.3, y: 0.56, weight: 5 },
  { id: 'bt_fills', label: 'backtest/fills.py', group: 'backtest', x: 0.3, y: 0.68, weight: 4 },
  { id: 'bt_portfolio', label: 'backtest/portfolio.py', group: 'backtest', x: 0.38, y: 0.62, weight: 5 },
  { id: 'bt_engine', label: 'backtest/engine.py', group: 'backtest', x: 0.38, y: 0.48, weight: 7 },
  { id: 'bt_metrics', label: 'backtest/metrics.py', group: 'backtest', x: 0.46, y: 0.52, weight: 6 },
  { id: 'bt_report', label: 'backtest/report.py', group: 'backtest', x: 0.46, y: 0.66, weight: 4 },
  { id: 'bt_evaluator', label: 'backtest/evaluator.py', group: 'backtest', x: 0.54, y: 0.44, weight: 5 },
  { id: 'bt_perp_metrics', label: 'backtest/perpetual_metrics.py', group: 'perpetual', x: 0.62, y: 0.36, weight: 4 },
  { id: 'bt_perp_evaluator', label: 'backtest/perpetual_evaluator.py', group: 'perpetual', x: 0.7, y: 0.32, weight: 5 },
  { id: 'bt_03c_orch', label: 'backtest/phase_03c_orchestration.py', group: 'phase', x: 0.7, y: 0.44, weight: 5 },
  { id: 'bt_03d_d2', label: 'backtest/phase_03d_d2.py', group: 'phase', x: 0.78, y: 0.36, weight: 5 },
  { id: 'risk_sizing', label: 'risk/position_sizing.py', group: 'risk', x: 0.84, y: 0.28, weight: 3 },
  { id: 'risk_gate', label: 'risk/risk_gate.py', group: 'risk', x: 0.28, y: 0.8, weight: 5 },
  { id: 'trading_paper', label: 'trading/paper_engine.py', group: 'trading', x: 0.2, y: 0.74, weight: 5 },
  { id: 'trading_ws', label: 'trading/ws_client.py', group: 'trading', x: 0.14, y: 0.86, weight: 3 },
  { id: 'val_baselines', label: 'validation/baselines.py', group: 'validation', x: 0.54, y: 0.72, weight: 4 },
  { id: 'val_stress', label: 'validation/stress_test.py', group: 'validation', x: 0.62, y: 0.8, weight: 3 },
  { id: 'val_walk', label: 'validation/walk_forward.py', group: 'validation', x: 0.7, y: 0.72, weight: 3 },
];

const BOUNDARY_EDGES: PresetGraphEdge[] = [
  { from: 'main', to: 'bt_engine' },
  { from: 'main', to: 'bt_metrics' },
  { from: 'main', to: 'bt_report' },
  { from: 'main', to: 'common_config' },
  { from: 'main', to: 'common_logging' },
  { from: 'main', to: 'common_paths' },
  { from: 'main', to: 'data_fetch' },
  { from: 'main', to: 'data_normalize' },
  { from: 'main', to: 'data_quality' },
  { from: 'main', to: 'strat_base' },
  { from: 'main', to: 'trading_paper' },
  { from: 'common_logging', to: 'common_config' },
  { from: 'data_fetch', to: 'common_config' },
  { from: 'data_fetch', to: 'common_paths' },
  { from: 'data_fetch', to: 'data_schemas' },
  { from: 'data_normalize', to: 'common_paths' },
  { from: 'data_normalize', to: 'data_schemas' },
  { from: 'data_quality', to: 'common_logging' },
  { from: 'data_quality', to: 'data_schemas' },
  { from: 'perp_guard', to: 'perp_schemas' },
  { from: 'perp_quality', to: 'perp_hashing' },
  { from: 'perp_quality', to: 'perp_schemas' },
  { from: 'perp_quality', to: 'domain_perpetual' },
  { from: 'perp_normalizers', to: 'perp_schemas' },
  { from: 'perp_normalizers', to: 'domain_perpetual' },
  { from: 'perp_persistence', to: 'perp_guard' },
  { from: 'perp_persistence', to: 'perp_hashing' },
  { from: 'perp_persistence', to: 'perp_quality' },
  { from: 'perp_persistence', to: 'perp_schemas' },
  { from: 'perp_persistence', to: 'domain_perpetual' },
  { from: 'perp_materializer', to: 'perp_guard' },
  { from: 'perp_materializer', to: 'perp_hashing' },
  { from: 'perp_materializer', to: 'perp_normalizers' },
  { from: 'perp_materializer', to: 'perp_persistence' },
  { from: 'perp_materializer', to: 'perp_quality' },
  { from: 'perp_materializer', to: 'perp_schemas' },
  { from: 'perp_materializer', to: 'binance_archive' },
  { from: 'perp_materializer', to: 'domain_perpetual' },
  { from: 'perp_funding', to: 'perp_guard' },
  { from: 'perp_funding', to: 'perp_hashing' },
  { from: 'perp_funding', to: 'perp_persistence' },
  { from: 'perp_funding', to: 'binance_archive' },
  { from: 'perp_funding', to: 'domain_perpetual' },
  { from: 'binance_archive', to: 'perp_guard' },
  { from: 'binance_archive', to: 'perp_schemas' },
  { from: 'strat_base', to: 'data_schemas' },
  { from: 'strat_base', to: 'strat_meanrev' },
  { from: 'strat_base', to: 'strat_momentum' },
  { from: 'strat_meanrev', to: 'data_schemas' },
  { from: 'strat_meanrev', to: 'strat_base' },
  { from: 'strat_momentum', to: 'strat_base' },
  { from: 'bt_fills', to: 'bt_costs' },
  { from: 'bt_portfolio', to: 'bt_costs' },
  { from: 'bt_portfolio', to: 'bt_fills' },
  { from: 'bt_portfolio', to: 'data_schemas' },
  { from: 'bt_engine', to: 'bt_costs' },
  { from: 'bt_engine', to: 'bt_fills' },
  { from: 'bt_engine', to: 'bt_portfolio' },
  { from: 'bt_engine', to: 'common_logging' },
  { from: 'bt_engine', to: 'strat_base' },
  { from: 'bt_report', to: 'bt_metrics' },
  { from: 'bt_report', to: 'common_paths' },
  { from: 'bt_evaluator', to: 'bt_costs' },
  { from: 'bt_evaluator', to: 'bt_engine' },
  { from: 'bt_evaluator', to: 'bt_metrics' },
  { from: 'bt_evaluator', to: 'bt_report' },
  { from: 'bt_evaluator', to: 'strat_base' },
  { from: 'bt_perp_evaluator', to: 'perp_guard' },
  { from: 'bt_perp_evaluator', to: 'domain_perpetual' },
  { from: 'bt_perp_evaluator', to: 'risk_sizing' },
  { from: 'bt_perp_evaluator', to: 'strat_tsmom' },
  { from: 'bt_perp_metrics', to: 'perp_guard' },
  { from: 'bt_perp_metrics', to: 'domain_perpetual' },
  { from: 'bt_03c_orch', to: 'perp_guard' },
  { from: 'bt_03d_d2', to: 'bt_perp_evaluator' },
  { from: 'bt_03d_d2', to: 'bt_perp_metrics' },
  { from: 'bt_03d_d2', to: 'bt_03c_orch' },
  { from: 'bt_03d_d2', to: 'perp_guard' },
  { from: 'bt_03d_d2', to: 'perp_hashing' },
  { from: 'bt_03d_d2', to: 'perp_persistence' },
  { from: 'bt_03d_d2', to: 'domain_perpetual' },
  { from: 'bt_03d_d2', to: 'strat_tsmom' },
  { from: 'trading_paper', to: 'bt_costs' },
  { from: 'trading_paper', to: 'bt_fills' },
  { from: 'trading_paper', to: 'bt_portfolio' },
  { from: 'trading_paper', to: 'data_schemas' },
  { from: 'trading_paper', to: 'risk_gate' },
  { from: 'trading_paper', to: 'strat_base' },
  { from: 'trading_paper', to: 'strat_meanrev' },
  { from: 'trading_paper', to: 'trading_ws' },
  { from: 'val_baselines', to: 'bt_costs' },
  { from: 'val_baselines', to: 'bt_engine' },
  { from: 'val_baselines', to: 'bt_metrics' },
  { from: 'val_baselines', to: 'strat_base' },
  { from: 'val_stress', to: 'bt_costs' },
  { from: 'val_stress', to: 'bt_engine' },
  { from: 'val_stress', to: 'bt_metrics' },
];

const SENTINEL_NODES: PresetGraphNode[] = [
  { id: 'readme', label: 'README.md', group: 'docs', x: 0.1, y: 0.14, weight: 3 },
  { id: 'reqs', label: 'requirements.txt', group: 'docs', x: 0.18, y: 0.26, weight: 3 },
  { id: 'env', label: '.env.example', group: 'docs', x: 0.1, y: 0.38, weight: 2 },
  { id: 'conftest', label: 'tests/conftest.py', group: 'tests', x: 0.2, y: 0.62, weight: 3 },
  { id: 'test_scanner', label: 'tests/test_scanner.py', group: 'tests', x: 0.14, y: 0.74, weight: 3 },
  { id: 'test_parsers', label: 'tests/test_parsers.py', group: 'tests', x: 0.22, y: 0.86, weight: 3 },
  { id: 'm1_pkg', label: 'modulo-01-redes/__init__.py', group: 'modulo-01', x: 0.36, y: 0.12, weight: 3 },
  { id: 'm1_socket', label: 'modulo-01-redes/socket_basico.py', group: 'modulo-01', x: 0.44, y: 0.2, weight: 4 },
  { id: 'm1_dns', label: 'modulo-01-redes/dns_lookup.py', group: 'modulo-01', x: 0.36, y: 0.3, weight: 3 },
  { id: 'm1_iface', label: 'modulo-01-redes/interfaces.py', group: 'modulo-01', x: 0.46, y: 0.4, weight: 3 },
  { id: 'm2_pkg', label: 'modulo-02-paquetes/__init__.py', group: 'modulo-02', x: 0.58, y: 0.14, weight: 3 },
  { id: 'm2_parse', label: 'modulo-02-paquetes/packet_parser.py', group: 'modulo-02', x: 0.66, y: 0.22, weight: 5 },
  { id: 'm2_arp', label: 'modulo-02-paquetes/arp_sniff.py', group: 'modulo-02', x: 0.58, y: 0.34, weight: 4 },
  { id: 'm2_icmp', label: 'modulo-02-paquetes/icmp_tools.py', group: 'modulo-02', x: 0.66, y: 0.46, weight: 3 },
  { id: 'm3_banner', label: 'modulo-03-fingerprint/banner_grab.py', group: 'modulo-03', x: 0.4, y: 0.52, weight: 4 },
  { id: 'm3_headers', label: 'modulo-03-fingerprint/http_headers.py', group: 'modulo-03', x: 0.32, y: 0.64, weight: 3 },
  { id: 'm4_scanner', label: 'modulo-04-scanner/port_scanner.py', group: 'modulo-04', x: 0.52, y: 0.7, weight: 8, highlight: true },
  { id: 'm4_cidr', label: 'modulo-04-scanner/cidr_utils.py', group: 'modulo-04', x: 0.62, y: 0.8, weight: 4 },
];

const SENTINEL_EDGES: PresetGraphEdge[] = [
  { from: 'conftest', to: 'reqs' },
  { from: 'test_scanner', to: 'conftest' },
  { from: 'test_scanner', to: 'm4_scanner' },
  { from: 'test_parsers', to: 'conftest' },
  { from: 'test_parsers', to: 'm2_parse' },
  { from: 'm1_pkg', to: 'm1_socket' },
  { from: 'm1_pkg', to: 'm1_dns' },
  { from: 'm1_pkg', to: 'm1_iface' },
  { from: 'm1_socket', to: 'm1_dns' },
  { from: 'm2_pkg', to: 'm2_parse' },
  { from: 'm2_pkg', to: 'm2_arp' },
  { from: 'm2_pkg', to: 'm2_icmp' },
  { from: 'm2_parse', to: 'm1_socket' },
  { from: 'm2_arp', to: 'm1_iface' },
  { from: 'm2_icmp', to: 'm1_socket' },
  { from: 'm3_banner', to: 'm1_socket' },
  { from: 'm3_banner', to: 'm2_parse' },
  { from: 'm3_headers', to: 'm3_banner' },
  { from: 'm4_scanner', to: 'm1_socket' },
  { from: 'm4_scanner', to: 'm3_banner' },
  { from: 'm4_scanner', to: 'm4_cidr' },
  { from: 'm4_cidr', to: 'm1_iface' },
];

export const PRESETS: Record<PresetId, PresetSpec> = {
  trazo: {
    id: 'trazo',
    label: 'TRAZO',
    shortDesc:
      'Agentic progression web app: 2.5D mission DAG, Gemini rubric evaluator, and chained learning artifacts.',
    projectName: 'TRAZO — Autonomous Agentic Progression Platform',
    sourceLabel: 'Bundled Snapshot · quest-map-prototype (real codebase)',
    isDemo: false,
    archetype: 'app',
    archetypeLabel: 'Agentic Web App (React 19 + Node + Vertex AI)',
    fileCount: 1406,
    categoryCounts: { images: 196, docs: 146, code: 122, media3d: 0, other: 942 },
    oldestDate: '2026-08-06',
    newestDate: '2026-08-31',
    dormantLabel: 'Archived snapshot · last commit 2026-08-31',
    commits: [
      { hash: 'a68983c', message: 'docs: finalize test counts and verify complete README consistency', date: '2026-08-31' },
      { hash: 'c6e24da', message: 'docs: clean technical blueprint architecture diagram adhering to TRAZO design tokens', date: '2026-08-31' },
      { hash: 'f2fc65d', message: 'docs: add explicit reproducible testing instructions to README', date: '2026-08-31' },
      { hash: '14ada7f', message: 'feat(ui): implement TE-01 Operator 3D hardware node architecture and clean dark mineral cartography', date: '2026-08-29' },
      { hash: 'b71bcbd', message: 'feat: baseline quest map v0', date: '2026-08-06' },
    ],
    graph: {
      nodes: TRAZO_NODES,
      edges: TRAZO_EDGES.map((e) => ({ ...e, kind: 'import' as const })),
      hubLabel: 'src/domain/course.ts',
      totalFiles: 1406,
      knownTotalFiles: 1406,
      sampledFiles: TRAZO_NODES.length,
      importEdgeCount: TRAZO_EDGES.length,
    },
    todos: [],
    runCommands: ['npm ci', 'npm run dev', 'npm start', 'npm run build'],
    envHints: [
      'STORAGE_BACKEND / USE_FIRESTORE — choose local repository or Firestore',
      'GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION',
      'GEMINI_MODEL — model used by evaluator and companion',
      'PORT — HTTP server port',
      'ENABLE_DEV_ROUTES — dev-only routes; keep off outside local',
      'TRAZO_ACTIVE_PACK — active course pack ID',
    ],
    testCommand: 'npm test',
    nextSteps: [
      'Inspect src/utils/companionPathSampler.ts:216 for disconnected SVG path fallback behavior',
      'Run npm run dev and walk mission node N01 to verify the artifact chain',
      'Verify evaluator handling on empty evidence payloads before touching prompts',
    ],
    primaryImage: {
      url: '/demos/trazo/preview-1.png',
      path: '.playwright-cli/n09-available.png',
      name: 'n09-available.png',
    },
    galleryImages: [
      '/demos/trazo/preview-1.png',
      '/demos/trazo/preview-2.png',
      '/demos/trazo/preview-3.png',
    ],
    primaryPiece: {
      id: 'trazo-map-capture',
      title: 'Mission map capture with node N09 available',
      path: '.playwright-cli/n09-available.png',
      kind: 'image',
      provenance: 'SNAPSHOT',
      observedFact:
        '253,459-byte Playwright capture bundled in the TRAZO snapshot showing locked and available DAG nodes together.',
      interpretation:
        'The 2.5D mission graph reflects live prerequisite state rather than a static mockup.',
      excerpt: 'n09-available.png — 253,459 bytes (Playwright verification)',
      dateLabel: '2026-08-31',
      imageUrl: '/demos/trazo/preview-1.png',
    },
    tapeClue: {
      id: 'trazo-sampler-fallback',
      title: 'Path sampler fallback in companionPathSampler.ts',
      path: 'src/utils/companionPathSampler.ts',
      kind: 'file',
      provenance: 'SNAPSHOT',
      lineNumber: 216,
      observedFact:
        'src/utils/companionPathSampler.ts:216 falls back to a straight-line path when SVG segment parsing returns empty.',
      interpretation:
        'Hypothesis (unconfirmed): If a map route uses unsupported SVG commands, companion traversal silently flattens into a straight segment.',
      excerpt: '// Fallback: simple line if parsing yielded no segments',
      dateLabel: '2026-08-31',
    },
    towerRecord: {
      id: 'trazo-readme',
      title: 'README: TRAZO — Autonomous Agentic Progression Platform',
      path: 'README.md',
      kind: 'readme',
      provenance: 'SNAPSHOT',
      observedFact:
        'README declares React 19, Node, Google Vertex AI (gemini-3.7-flash), Cloud Run, and Firestore.',
      interpretation:
        'Shipped as a complete hackathon baseline; useful as a visual/architecture contrast against stalled codebases.',
      excerpt: '# TRAZO — Autonomous Agentic Progression Platform',
      dateLabel: '2026-08-31',
    },
    honestyNote:
      'Bundled real-project snapshot (SNAPSHOT): 20 commits, 1,406 files, and 39 mapped modules extracted from quest-map-prototype without private paths or secrets.',
    honestyNoteEs:
      'Instantánea empaquetada de proyecto real (SNAPSHOT): 20 commits, 1 406 archivos y 39 módulos mapeados desde quest-map-prototype, sin rutas privadas ni secretos.',
  },

  boundary: {
    id: 'boundary',
    label: 'BOUNDARY',
    shortDesc:
      'Quantitative paper-trading research lab: perpetual data pipeline, explicit-cost backtest, and temporal validation.',
    projectName: 'Trading Lab (boundary)',
    sourceLabel: 'Bundled Snapshot · trading-lab (real codebase)',
    isDemo: false,
    archetype: 'general',
    archetypeLabel: 'Python Research Framework (paper trading)',
    fileCount: 909,
    categoryCounts: { images: 0, docs: 59, code: 96, media3d: 0, other: 754 },
    oldestDate: '2026-07-29',
    newestDate: '2026-08-04',
    dormantLabel: 'Frozen snapshot · last commit 2026-08-04',
    commits: [
      { hash: '8437e29', message: 'Ensure get_git_provenance resolves git repository root', date: '2026-08-04' },
      { hash: '684cc25', message: 'Fix Phase 03D exclusive window boundaries and provenance', date: '2026-08-04' },
      { hash: '43a5171', message: 'Guard validate_metric_timestamp call to HoldoutAccessGuard', date: '2026-08-04' },
      { hash: '8e22dc1', message: 'Allow 2026-01-01T00:00:00Z as window end boundary timestamp in perpetual metrics', date: '2026-08-04' },
      { hash: 'c096832', message: 'Allow resume on initialized execution directory before first cell completion', date: '2026-08-04' },
    ],
    graph: {
      nodes: BOUNDARY_NODES,
      edges: BOUNDARY_EDGES.map((e) => ({ ...e, kind: 'import' as const })),
      hubLabel: 'src/data/perpetual/guard.py',
      totalFiles: 909,
      knownTotalFiles: 909,
      sampledFiles: BOUNDARY_NODES.length,
      importEdgeCount: BOUNDARY_EDGES.length,
    },
    todos: [
      {
        id: 'boundary-todo-report',
        path: 'src/main.py',
        lineNumber: 294,
        excerpt: '# TODO: Implement report generation',
        tag: 'TODO',
        score: 90,
      },
      {
        id: 'boundary-todo-validate',
        path: 'src/main.py',
        lineNumber: 280,
        excerpt: '# TODO: Implement walk-forward validation',
        tag: 'TODO',
        score: 88,
      },
    ],
    runCommands: [
      'uv sync',
      'uv run python -m src.data.fetch --exchange binance --symbol BTCUSDT --timeframe 1m --start 2024-01-01 --end 2024-02-01',
      'uv run python -m src.data.normalize --input data/raw/binance_BTCUSDT_1m_*.parquet',
      'uv run python -m src.backtest.run --experiment config/experiments/exp_0001_mean_reversion.yaml',
    ],
    envHints: [
      'config/universe.yaml — tradable instrument universe',
      'config/risk.yaml — position & drawdown risk limits',
      'config/experiments/exp_0001..0004 — declarative experiment configs',
      'get_git_provenance requires a clean git tree when stamping runs',
    ],
    testCommand: 'uv run pytest',
    nextSteps: [
      'Implement src/main.py:294 report generation instead of printing stub & returning exit code 0',
      'Implement src/main.py:280 walk-forward validation CLI gate',
      'Run uv sync && uv run pytest to verify baseline perpetual guards',
    ],
    primaryImage: null,
    galleryImages: [],
    primaryPiece: {
      id: 'boundary-todo-validate',
      title: 'CLI validate stub in src/main.py',
      path: 'src/main.py',
      kind: 'unfinished',
      provenance: 'SNAPSHOT',
      observedFact:
        'src/main.py:280 contains "# TODO: Implement walk-forward validation" and prints "Validation not yet implemented" returning exit code 0.',
      interpretation:
        'The backtest engine exists, but the walk-forward validation CLI command still returns success without validating anything.',
      excerpt: '# TODO: Implement walk-forward validation',
      dateLabel: '2026-08-04',
    },
    tapeClue: {
      id: 'boundary-todo-report',
      title: 'CLI report stub in src/main.py',
      path: 'src/main.py',
      kind: 'unfinished',
      provenance: 'SNAPSHOT',
      lineNumber: 294,
      observedFact:
        'src/main.py:294 contains "# TODO: Implement report generation"; the command prints "Report generation not yet implemented" and returns 0.',
      interpretation:
        'Returning exit code 0 on an unimplemented report command masks missing verification in automated runs.',
      excerpt: '# TODO: Implement report generation',
      dateLabel: '2026-08-04',
    },
    towerRecord: {
      id: 'boundary-readme',
      title: 'README: Trading Lab (paper-only)',
      path: 'README.md',
      kind: 'readme',
      provenance: 'SNAPSHOT',
      observedFact:
        'README states: "RESEARCH FRAMEWORK ONLY. It does NOT execute real trades, connect to live exchanges with private keys, or manage real capital."',
      interpretation:
        'The lab prioritizes explicit transaction costs, look-ahead guards, and baseline comparisons before any live deployment.',
      excerpt: 'This is a RESEARCH FRAMEWORK ONLY.',
      dateLabel: '2026-08-04',
    },
    honestyNote:
      'Bundled real-project snapshot (SNAPSHOT): 37 commits, 909 files, 96 Python modules, and 97 real import edges between src.* modules; both src/main.py TODOs are verbatim.',
    honestyNoteEs:
      'Instantánea empaquetada de proyecto real (SNAPSHOT): 37 commits, 909 archivos, 96 módulos Python y 97 imports reales entre módulos src.*; ambos TODO en src/main.py son literales.',
  },

  'sentinel-lab': {
    id: 'sentinel-lab',
    label: 'SENTINEL LAB',
    shortDesc:
      'Synthetic Python offensive security course: four networking-to-scanner modules with tests and an unfinished socket scanner.',
    projectName: 'sentinel-course (demo)',
    sourceLabel: 'Synthetic DEMO fixture — not a real repository on disk',
    isDemo: true,
    archetype: 'course',
    archetypeLabel: 'Modular Python Security Course [DEMO]',
    fileCount: 84,
    categoryCounts: { images: 2, docs: 9, code: 34, media3d: 0, other: 39 },
    oldestDate: '2026-05-12',
    newestDate: '2026-06-28',
    dormantLabel: 'Synthetic DEMO fixture · illustrative dates only',
    commits: [
      { hash: '9f2a1c4', message: 'feat(module-04): threaded TCP scanner queue', date: '2026-06-28' },
      { hash: '3d8e770', message: 'test: packet parser edge coverage', date: '2026-06-14' },
      { hash: 'b41c05a', message: 'feat(module-01): raw sockets and DNS lookup', date: '2026-05-12' },
    ],
    graph: {
      nodes: SENTINEL_NODES,
      edges: SENTINEL_EDGES.map((e) => ({ ...e, kind: 'import' as const })),
      hubLabel: 'modulo-04-scanner/port_scanner.py',
      totalFiles: 84,
      knownTotalFiles: 84,
      sampledFiles: SENTINEL_NODES.length,
      importEdgeCount: SENTINEL_EDGES.length,
    },
    todos: [
      {
        id: 'sentinel-tape-timeout',
        path: 'modulo-04-scanner/port_scanner.py',
        lineNumber: 64,
        excerpt: '# TODO: add per-socket timeout and validate CIDR ranges before scanning',
        tag: 'TODO',
        score: 90,
      },
      {
        id: 'sentinel-tape-cidr',
        path: 'modulo-04-scanner/cidr_utils.py',
        lineNumber: 28,
        excerpt: '# FIXME: reject broadcast and non-private ranges unless --allow-external is set',
        tag: 'FIXME',
        score: 80,
      },
    ],
    runCommands: [
      'python -m venv .venv',
      'pip install -r requirements.txt',
      'cp .env.example .env',
      'python modulo-04-scanner/port_scanner.py --target 127.0.0.1 --ports 1-1024',
    ],
    envHints: [
      'SENTINEL_MAX_THREADS — scanner worker count (demo)',
      'SENTINEL_TIMEOUT — per-socket timeout (unwired)',
      'SENTINEL_ALLOWED_CIDR — allowed target subnet',
    ],
    testCommand: 'pytest -q',
    nextSteps: [
      'Add explicit socket timeout in port_scanner.py:64 before any real scan',
      'Validate CIDR ranges in cidr_utils.py:28 before opening sockets',
      'Expand tests/test_scanner.py beyond the single happy-path case',
    ],
    primaryImage: null,
    galleryImages: [],
    primaryPiece: {
      id: 'sentinel-todo-timeout',
      title: 'TODO in port_scanner.py',
      path: 'modulo-04-scanner/port_scanner.py',
      kind: 'unfinished',
      provenance: 'DEMO',
      observedFact:
        'Line 64 (DEMO): missing socket timeout and CIDR range validation in the module 04 scanner.',
      interpretation:
        'The course pauses right where defensive bounds checking should be taught.',
      excerpt: '# TODO: add per-socket timeout and validate CIDR ranges before scanning',
      dateLabel: '2026-06-28',
    },
    tapeClue: {
      id: 'sentinel-tape-timeout',
      title: 'Module 04 unfinished TODO',
      path: 'modulo-04-scanner/port_scanner.py',
      kind: 'unfinished',
      provenance: 'DEMO',
      lineNumber: 64,
      observedFact:
        'Line 64 (DEMO) marks the final uncompleted guard in modulo-04-scanner/port_scanner.py.',
      interpretation:
        'Synthetic demo fixture used to demonstrate multi-TODO triage and Kiro Spec export without needing local files.',
      excerpt: '# TODO: add per-socket timeout and validate CIDR ranges before scanning',
      dateLabel: '2026-06-28',
    },
    towerRecord: {
      id: 'sentinel-readme',
      title: 'README (synthetic demo)',
      path: 'README.md',
      kind: 'readme',
      provenance: 'DEMO',
      observedFact:
        'Describes four Python security modules with requirements.txt, .env.example, and pytest.',
      interpretation:
        'Explicitly labeled DEMO so it is never confused with a user-supplied repository.',
      excerpt: '# sentinel-course — Python security lab (DEMO)',
      dateLabel: '2026-05-12',
    },
    honestyNote:
      'Synthetic DEMO fixture (isDemo: true). File counts, commits, and TODOs are illustrative sample data.',
    honestyNoteEs:
      'Muestra sintética DEMO (isDemo: true). Las cifras, commits y TODO son datos ilustrativos de ejemplo.',
  },
};

export const PRESET_LIST: PresetSpec[] = [PRESETS.trazo, PRESETS.boundary, PRESETS['sentinel-lab']];
