const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../../src/utils/utilities.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const statement = source.statements.find(node => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'emailCheck'));
assert.ok(statement, 'The production email validator must exist');
const code = ts.transpileModule(statement.getText(source).replace(/^export /, '') + '\nglobalThis.emailCheck = emailCheck;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const scope = {};
vm.runInNewContext(code, scope);

test('email validation preserves existing ASCII word, plus tag and domain separator support', () => {
  for (const email of [
    'alice@example.com', 'a@b.cd', '_name_@_domain_.__',
    'first.last+tag_2@my-host_1.co_uk', 'first-last+tag@example.co.uk',
    'a@a.b.cd', 'a@a.b.c.def', 'a@a-b.c-d.ef', 'NAME123@EXAMPLE99.COM',
  ]) assert.equal(scope.emailCheck(email), true, email);
});

test('email validation rejects malformed separators, short final suffixes and whitespace', () => {
  for (const email of [
    '', 'example.com', '@example.com', 'a@', 'a@@example.com', 'a@b.c', 'a@a.co.x',
    '.a@b.cd', '-a@b.cd', '+a@b.cd', 'a.@b.cd', 'a+@b.cd',
    'a..b@c.de', 'a+-b@c.de', 'a--b@c.de',
    'a@.b.cd', 'a@-b.cd', 'a@b..cd', 'a@b-.cd', 'a@b.-cd',
    'a@b.c-d', 'a@b.c+d', 'a@b.cd.', 'a@b.cd-',
    'a b@c.de', 'a@b c.de', ' a@b.cd', 'a@b.cd ', 'a@b.cd\n', 'a@b.cd\r\n',
    'é@example.com', 'a@例子.com',
  ]) assert.equal(scope.emailCheck(email), false, JSON.stringify(email));
});

test('email validation rejects non-strings without coercing caller objects', () => {
  const hostile = { toString() { throw new Error('Input must not be coerced'); } };
  for (const value of [null, undefined, 123, false, [], ['a@b.cd'], new String('a@b.cd'), hostile])
    assert.equal(scope.emailCheck(value), false);
});

test('hostile long email inputs complete within a subprocess deadline', () => {
  // Keep a regressed exponential validator out of the test runner process.
  // These late failures exercised the former nested optional repetitions.
  const script = code + `
    const assert = require('node:assert/strict');
    const local = 'a'.repeat(200000);
    assert.equal(emailCheck(local + '!'), false);
    assert.equal(emailCheck(local + '..b@example.com'), false);
    assert.equal(emailCheck('a@' + local + '!'), false);
    assert.equal(emailCheck('a@' + 'a.'.repeat(100000) + 'co!'), false);
    assert.equal(emailCheck(local + '@example.com'), true);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    timeout: 3000, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
