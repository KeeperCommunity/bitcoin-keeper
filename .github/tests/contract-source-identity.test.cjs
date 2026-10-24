'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const files = ['keeper-validation-tests.yml', 'keeper-canonical-native-contracts.yml', 'keeper-release-origin-contracts.yml',
  'keeper-release-preparation-contracts.yml', 'keeper-ruby-lock-contracts.yml'];
const directory = path.resolve(__dirname, '../workflows');
const parsed = spawnSync('python3', ['-B', '-c', `
import json,pathlib,sys,yaml
print(json.dumps({name:yaml.load((pathlib.Path(sys.argv[1])/name).read_text(),Loader=yaml.BaseLoader)
                  for name in sys.argv[2:]}))
`, directory, ...files], { encoding: 'utf8', timeout: 5000 });
assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
const workflows = JSON.parse(parsed.stdout);

for (const file of files) test(`${file} preserves read-only contracts with exact source guards around setup/checks`, () => {
  const workflow = workflows[file], job = Object.values(workflow.jobs)[0], steps = job.steps;
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(job.environment, undefined);
  assert.equal(job.secrets, undefined);
  assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref,
    '${{ github.event.pull_request.head.sha || github.sha }}');
  const commands = steps.flatMap((step, index) => step.run ? step.run.split('\n').filter(Boolean).map(run => ({ run, index, step })) : []);
  const guards = commands.filter(item => item.run.includes('verify-ci-source.cjs'));
  const checks = commands.filter(item => /node --test|python3|ruby |bundle exec/.test(item.run));
  assert.ok(guards.length >= 2);
  assert.ok(guards[0].index < checks[0].index);
  const final = guards.at(-1);
  assert.equal(final.step.if, 'always()');
  assert.equal(final.index, steps.length - 1);
  assert.ok(final.index > Math.max(...checks.map(item => item.index)));
  for (const item of commands) if (item.run.includes('python3')) assert.match(item.run, /python3 -B /);
  assert.ok(steps.every(step => !step['continue-on-error']));
  const manual = ['keeper-release-preparation-contracts.yml', 'keeper-ruby-lock-contracts.yml'].includes(file);
  assert.equal(Object.hasOwn(workflow.on, 'workflow_dispatch'), manual);
  assert.ok(guards.every(item => item.run.endsWith(manual ? ' --contract-dispatch' : 'verify-ci-source.cjs')));
  if (file === 'keeper-validation-tests.yml') {
    const install = steps.findIndex(step => step.name === 'Install isolated locked contract tools without lifecycle scripts');
    assert.ok(guards[0].index < install && guards[1].index > install && guards[1].index < checks[0].index);
  }
  if (file === 'keeper-release-preparation-contracts.yml') {
    const setup = steps.findIndex(step => step.uses?.startsWith('ruby/setup-ruby@'));
    assert.ok(guards[0].index < setup && guards[1].index > setup);
  }
  if (file === 'keeper-ruby-lock-contracts.yml') {
    const run = steps.find(step => step.run?.includes('bundle install')).run;
    assert.ok(run.indexOf('verify-ci-source.cjs') > run.indexOf('bundle check'));
    assert.ok(run.indexOf('verify-ci-source.cjs') < run.indexOf('bundle exec'));
    assert.equal(guards.length, 3);
  }
  if (workflow.on.pull_request?.paths) assert.ok(workflow.on.pull_request.paths.includes('.github/scripts/verify-ci-source.cjs'));
});

test('CodeQL checkout and official upload attribution stay unchanged by this contract-only package', () => {
  const codeql = fs.readFileSync(path.join(directory, 'codeql.yml'), 'utf8');
  assert.equal(codeql.includes('verify-ci-source.cjs'), false);
  assert.match(codeql, /if: github.event_name == 'push' && github.ref == 'refs\/heads\/sprint'/);
});
