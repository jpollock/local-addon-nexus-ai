export interface PluginRecord {
  slug: string;
  version: string;
  status: string;
}

export interface PluginDiff {
  onlyInA:           PluginRecord[];
  onlyInB:           PluginRecord[];
  versionMismatches: Array<{
    slug:     string;
    versionA: string;
    versionB: string;
    statusA:  string;
    statusB:  string;
  }>;
}

export function computePluginDiff(
  pluginsA: PluginRecord[],
  pluginsB: PluginRecord[],
): PluginDiff {
  const mapA = new Map(pluginsA.map(p => [p.slug, p]));
  const mapB = new Map(pluginsB.map(p => [p.slug, p]));

  const onlyInA: PluginRecord[] = [];
  const onlyInB: PluginRecord[] = [];
  const versionMismatches: PluginDiff['versionMismatches'] = [];

  for (const [slug, pa] of mapA) {
    const pb = mapB.get(slug);
    if (!pb) { onlyInA.push(pa); continue; }
    if (pa.version !== pb.version) {
      versionMismatches.push({
        slug,
        versionA: pa.version,
        versionB: pb.version,
        statusA:  pa.status,
        statusB:  pb.status,
      });
    }
  }

  for (const [slug, pb] of mapB) {
    if (!mapA.has(slug)) onlyInB.push(pb);
  }

  return { onlyInA, onlyInB, versionMismatches };
}
