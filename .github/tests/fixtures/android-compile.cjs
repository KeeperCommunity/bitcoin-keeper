'use strict';
// Synthetic API/producer custody fixture only. Never actual compilation.
function attach(metadata, request, producer, profile, caller, worker) {
  const artifact = { id: 103, name: `keeper-android-build-checkpoint-${request.sourceSha}-${request.runId}-${request.attempt}`,
    sha256: '6'.repeat(64), size_bytes: 12345 };
  metadata.build_execution_scope = 'SAME_CURRENT_SOURCE_SAME_RUN_OFFICIAL_ANDROID_COMPILE_PRODUCER';
  metadata.current_source_compilation = 'PASS_OFFICIAL_SAME_RUN_PRODUCER_JOB'; metadata.runtime_host_compilation = 'NOT RUN';
  metadata.android_compile_custody = { schema: 1, status: 'PASS', native_acceptance: false,
    repository: profile.repository, repository_id: profile.repositoryId, repository_private: profile.private,
    source_sha: request.sourceSha, source_tree: 'c'.repeat(40), run_id: request.runId, run_attempt: request.attempt,
    workflow_id: 30, workflow_sha: request.workflowSha, workflow_ref: request.workflowRef,
    caller_path: caller, worker_path: worker, diagnostic_only: false, producer_job_id: producer.id,
    producer_job_name: producer.name, producer_check_run_id: Number(producer.check_run_url.split('/').at(-1)),
    artifact, raw_zip_purged: true, manifest_sha256: '7'.repeat(64), producer_metadata_sha256: '8'.repeat(64),
    apk_sha256: metadata.built_artifact.sha256, apk_size_bytes: 12000,
    producer_build: { command: ['./gradlew', ':app:assembleDevelopmentDebug', '--no-daemon', '--max-workers=2',
      '-PreactNativeArchitectures=x86_64', '-Pandroid.buildOnlyTargetAbi=true', '-Pandroid.injected.build.abi=x86_64',
      '-Pandroid.injected.testOnly=false', '-Pandroid.injected.apk.location=/runner/app/android/app/build/outputs/apk', '--info', '--console=plain'],
      label: 'Build debug-key-only development APK', exit_code: 0, timeout_seconds: 3000, duration_seconds: 20 } };
  return { id: artifact.id, name: artifact.name, digest: 'sha256:' + artifact.sha256, size_in_bytes: artifact.size_bytes,
    expired: false, workflow_run: { id: request.runId, head_sha: request.sourceSha,
      repository_id: profile.repositoryId, head_repository_id: profile.repositoryId } };
}
module.exports = { attach };
