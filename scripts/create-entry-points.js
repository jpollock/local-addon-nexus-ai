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
