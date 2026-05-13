export { SmartSearchHandler } from './SmartSearchHandler';
export { SynonymStore } from './SynonymStore';
export type { SynonymRule } from './SynonymStore';
export { SemanticConfig } from './SemanticConfig';
export type { SemanticConfigData } from './SemanticConfig';
export { TrackerStore } from './TrackerStore';
export { expandSynonyms, applySearchBias, applyPostProcess, computeAggregations, applyTimeDecay } from './find-pipeline';
export type { FindDoc, PostProcessOptions, AggregationTermInput } from './find-pipeline';
export { matchesFilter } from './filter-parser';
