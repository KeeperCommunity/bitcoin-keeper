'use strict';
// Synthetic fake Actions responses plus actual ZIP/parser/producer-shape composition.
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { fixture, PRIVATE, POLICY } = require('./private-actions.cjs');
const { syntheticParent } = require('./parent-software.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function zip(members) {
  const encoded = Object.fromEntries(Object.entries(members).map(([name, bytes]) => [name, bytes.toString('base64')]));
  const input = Buffer.from(JSON.stringify(encoded), 'utf8');
  const digest = hash(input);
  const python = [
    'import base64,io,json,sys,zipfile,hashlib',
    'expected=int(sys.argv[1])',
    'raw=sys.stdin.buffer.read(expected)',
    'if len(raw)!=expected: raise ValueError("truncated private archive fixture input")',
    'if hashlib.sha256(raw).hexdigest()!=sys.argv[2]: raise ValueError("private archive fixture input digest mismatch")',
    'values=json.loads(raw.decode("utf8"))',
    'out=io.BytesIO()',
    'z=zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED)',
    '[z.writestr(k,base64.b64decode(v)) for k,v in values.items()]',
    'z.close()',
    'sys.stdout.buffer.write(out.getvalue())',
  ].join('\n');
  return execFileSync('python3', ['-B', '-c', python, String(input.length), digest],
  { input, maxBuffer: 12 * 1024 * 1024,
    env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' } });
}
function fixtureSoftware({ appTree, appProfile } = {}) {
  const f = fixture({ appProfile }), APP = f.expected.IOS.app.repository;
  if (appTree) {
    for (const p of ['IOS', 'ANDROID']) f.expected[p].app.tree = appTree;
    f.commits[`${APP}:${f.expected.IOS.app.sha}`].tree.sha = appTree;
    f.trees[`${APP}:${f.expected.IOS.app.sha}`].sha = appTree;
    for (const p of ['IOS', 'ANDROID']) {
      const e = f.expected[p], policy = JSON.parse(f.files[`${PRIVATE}:${e.control.sha}`][POLICY]);
      policy.app_tree = appTree; f.rebind(PRIVATE, e.control.sha, POLICY, Buffer.from(JSON.stringify(policy)));
    }
  }
  f.rawFixtures = {}; f.archives = {}; f.downloads = []; f.storageRequests = []; f.afterStorage = () => {};
  for (const platform of ['IOS', 'ANDROID']) {
    const raw = syntheticParent(platform), e = f.expected[platform], old = structuredClone(raw.expected);
    const replacements = new Map([[old.app.tree, e.app.tree], [old.app.repository, e.app.repository], [old.control.sha, e.control.sha],
      [old.control.tree, e.control.tree], [old.backend.sha, e.backend.sha],
      [old.control.repository, e.control.repository], [old.backend.repository, e.backend.repository],
      [`${old.execution.repository}/${old.execution.workflowPath}@${old.execution.ref}`,
        `${e.execution.repository}/${e.execution.workflowPath}@${e.execution.ref}`],
      [`keeper-r5-native-protected-${old.execution.runId}-${old.execution.runAttempt}`,
        `keeper-r5-native-protected-${e.execution.runId}-${e.execution.runAttempt}`]]);
    function visit(value) {
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') visit(child);
        else if (key === 'run_id') value[key] = String(e.execution.runId);
        else if (key === 'run_attempt') value[key] = String(e.execution.runAttempt);
        else if (replacements.has(child)) value[key] = replacements.get(child);
      }
    }
    visit(raw.values); Object.assign(raw.expected, structuredClone(e));
    f.rawFixtures[platform] = raw;
  }
  f.rebuild = (platform, members = f.rawFixtures[platform].rebind()) => {
    const e = f.expected[platform], artifact = f.artifacts[e.execution.runId + 100];
    f.archives[artifact.id] = zip(members);
    artifact.size_in_bytes = f.archives[artifact.id].length;
    artifact.digest = `sha256:${hash(f.archives[artifact.id])}`;
    return artifact;
  };
  for (const p of ['IOS', 'ANDROID']) f.rebuild(p);
  f.github.rest.actions.downloadArtifact = async args => {
    if (args.owner !== 'KeeperCommunity' || args.repo !== 'bitcoin-keeper-relay' || args.archive_format !== 'zip' ||
      args.request.parseSuccessResponseBody !== false) throw new Error('Unexpected disposable SDK request');
    f.downloads.push(args.artifact_id);
    const url = `https://api.github.com/repos/${PRIVATE}/actions/artifacts/${args.artifact_id}/zip`;
    const response = await args.request.fetch(url, { method: 'GET', headers: { authorization: 'Bearer SYNTHETIC_ONLY' } });
    return { status: response.status, headers: { location: response.headers.get('location') } };
  };
  f.fetchImpl = async (url, init) => {
    url = new URL(url);
    if (url.hostname === 'api.github.com') {
      if (init.redirect !== 'manual' || init.headers.authorization !== 'Bearer SYNTHETIC_ONLY')
        throw new Error('Unexpected disposable API hop');
      const artifactId = Number(url.pathname.split('/').at(-2));
      return new Response('', { status: 302, headers: { location: `https://fixture.blob.core.windows.net/${artifactId}` } });
    }
    if (url.hostname !== 'fixture.blob.core.windows.net' || init.redirect !== 'error' || init.headers)
      throw new Error('Credentials or redirects crossed disposable storage boundary');
    const artifactId = Number(url.pathname.slice(1)); f.storageRequests.push(artifactId); f.afterStorage(artifactId);
    const bytes = f.archives[artifactId];
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  };
  return f;
}
module.exports = { fixtureSoftware, zip };
