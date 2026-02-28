import * as http from 'http';
import { RestApiInfo } from '../../../common/types';

const STANDARD_NAMESPACES = new Set([
  'wp/v2',
  'oembed/1.0',
  'wp-site-health/v1',
  'wp-block-editor/v1',
]);

/**
 * Discover REST API namespaces and route count by hitting /wp-json/.
 * Returns null if the site is unreachable or REST API is disabled.
 */
export async function discoverRestApi(siteDomain: string): Promise<RestApiInfo | null> {
  const url = `http://${siteDomain}/wp-json/`;

  let body: string;
  try {
    body = await httpGet(url);
  } catch {
    return null;
  }

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object') return null;

  const namespaces: string[] = Array.isArray(data.namespaces) ? data.namespaces : [];
  const routes = data.routes && typeof data.routes === 'object' ? data.routes : {};
  const routeCount = Object.keys(routes).length;

  const customNamespaces = namespaces.filter((ns) => !STANDARD_NAMESPACES.has(ns));

  return {
    namespaces,
    customNamespaces,
    routeCount,
  };
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}
