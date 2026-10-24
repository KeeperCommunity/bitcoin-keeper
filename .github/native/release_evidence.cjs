// Read-only Actions provenance. Writable PR assertions/artifacts supply no credit.
async function evidence(github, context, { ios, android, attempt }) {
  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;
  const repository = owner + '/' + repo;
  if (ios !== 'success' || android !== 'success' || context.eventName !== 'pull_request' ||
      !pr || pr.number === 7045 || pr.base.ref !== 'sprint' ||
      pr.head.repo?.full_name !== repository || pr.base.repo?.full_name !== repository ||
      !pr.head.repo.id || !pr.base.repo.id || !/^[a-f0-9]{40}$/.test(pr.head.sha) ||
      !Number.isSafeInteger(attempt) || attempt < 1) return false;
  try {
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner, repo, workflow_id: 'keeper-release-acceptance.yml',
      head_sha: pr.head.sha, event: 'pull_request', per_page: 100,
    });
    const run = runs.sort((a, b) => b.id - a.id)[0];
    if (!run || run.id !== context.runId || run.run_attempt !== attempt ||
        run.path !== '.github/workflows/keeper-release-acceptance.yml' ||
        run.event !== 'pull_request' || run.head_sha !== pr.head.sha ||
        run.head_branch !== pr.head.ref || run.head_repository?.full_name !== repository ||
        run.head_repository?.id !== pr.head.repo.id ||
        (!['in_progress', 'completed'].includes(run.status) ||
         (run.status === 'completed' && !['success', 'failure'].includes(run.conclusion)))) return false;
    const linked = run.pull_requests?.find(item => item.number === pr.number);
    if (!linked || linked.head?.sha !== pr.head.sha || linked.head?.ref !== pr.head.ref ||
        linked.head?.repo?.id !== pr.head.repo.id || linked.base?.ref !== 'sprint' ||
        linked.base?.sha !== pr.base.sha || linked.base?.repo?.id !== pr.base.repo.id) return false;
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
      owner, repo, run_id: run.id, attempt_number: attempt, per_page: 100,
    });
    return ['IOS', 'ANDROID'].every(platform => {
      const matches = jobs.filter(job => job.name ===
        `${platform.toLowerCase()} / Native ${platform} build and probes`);
      if (matches.length !== 1) return false;
      const job = matches[0];
      if (job.head_sha !== pr.head.sha || job.run_id !== run.id || job.run_attempt !== attempt ||
          job.status !== 'completed' || job.conclusion !== 'success') return false;
      const steps = ['Build development app', ...(platform === 'IOS'
        ? ['Run disposable startup smoke', 'Run disposable native persistence probe']
        : ['Run Android startup and native persistence probes'])];
      return steps.every(name => {
        const found = job.steps?.filter(step => step.name === name) ?? [];
        return found.length === 1 && found[0].status === 'completed' && found[0].conclusion === 'success';
      });
    });
  } catch { return false; }
}
module.exports = { evidence };
