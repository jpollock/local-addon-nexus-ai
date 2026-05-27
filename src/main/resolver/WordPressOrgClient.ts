const WP_ORG_UPDATE_URL = 'https://api.wordpress.org/plugins/update-check/1.1/';
const TIMEOUT_MS = 10_000;

export class WordPressOrgClient {
  static async checkUpdates(
    plugins: Array<{ slug: string; version: string }>,
  ): Promise<Map<string, string>> {
    if (plugins.length === 0) return new Map();

    const checked: Record<string, string> = {};
    for (const p of plugins) {
      checked[`${p.slug}/${p.slug}.php`] = p.version;
    }

    const body = JSON.stringify({
      plugins: checked,
      active: Object.keys(checked),
    });

    try {
      const response = await fetch(WP_ORG_UPDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `plugins=${encodeURIComponent(body)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const data = await response.json() as { plugins?: Record<string, { new_version?: string }> };
      const updates = new Map<string, string>();

      for (const [path, info] of Object.entries(data?.plugins ?? {})) {
        const slug = path.split('/')[0];
        if (info.new_version) {
          updates.set(slug, info.new_version);
        }
      }

      return updates;
    } catch {
      return new Map();
    }
  }
}
