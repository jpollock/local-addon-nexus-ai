const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, '..', 'lib');

if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

fs.writeFileSync(
  path.join(libDir, 'main.js'),
  "module.exports = require('./main/index').default || require('./main/index');\n"
);

fs.writeFileSync(
  path.join(libDir, 'renderer.js'),
  "module.exports = require('./renderer/index').default || require('./renderer/index');\n"
);

console.log('Entry points created: lib/main.js, lib/renderer.js');

// Copy markdown resource files to lib (TypeScript doesn't copy non-TS files)
const srcResourceDir = path.join(__dirname, '..', 'src', 'main', 'mcp', 'instructions', 'resources');
const destResourceDir = path.join(libDir, 'main', 'mcp', 'instructions', 'resources');

function copyMarkdownFiles(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyMarkdownFiles(srcPath, destPath);
    } else if (entry.name.endsWith('.md')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyMarkdownFiles(srcResourceDir, destResourceDir);
console.log('Markdown resources copied to lib/');

// Copy WP plugin files to lib (these are PHP files bundled with the addon)
// Exclude node_modules to avoid copying 1.7GB+ of dev dependencies
const wpPluginsSource = path.join(__dirname, '..', 'wp-plugins');
const wpPluginsDest = path.join(libDir, 'wp-plugins');

function copyWpPluginsExcludingNodeModules(src, dest) {
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip node_modules directories entirely
    if (entry.isDirectory() && entry.name === 'node_modules') {
      continue;
    }

    if (entry.isDirectory()) {
      copyWpPluginsExcludingNodeModules(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(wpPluginsSource)) {
  try {
    copyWpPluginsExcludingNodeModules(wpPluginsSource, wpPluginsDest);
    console.log('WP plugins copied to lib/wp-plugins/');
  } catch (err) {
    console.error('Failed to copy WP plugins:', err.message);
    console.log('Continuing build despite WP plugin copy failure...');
  }
}
