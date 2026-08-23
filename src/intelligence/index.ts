/**
 * Intelligence core — public surface.
 *
 * Step 1 of the migration sequence (architecture doc §10): local ledger,
 * envelopes, emission middleware, twins-as-folds. The host (the addon) wires
 * HostPorts and producers; agents and UI consume through this surface only.
 */
export * from './envelope/types';
export { eventId, taskId, ulid } from './envelope/ulid';
export { validateEnvelope, envelopeSchema } from './envelope/validate';
export { Ledger, QueryOptions } from './ledger/ledger';
export { Emitter, createEmitter } from './emit/emitter';
export { Fold, runFold, catchUp } from './folds/foldWorker';
export {
  TwinStore,
  TwinFact,
  Freshness,
  sloFor,
  DEFAULT_FRESHNESS_SLOS,
} from './folds/twinStore';
export {
  createPluginTwinFold,
  PluginObservedPayload,
  DriftNotice,
} from './folds/pluginTwinFold';
export { createStateTwinFold } from './folds/stateTwinFold';
export {
  createPipelineStatusFold,
  PIPELINE_RUN_SCHEMA,
  PipelineRunPayload,
  PipelineLayer,
  PipelineOutcome,
  PipelineTrigger,
  PipelineSiteKind,
} from './folds/pipelineStatusFold';
export {
  EntityService,
  EstablishedBy,
  AliasRecord,
  ResolveCandidate,
  PairingProposal,
} from './entity/entityService';
export {
  divergence,
  resolveLineage,
  compareNumericVersions,
  DivergenceDeps,
  DivergenceReport,
  ContentDivergence,
  ContentReason,
  CodeDivergence,
  CodeItem,
  CodeItemSide,
  CodeItemStatus,
  CodeDirection,
  SideObservation,
  SyncAnchor,
  SyncFlow,
  SyncDirection,
  UpstreamCandidate,
  UpstreamVia,
} from './compare/divergence';
export { HostPorts, ClockPort, IdentityPort, StoragePort, systemClock } from './host/ports';
export {
  Constraint,
  ConstraintOrigin,
  Enforcement,
  LawDocument,
  LawLoadError,
  LawLoadResult,
  // The runbook contract (WP-20a, ADR-17 third amendment) — 20b/20c read these.
  ATTEST_CLASSES,
  AttestClass,
  Runbook,
  RunbookArmingPredicate,
  RunbookCheckpoint,
  RunbookEvidence,
  RunbookLoadError,
  RunbookRefusalCode,
  RunbookStrictness,
  RunbookTool,
  RunbookWarning,
  RunbookWarningCode,
  RUNBOOK_REFUSAL_CODES,
  RUNBOOK_WARNING_CODES,
  RUNBOOK_STRICTNESS,
  ToolMode,
  ToolScope,
  TOOL_MODES,
  TOOL_SCOPES,
} from './law/types';
export { loadLawDirectory, parseLawDocument } from './law/loader';
export { canonicalDocumentText, canonicalByteLength, documentHash } from './law/hash';
export { ConstraintRegistry, ConstraintFilter, LawDocumentMeta } from './law/registry';
export {
  RunbookRegistry,
  RunbookFilter,
  STRICT_RUNBOOK_CEILING_BYTES,
  RUNBOOK_NEAR_CEILING_BYTES,
} from './law/runbookRegistry';
export {
  // Arming (WP-20b, P1) — three deterministic paths, no model call anywhere.
  // 20c reads the predicate path, 20d reads the gate path and its refusal.
  armAtGate,
  armByPredicate,
  armByRequest,
  armsOnMatches,
  claimsTool,
  renderLateArmRefusal,
  tokenizeTurnText,
  ArmedBy,
  ArmedProcedure,
  ArmingOutcome,
  ArmingRefusalReason,
} from './law/arming';
export {
  assemble,
  estimateTokens,
  policyVersionHash,
  renderAmbientBlock,
  renderTurnBlock,
  renderRoutingBlock,
  // WP-20c · procedure delivery
  buildProcedureIndex,
  renderProcedureBlock,
  renderProcedureIndex,
  nextGatedCheckpoint,
  renderProcedureSection,
  resolveProcedure,
  ResolvedProcedure,
  PROCEDURE_TOKEN_CEILING,
  ROUTING_TABLE,
  NO_INSTRUMENT_SOURCE,
  FRESHNESS_DISCLOSURE_CONTRACT,
  TOKEN_ESTIMATOR_METHOD,
  TOKEN_ESTIMATOR_SCOPE,
} from './assemble/assembler';
export {
  AssembleRequest,
  AssembleDeps,
  AssembleActor,
  Autonomy,
  BundleManifest,
  ContextBundle,
  EntityRef,
  FrameSlot,
  FreshnessRecord,
  IntelligencePlane,
  PolicySet,
  PolicyConstraintView,
  ProcedureArmedBy,
  ProcedureCheckpointView,
  ProcedureCursor,
  ProcedureDelivery,
  ProcedureGrantRef,
  ProcedureIndexEntry,
  ProcedureOutcome,
  ProcedureRefusal,
  ProcedureRefusalCode,
  ProcedureRequest,
  PROCEDURE_REFUSAL_CODES,
  RunbookRegistryPort,
  RetrievalRecord,
  RetrievedItem,
  RoutingRecord,
  SemanticHit,
  SemanticPort,
  TaskFrame,
  ToolGrant,
} from './assemble/types';
export {
  derivePermissionConstraints,
  comparePermissionMirror,
  PermissionsSnapshot,
  PermissionsSnapshotException,
  MirrorDivergence,
  RemoteOperation,
  RemoteEnv,
  PERMISSIONS_SETTINGS_SOURCE,
} from './law/permissionsTranslation';
