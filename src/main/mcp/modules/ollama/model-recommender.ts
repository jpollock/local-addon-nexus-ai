export interface ModelRecommendation {
  model: string;
  reason: string;
  installed: boolean;
}

/**
 * Memory-to-model mapping, ordered largest-first for priority matching.
 * Each entry specifies the minimum RAM (GB) required to run the model.
 */
const MODEL_TIERS: Array<{ minGB: number; model: string; label: string }> = [
  { minGB: 32, model: 'llama3.3:70b', label: '70B (full precision)' },
  { minGB: 16, model: 'gemma3:12b', label: '12B' },
  { minGB: 12, model: 'llama3.1:8b', label: '8B' },
  { minGB: 0, model: 'llama3.2:3b', label: '3B' },
];

/**
 * Recommend a model based on available system RAM and installed models.
 *
 * Strategy:
 * 1. Find the largest model tier that fits within the memory budget.
 * 2. Prefer an already-installed model that fits.
 * 3. If nothing installed fits, recommend the best model for the hardware.
 */
export function recommendModel(
  totalMemGB: number,
  installedModels: string[],
): ModelRecommendation {
  // Find tiers that fit within available memory
  const eligible = MODEL_TIERS.filter((t) => totalMemGB >= t.minGB);

  if (eligible.length === 0) {
    // Fallback: always suggest the smallest model
    return {
      model: 'llama3.2:3b',
      reason: `Only ${totalMemGB} GB RAM detected — ${MODEL_TIERS[MODEL_TIERS.length - 1].label} is the lightest option`,
      installed: installedModels.some((m) => m.startsWith('llama3.2')),
    };
  }

  // Check if any installed model matches an eligible tier
  for (const tier of eligible) {
    const baseModel = tier.model.split(':')[0];
    const installed = installedModels.find((m) => m.startsWith(baseModel));
    if (installed) {
      return {
        model: installed,
        reason: `Best installed model for ${totalMemGB} GB RAM (${tier.label})`,
        installed: true,
      };
    }
  }

  // Nothing installed fits — recommend the best tier
  const best = eligible[0];
  return {
    model: best.model,
    reason: `Best model for ${totalMemGB} GB RAM (${best.label}) — not yet installed`,
    installed: false,
  };
}
