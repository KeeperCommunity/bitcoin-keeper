'use strict';
// Invoke only inside the pinned github-script SDK. The SDK receives a disposable
// identity and controlled fetch; the global/default network route stays disabled.
const assert = require('node:assert/strict');
const { fixture, gateFixture } = require('./current-release-origin.cjs');
module.exports = async function runCurrentOriginSDK(Octokit) {
  const cases = [];
  for (const kind of ['complete-source', 'known-high-8.1', 'security-api-403', 'late-pin-revoked',
    'late-required-producer-failed', 'same-process-gate', 'late-owner-permission-revoked']) {
    const gated = ['same-process-gate', 'late-owner-permission-revoked'].includes(kind);
    const f = gated ? gateFixture({ Octokit }) : fixture({ Octokit });
    try {
      if (kind === 'known-high-8.1') f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = '8.1';
      if (kind === 'security-api-403') f.onApi = url => {
        if (url.pathname.includes('/code-scanning/')) f.transportStatus = 403;
      };
      if (kind === 'late-pin-revoked') f.onApi = url => {
        if (url.pathname.includes('/code-scanning/')) f.p.pin.value = '';
      };
      if (kind === 'late-required-producer-failed') {
        let reads = 0;
        f.onApi = url => { if (url.pathname.endsWith('/actions/runs/200') && ++reads === 2) f.runs[200].conclusion = 'failure'; };
      }
      if (kind === 'late-owner-permission-revoked') f.onApi = url => {
        if (url.pathname.includes('/code-scanning/')) f.permission.permission = 'read';
      };
      if (kind === 'complete-source') {
        const proof = await f.collect();
        assert(f.driver.isCurrentReleaseOrigin(proof, f.request));
        assert.equal(proof.canonical_cases, 7);
        assert.equal(proof.security.direct_analysis_result_binding_verified, true);
        assert.equal(proof.security.gas_analysis_join_verified, false);
        assert.equal(proof.execution_allowed, false);
      } else if (kind === 'same-process-gate') {
        const evidence = await f.collectGate(), plan = f.validate(evidence);
        assert.equal(plan.state, 'PROTECTED_OPERATION_INPUTS_VERIFIED'); assert.equal(plan.execution_allowed, false);
      } else {
        const expected = { 'known-high-8.1': /RELEASE_ORIGIN_SECURITY_POLICY_FAILED/,
          'security-api-403': /RELEASE_ORIGIN_API_UNAVAILABLE/,
          'late-pin-revoked': /RELEASE_ORIGIN_UNVERIFIED/,
          'late-required-producer-failed': /RELEASE_ORIGIN_RUN_INVALID/,
          'late-owner-permission-revoked': /APPROVAL_OR_PROTECTION_CHANGED/ }[kind];
        await assert.rejects(gated ? f.collectGate() : f.collect(), expected);
      }
      cases.push({ case: kind, result: 'PASS', source_calls: f.calls.length });
    } finally { if (gated) f.cleanup(); }
  }
  return { node: process.version, actual_pinned_sdk: true, cases,
    real_service_requests: 0, real_credentials: false, native_or_provider_operations: 0 };
};
