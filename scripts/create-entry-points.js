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
const wpPluginsSource = path.join(__dirname, '..', 'wp-plugins');
const wpPluginsDest = path.join(libDir, 'wp-plugins');
if (fs.existsSync(wpPluginsSource)) {
  fs.cpSync(wpPluginsSource, wpPluginsDest, { recursive: true });
  console.log('WP plugins copied to lib/wp-plugins/');
}
