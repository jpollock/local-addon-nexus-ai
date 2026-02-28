import * as fs from 'fs';
import * as path from 'path';
import { SiteStructure, ThemeInfo, PluginInfo } from '../../common/types';

/**
 * Scans a Local site's file system to discover themes, plugins, and WP configuration.
 * Works on any site regardless of running state — reads from disk only.
 */
export class FileScanner {
  /**
   * Scan a site's directory to build a SiteStructure.
   * sitePath is the Local site root, e.g. /Users/.../Local Sites/mysite
   */
  async scan(sitePath: string): Promise<SiteStructure> {
    const webRoot = path.join(sitePath, 'app', 'public');

    const themes = this.scanThemes(webRoot);
    const plugins = this.scanPlugins(webRoot);
    const wpVersion = this.detectWpVersion(webRoot);
    const phpVersion = this.detectPhpVersion(sitePath);
    const isMultisite = this.detectMultisite(webRoot);

    const pluginSlugs = new Set(plugins.map((p) => p.slug));

    return {
      themes,
      plugins,
      phpVersion,
      wpVersion,
      isMultisite,
      hasWooCommerce: pluginSlugs.has('woocommerce'),
      hasACF: pluginSlugs.has('advanced-custom-fields') || pluginSlugs.has('advanced-custom-fields-pro'),
    };
  }

  private scanThemes(webRoot: string): ThemeInfo[] {
    const themesDir = path.join(webRoot, 'wp-content', 'themes');
    if (!fs.existsSync(themesDir)) return [];

    const entries = this.readDirSafe(themesDir);
    const themes: ThemeInfo[] = [];

    // Detect active theme from wp_options if wp-config is readable
    // (We'd need DB access for definitive answer; use file heuristic instead)
    // The most recently modified theme with an index.php is likely active.

    for (const slug of entries) {
      const themeDir = path.join(themesDir, slug);
      if (!this.isDirectory(themeDir)) continue;

      const stylePath = path.join(themeDir, 'style.css');
      if (!fs.existsSync(stylePath)) continue;

      const meta = this.parseThemeStyleCss(stylePath);
      const isChildTheme = fs.existsSync(path.join(themeDir, 'style.css')) &&
        meta.template !== undefined && meta.template !== '';

      themes.push({
        name: meta.name || slug,
        slug,
        version: meta.version || '',
        isActive: false,  // Will be set by ContentPipeline if DB is available
        isChildTheme,
        parentTheme: isChildTheme ? meta.template : undefined,
      });
    }

    return themes;
  }

  private parseThemeStyleCss(stylePath: string): Record<string, string> {
    const meta: Record<string, string> = {};
    try {
      const content = fs.readFileSync(stylePath, 'utf-8');
      // Read the header comment block
      const headerMatch = content.match(/\/\*[\s\S]*?\*\//);
      if (!headerMatch) return meta;

      const header = headerMatch[0];
      const fields = [
        ['name', /Theme Name:\s*(.+)/i],
        ['version', /Version:\s*(.+)/i],
        ['template', /Template:\s*(.+)/i],
        ['author', /Author:\s*(.+)/i],
        ['description', /Description:\s*(.+)/i],
      ] as const;

      for (const [key, regex] of fields) {
        const match = header.match(regex);
        if (match) meta[key] = match[1].trim();
      }
    } catch {
      // Unreadable style.css
    }
    return meta;
  }

  private scanPlugins(webRoot: string): PluginInfo[] {
    const pluginsDir = path.join(webRoot, 'wp-content', 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const entries = this.readDirSafe(pluginsDir);
    const plugins: PluginInfo[] = [];

    for (const slug of entries) {
      const pluginDir = path.join(pluginsDir, slug);
      if (!this.isDirectory(pluginDir)) continue;

      // Find the main plugin file (typically matches the directory name)
      const mainFile = this.findMainPluginFile(pluginDir, slug);
      if (!mainFile) continue;

      const meta = this.parsePluginFileHeader(mainFile);

      plugins.push({
        name: meta.name || slug,
        slug,
        version: meta.version || '',
        isActive: false,  // Will be set by ContentPipeline if DB is available
        description: meta.description || '',
      });
    }

    return plugins;
  }

  private findMainPluginFile(pluginDir: string, slug: string): string | null {
    // Try the file matching the directory name first
    const primary = path.join(pluginDir, `${slug}.php`);
    if (fs.existsSync(primary)) return primary;

    // Fall back to scanning for any PHP file with a Plugin Name header
    const phpFiles = this.readDirSafe(pluginDir)
      .filter((f) => f.endsWith('.php'))
      .slice(0, 5); // Limit scan

    for (const file of phpFiles) {
      const fullPath = path.join(pluginDir, file);
      try {
        const head = fs.readFileSync(fullPath, 'utf-8').slice(0, 4096);
        if (/Plugin Name:/i.test(head)) return fullPath;
      } catch {
        continue;
      }
    }

    return null;
  }

  private parsePluginFileHeader(filePath: string): Record<string, string> {
    const meta: Record<string, string> = {};
    try {
      const content = fs.readFileSync(filePath, 'utf-8').slice(0, 8192);
      const fields = [
        ['name', /Plugin Name:\s*(.+)/i],
        ['version', /Version:\s*(.+)/i],
        ['description', /Description:\s*(.+)/i],
        ['author', /Author:\s*(.+)/i],
      ] as const;

      for (const [key, regex] of fields) {
        const match = content.match(regex);
        if (match) meta[key] = match[1].trim();
      }
    } catch {
      // Unreadable plugin file
    }
    return meta;
  }

  private detectWpVersion(webRoot: string): string {
    // wp-includes/version.php contains: $wp_version = '6.5.2';
    const versionFile = path.join(webRoot, 'wp-includes', 'version.php');
    try {
      const content = fs.readFileSync(versionFile, 'utf-8');
      const match = content.match(/\$wp_version\s*=\s*['"]([\d.]+)['"]/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  private detectPhpVersion(sitePath: string): string {
    // Local stores PHP config in conf/php/ — version can be inferred from
    // the site's services config (passed in externally) or from the php binary path.
    // As a fallback, read conf/php/php.ini for version hints.
    const phpIni = path.join(sitePath, 'conf', 'php', 'php.ini');
    try {
      const content = fs.readFileSync(phpIni, 'utf-8');
      const match = content.match(/PHP Version[:\s]*([\d.]+)/i);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  private detectMultisite(webRoot: string): boolean {
    const wpConfigPath = path.join(webRoot, 'wp-config.php');
    try {
      const content = fs.readFileSync(wpConfigPath, 'utf-8');
      return /define\s*\(\s*['"]MULTISITE['"]\s*,\s*true\s*\)/i.test(content);
    } catch {
      return false;
    }
  }

  private readDirSafe(dir: string): string[] {
    try {
      return fs.readdirSync(dir).filter((e) => !e.startsWith('.'));
    } catch {
      return [];
    }
  }

  private isDirectory(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }
}
