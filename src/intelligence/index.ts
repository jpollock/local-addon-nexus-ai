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
  EntityService,
  EstablishedBy,
  AliasRecord,
  ResolveCandidate,
  PairingProposal,
} from './entity/entityService';
export { HostPorts, ClockPort, IdentityPort, StoragePort, systemClock } from './host/ports';
export {
  Constraint,
  ConstraintOrigin,
  Enforcement,
  LawDocument,
  LawLoadError,
  LawLoadResult,
} from './law/types';
export { loadLawDirectory, parseLawDocument } from './law/loader';
export { ConstraintRegistry, ConstraintFilter, LawDocumentMeta } from './law/registry';
export {
  assemble,
  estimateTokens,
  policyVersionHash,
  renderAmbientBlock,
  renderTurnBlock,
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
  FreshnessRecord,
  PolicySet,
  PolicyConstraintView,
  RetrievalRecord,
  RetrievedItem,
  SemanticHit,
  SemanticPort,
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
