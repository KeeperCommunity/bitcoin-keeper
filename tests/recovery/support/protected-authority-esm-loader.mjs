// Preserve the production ESM imports and real installed crypto implementations.
// This is source transpilation only, not a native/Metro runtime acceptance lane.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function loadProtectedAuthority() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  const filename = path.join(root, 'src/services/backup/authority.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  assert.equal(output.diagnostics.length, 0, 'Actual authority source must transpile without syntax errors');
  assert.match(output.outputText, /from ['"]@scure\/bip32['"]/);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-backup-authority-esm-'));
  fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(temporary, 'node_modules'), 'dir');
  const encodingSource = fs.readFileSync(path.join(root, 'src/services/backup/encoding.ts'), 'utf8');
  const encoding = ts.transpileModule(encodingSource, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  fs.writeFileSync(path.join(temporary, 'encoding.mjs'), encoding.outputText, { flag: 'wx', mode: 0o600 });
  const emitted = path.join(temporary, 'authority.mjs');
  fs.writeFileSync(emitted, output.outputText.replace("import './encoding';", "import './encoding.mjs';"), { flag: 'wx', mode: 0o600 });
  const module = await import(pathToFileURL(emitted).href);
  return { ...module, source, temporary, encodingSource,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex') };
}
