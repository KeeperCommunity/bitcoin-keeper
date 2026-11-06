#!/usr/bin/env node
'use strict';

const path = require('node:path');

// Match setup.sh's existing polyfills without invoking its dependency installer.
// The unfiltered --hack command selects every core shim, including packages this
// app does not depend on, and makes valid imports such as constants unresolvable.
const SHIMS = Object.freeze([
  'buffer', 'events', 'process', 'stream', 'inherits', 'path', 'assert', 'crypto',
]);

function runNodeify(root = path.resolve(__dirname, '../..')) {
  if (process.cwd() !== root) {
    throw new Error('Run native Node compatibility preparation from the repository root.');
  }
  const cli = require.resolve('rn-nodeify/cmd.js', { paths: [root] });
  const coreList = require.resolve(path.join(path.dirname(cli), 'coreList.js'));
  require(coreList);
  require.cache[coreList].exports = [...SHIMS];
  const originalArguments = process.argv;
  try {
    // No --install flag: the pinned upstream CLI can apply its existing module
    // and file compatibility fixes, but cannot enter installShims().
    process.argv = [process.execPath, cli, '--hack'];
    require(cli);
  } finally {
    process.argv = originalArguments;
  }
}

module.exports = { runNodeify, SHIMS };
if (require.main === module) runNodeify();
