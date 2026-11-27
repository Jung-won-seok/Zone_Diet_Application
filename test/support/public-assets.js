const { readFileSync } = require('node:fs');
const path = require('node:path');
const assets = require('../../config/public-assets');

function readPublicAsset(filename) {
  return readFileSync(path.resolve(__dirname, '../..', assets[filename]), 'utf8');
}

module.exports = { readPublicAsset };
