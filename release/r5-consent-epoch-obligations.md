# Later consent-off invalidates every original operation

This private test-only slice ports the original later-consent-off case across
all seven operations. The existing updateAppImage representative omits original
pending/completed assertions; other operation variants remain distinct. Exact
legacy IDs and prior dispositions are in `r5-consent-epoch-obligations.json`.

A genuine local receipt is prepared from a fully verified original protected
copy. The real Redux consent-off action must positively advance its original
consent epoch. The original operation and explicit replay then send zero HTTP,
including no snapshot, enrollment, mutation or repair. Explicit Delete preparation
is completed before revocation; that old Delete receipt must also respect the
newer choice. This is not a new explicit Delete requested after opt-out.

All original pending/nonverified/completed flags and saved consent false remain.
Complete committed local image/account and retained recovery data survive, and
a real signed read proves the full remote image remains unchanged and present.
Only test/map/docs files are added; native Realm, production queue/observers,
cryptography, server protocol, app versions and dependencies are unchanged.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedConsentEpochGrid.proof.cjs
```

Require exactly seven actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks confer no product runtime pass. Historical public2 PASS /293 FAIL
is unchanged; other fault/producer obligations remain separate.
