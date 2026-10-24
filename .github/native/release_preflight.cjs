// Unprivileged PR bootstrap check, not a release authorization or commit-status writer.
const WORKFLOWS = [
  '.github/workflows/keeper-hosted-native.yml',
  '.github/workflows/keeper-release-acceptance.yml',
  '.github/workflows/keeper-native-platform.yml',
];
const NATIVE_FILES = [
  'hosted_native.py', 'nodeify.cjs', 'startup.yaml', 'release_preflight.cjs',
  'release_acceptance.cjs', 'release_evidence.cjs', 'release_metro.cjs', 'release_probe.js',
  'release_probe_core.js', 'release_probe.yaml',
].map(name => '.github/native/' + name);
function fingerprint(tree) {
  if (tree.truncated) throw new Error('Truncated CI tree');
  const entries = tree.tree.filter(e => WORKFLOWS.includes(e.path) || e.path.startsWith('.github/native/'));
  if (![...WORKFLOWS, ...NATIVE_FILES].every(p => entries.some(e => e.path === p && e.type === 'blob' && ['100644', '100755'].includes(e.mode)))) {
    throw new Error('Reviewed Phase A / #7060 infrastructure is not installed');
  }
  return JSON.stringify(entries.map(e => [e.path, e.mode, e.type, e.sha])
    .sort((a, b) => a[0].localeCompare(b[0])));
}
async function preflight(github, context) {
  const original = context.payload.pull_request;
  if (context.eventName !== 'pull_request' || !original || original.number === 7045) {
    return { trusted: false, reason: 'Outside Phase A scope; frozen R4 excluded' };
  }
  const { owner, repo } = context.repo;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: original.number });
  const repository = owner + '/' + repo;
  if (pr.base.ref !== 'sprint' || pr.head.repo?.full_name !== repository ||
      pr.base.repo?.full_name !== repository || pr.head.sha !== original.head.sha ||
      pr.head.ref !== original.head.ref || !/^[a-f0-9]{40}$/.test(pr.head.sha) ||
      !pr.head.repo.id || pr.head.repo.id !== original.head.repo?.id ||
      !pr.base.repo.id || pr.base.repo.id !== original.base.repo?.id ||
      original.base.ref !== 'sprint') {
    return { trusted: false, reason: 'Exact current same-repository PR provenance is unavailable' };
  }
  try {
    const snapshots = await Promise.all([pr.head.sha, pr.base.sha, original.base.sha].map(async ref => {
      const { data } = await github.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: '1' });
      return fingerprint(data);
    }));
    if (!snapshots.every(value => value === snapshots[0])) {
      return { trusted: false, reason: 'CI differs from current or run base; review/install before native acceptance' };
    }
    // Re-read after API work so a concurrent push cannot supply current-head credit.
    const { data: latest } = await github.rest.pulls.get({ owner, repo, pull_number: original.number });
    if (latest.head.sha !== pr.head.sha || latest.base.sha !== pr.base.sha ||
        latest.base.ref !== pr.base.ref || latest.head.ref !== pr.head.ref ||
        latest.head.repo?.id !== pr.head.repo.id || latest.base.repo?.id !== pr.base.repo.id ||
        latest.head.repo?.full_name !== repository || latest.base.repo?.full_name !== repository) {
      return { trusted: false, reason: 'PR source/base changed during provenance verification' };
    }
    return { trusted: true, reason: 'Exact-head CI matches both protected base snapshots' };
  } catch {
    return { trusted: false, reason: 'Reviewed Phase A / #7060 infrastructure unavailable; no native credit' };
  }
}
module.exports = { WORKFLOWS, NATIVE_FILES, fingerprint, preflight };
