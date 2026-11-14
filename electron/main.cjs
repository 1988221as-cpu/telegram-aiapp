const path = require('path');
const fs = require('fs');

const candidates = [
  path.resolve(__dirname, '..', 'main.cjs'),
  path.resolve(__dirname, 'main.cjs'),
  path.resolve(process.cwd(), 'main.cjs'),
];

let target = null;
for (const c of candidates) {
  if (fs.existsSync(c) && c !== __filename) {
    target = c;
    break;
  }
}

if (target) {
  module.exports = require(target);
} else {
  module.exports = require('../main.cjs');
}
