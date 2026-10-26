# Actual held HTTP abort across all seven core operations

This private test-only slice ports seven previously uncovered legacy delayed
HTTP cases. `r5-http-abort-obligations.json` preserves their original IDs and
operation boundaries. Existing lost-reply and malformed-ACK controls remain
unchanged; neither establishes actual cancellation of an outstanding HTTP call.

Each case first completes real protected enrollment and verifies its initial
copy. The original operation then commits local data using the actual receipt
and queue. The existing fault proxy holds its real successful backend reply
AFTER the actual transactional CAS commits. The original full positive ACK and
exact tuple must be witnessed; the client must still be waiting at this barrier.

The existing fixture option compresses only setTimeout delays to one second.
Date, source deadlines, real AbortController, Axios, cryptography, native Realm,
backend, protocol and queue are unchanged. Observation wrappers preserve every
original RestClient/transport argument, return and thrown error. Required proof
includes the real signal's abort event, actual Axios CanceledError/ERR_CANCELED,
and the original bounded transport's timeout classification. No fabricated
error, destroyed socket alone or early local rejection can pass these checks.

All original pending/completed assertions remain, with complete local image and
account preservation and saved consent including an uncertain Delete. A real
signed read proves the actual committed remote image or tombstone. Replaying
the consumed receipt must send zero further HTTP, including no enrollment,
read, repair or mutation. Source/static checks confer no genuine runtime pass.

On the existing fixed private genuine host with Node 22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedHttpAbortGrid.proof.cjs
```

Require exactly seven actual PASS and zero FAIL, SKIP, CANCEL or TODO, bound to
the exact app/tree, bundle, backend/controller and raw-source fences. No app,
KDF, protocol, dependency, version or counter changes are included. Historical
2 PASS / 293 FAIL stays unchanged. Remaining identity/fanout/interleave and
other non-ACK fault obligations are separate.
