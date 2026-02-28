import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { FileScanner } from '../../src/main/content/FileScanner';

function createMockSite(tmpDir: string): string {
  const webRoot = path.join(tmpDir, 'app', 'public');

  // Create WP structure
  fs.mkdirSync(path.join(webRoot, 'wp-includes'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, 'wp-content', 'themes', 'twentytwentyfour'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, 'wp-content', 'themes', 'my-child-theme'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, 'wp-content', 'plugins', 'woocommerce'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, 'wp-content', 'plugins', 'akismet'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'conf', 'php'), { recursive: true });

  // wp-includes/version.php
  fs.writeFileSync(
    path.join(webRoot, 'wp-includes', 'version.php'),
    "<?php\n$wp_version = '6.5.2';\n",
  );

  // wp-config.php
  fs.writeFileSync(
    path.join(webRoot, 'wp-config.php'),
    `<?php
define( 'DB_NAME', 'local' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', 'root' );
$table_prefix = 'wp_';
`,
  );

  // Theme style.css
  fs.writeFileSync(
    path.join(webRoot, 'wp-content', 'themes', 'twentytwentyfour', 'style.css'),
    `/*
Theme Name: Twenty Twenty-Four
Version: 1.1.0
Description: A versatile default theme.
Author: WordPress.org
*/`,
  );

  fs.writeFileSync(
    path.join(webRoot, 'wp-content', 'themes', 'my-child-theme', 'style.css'),
    `/*
Theme Name: My Child Theme
Template: twentytwentyfour
Version: 1.0.0
*/`,
  );

  // Plugin files
  fs.writeFileSync(
    path.join(webRoot, 'wp-content', 'plugins', 'woocommerce', 'woocommerce.php'),
    `<?php
/**
 * Plugin Name: WooCommerce
 * Version: 8.5.1
 * Description: An eCommerce toolkit.
 */`,
  );

  fs.writeFileSync(
    path.join(webRoot, 'wp-content', 'plugins', 'akismet', 'akismet.php'),
    `<?php
/**
 * Plugin Name: Akismet Anti-spam
 * Version: 5.3
 * Description: Spam protection.
 */`,
  );

  return tmpDir;
}

describe('FileScanner', () => {
  let tmpDir: string;
  let scanner: FileScanner;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fs-test-'));
    createMockSite(tmpDir);
    scanner = new FileScanner();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects WordPress version', async () => {
    const structure = await scanner.scan(tmpDir);
    expect(structure.wpVersion).toBe('6.5.2');
  });

  test('discovers themes', async () => {
    const structure = await scanner.scan(tmpDir);
    expect(structure.themes.length).toBe(2);

    const tt24 = structure.themes.find((t) => t.slug === 'twentytwentyfour');
    expect(tt24).toBeDefined();
    expect(tt24!.name).toBe('Twenty Twenty-Four');
    expect(tt24!.version).toBe('1.1.0');
    expect(tt24!.isChildTheme).toBe(false);
  });

  test('detects child themes', async () => {
    const structure = await scanner.scan(tmpDir);
    const child = structure.themes.find((t) => t.slug === 'my-child-theme');
    expect(child).toBeDefined();
    expect(child!.isChildTheme).toBe(true);
    expect(child!.parentTheme).toBe('twentytwentyfour');
  });

  test('discovers plugins', async () => {
    const structure = await scanner.scan(tmpDir);
    expect(structure.plugins.length).toBe(2);

    const woo = structure.plugins.find((p) => p.slug === 'woocommerce');
    expect(woo).toBeDefined();
    expect(woo!.name).toBe('WooCommerce');
    expect(woo!.version).toBe('8.5.1');
  });

  test('detects WooCommerce presence', async () => {
    const structure = await scanner.scan(tmpDir);
    expect(structure.hasWooCommerce).toBe(true);
  });

  test('detects no ACF when not installed', async () => {
    const structure = await scanner.scan(tmpDir);
    expect(structure.hasACF).toBe(false);
  });

  test('detects not multisite by default', async () => {
    const structure = await scanner.scan(tmpDir);
    expect(structure.isMultisite).toBe(false);
  });

  test('detects multisite when configured', async () => {
    const wpConfig = path.join(tmpDir, 'app', 'public', 'wp-config.php');
    const content = fs.readFileSync(wpConfig, 'utf-8');
    fs.writeFileSync(wpConfig, content + "\ndefine( 'MULTISITE', true );\n");

    const structure = await scanner.scan(tmpDir);
    expect(structure.isMultisite).toBe(true);
  });

  test('handles non-existent site path gracefully', async () => {
    const structure = await scanner.scan('/nonexistent/path');
    expect(structure.themes).toEqual([]);
    expect(structure.plugins).toEqual([]);
    expect(structure.wpVersion).toBe('');
  });
});
