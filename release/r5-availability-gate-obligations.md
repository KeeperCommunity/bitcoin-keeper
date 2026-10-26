# Original availability and endpoint boundaries

This private test-only slice covers original197–201, all UNCOVERED in the
baseline map. It runs actual production receipt/queue/endpoint code with genuine
encrypted Realm, crypto and the reviewed private transactional backend.

The original hosted-target assertion required zero writes in the local fixture
trace and full pending state. That trace alone could not prove zero external
I/O. Current compiled source and both hosted flags intentionally permit HTTPS
attempts. This suite preserves those flags, proves the fixture loopback regex
cannot match the hosted URL, and requires the actual eligible signed snapshot
attempt to reach a controlled RestClient boundary. That boundary throws before
calling the original transport for any non-owned origin; it delegates exact
arguments, receiver and returned Promise only for the owned loopback origin.
No external hosted request or fabricated response occurs. Local and actual
remote full images remain unchanged; the consumed receipt cannot replay.

For the four native/endpoint combinations, BOTH real fixture override variables
are absent during the actual operation, then their precise previous
presence/value is restored. Valid development loopback must execute one real
CAS and full signed readback with original and returned tuple assertions,
complete local/remote match and verified/nonpending/completed/consent flags.
Production HTTP, disabled-development HTTP and a missing explicit port must
reject before RestClient is called. They preserve the complete native account,
original remote image, consent and all original pending assertions; old receipt
replay sends zero additional HTTP. Config, environment and transport hooks have
owned finally cleanup. No production, fixture, protocol, KDF or dependency
changes are included.

On the existing fixed private genuine host (Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned Mongo27038):

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedAvailabilityGateGrid.proof.cjs
```

Require exactly five actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
app/tree, backend/controller/raw-source fences and owned cleanup. Source review
and offline controls grant no runtime pass. These endpoint checks do not attest
a live hosted backend or Android/iOS execution. Historical public2 PASS /293 FAIL
remains unchanged until complete equivalent coverage is accepted separately.
