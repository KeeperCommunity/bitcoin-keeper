'use strict';
// Workflow naming contracts only; no native execution or artifact upload.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const parsed = spawnSync('python3', ['-B', '-c', `
import json,pathlib,sys,yaml
print(json.dumps(yaml.load(pathlib.Path(sys.argv[1]).read_text(),Loader=yaml.BaseLoader)))
`, path.resolve(__dirname, '../workflows/keeper-native-platform.yml')], { encoding: 'utf8', timeout: 5000 });
assert.equal(parsed.status, 0, parsed.stderr);
const workflow = JSON.parse(parsed.stdout);
const upload = workflow.jobs.native.steps.find(step => step.name === 'Retain safe Phase A evidence');

function artifactName({ diagnostic = true, platform = 'IOS', sha = 'a'.repeat(40), run = '90', attempt = '1' } = {}) {
  const expressions = {
    "inputs.diagnostic && 'diagnostic' || 'release'": diagnostic ? 'diagnostic' : 'release',
    'inputs.platform': platform, 'inputs.source_sha': sha,
    'github.run_id': run, 'github.run_attempt': attempt,
  };
  return upload.with.name.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
    assert.ok(Object.hasOwn(expressions, expression), 'unexpected artifact-name context');
    return expressions[expression];
  });
}

test('a retry retains a distinct immutable artifact for the same source and run', () => {
  const retained = new Set();
  for (const attempt of ['1', '2']) {
    const name = artifactName({ attempt });
    assert.equal(retained.has(name), false, 'same-SHA retry must not collide with earlier evidence');
    retained.add(name);
    assert.equal(name, `keeper-diagnostic-native-IOS-${'a'.repeat(40)}-90-${attempt}`);
  }
});

test('artifact selectors distinguish route, platform, source, run and attempt', () => {
  const names = [];
  for (const diagnostic of [true, false]) for (const platform of ['IOS', 'ANDROID'])
    for (const sha of ['a'.repeat(40), 'b'.repeat(40)]) for (const run of ['90', '91'])
      for (const attempt of ['1', '2']) names.push(artifactName({ diagnostic, platform, sha, run, attempt }));
  assert.equal(new Set(names).size, 32);
});

test('failed-run metadata retention cannot overwrite or delete previous attempts', () => {
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.path, 'artifacts/native/*/metadata.json');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], '7');
  assert.equal(upload.with.overwrite, undefined);
  assert.equal(upload.with['include-hidden-files'], undefined);
});
