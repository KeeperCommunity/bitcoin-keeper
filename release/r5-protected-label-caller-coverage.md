# Signed-v3 label caller coverage

This additive package maps the nine original cases in
`tests/recovery/automaticLabelProducers.integration.cjs` to current production
behavior. It is based on completed caller-port PR #7091 at
`b572b28c9cec09e47e1b9cb3b62a51369dd74c51`. That checkpoint's 32 genuine
queue/bootstrap passes retain their own attribution; this package does not rerun
or transfer them. The original nine-suite 295-case lane, fixture pin, census and
recorded 2 PASS / 293 FAIL remain unchanged and unresolved.

| Original case | Additive `protectedLabelProducers.proof.cjs` obligation |
| --- | --- |
| Add/import/edit | Actual dispatched workers each commit one `modifyLabels` using their own original namespace/revision/generation/authEpoch tuple; edit removes the old label and preserves imported peers; complete decrypted readback |
| Grouped send labels | Actual send-label delegation commits the transaction note, Change and inherited input labels in one local transaction and one signed CAS |
| Invalid second import | Actual native Realm validation rolls back the first insertion, leaves the entire image unchanged and sends no HTTP |
| Manual coin choice | Actual wallet worker persists `doNotSpend` and `isManualOverride` before HTTP; complete encrypted wallet readback and actual encrypted Realm close/reopen retain the choice |
| Send conflict | A competing signed peer CAS commits after the original signed snapshot; the caller receives a real 409, preserves local labels and remote peer data, invalidates authority and does not retry |
| Send missing namespace | Bounded storage-loss injection removes only the selected namespace from this case's owned disposable database after its genuine snapshot; the actual service returns 404; local labels survive with no implicit enrollment/recreation |
| Send malformed reply | Corrupt a genuinely committed CAS response into invalid JSON; local labels and actual remote commit survive, but no Verified or reusable authority follows |
| Send lost reply | Drop the genuinely committed response; local labels and actual remote commit survive, but the caller remains pending and does not resubmit |
| Old session | A real A→B→A account cycle rejects the original send-label session before local commit or any HTTP |

The missing-namespace fault is not protected-copy Delete. Current Delete creates
a tombstone and retains its defined older-copy behavior; no deletion protocol is
replaced with a legacy 404 expectation. Faults never fabricate a successful
backup response. Each case owns a fresh router and actual admission buckets.

All production backup algorithms, workers, runtime-branded local receipts,
opt-in/authority, encrypted Realm, signed HTTP and transactional backend remain
real. Public descriptor formatting for an intentionally unspendable synthetic
xpub is the label metadata boundary stub. The fixture's existing MMKV/UI
boundaries remain host adapters. This does not sign/broadcast Bitcoin, render
native UI, prove MMKV or physical-device behavior, or grant release readiness.

Run only this new file with the existing current-backend admission preload:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedLabelProducers.proof.cjs
```

Prerequisites remain Node 22.23.3+ within 22.x, the exact separately obtained
Relay `29597b27eeeb299205bf7d0555db0a90c38cc4be` and frozen dependency inputs,
the actual Realm N-API binding, and a credential-free owned disposable keeperQA
Mongo replica at loopback port 27038. Do not substitute a public-v2 adapter,
mock successful storage, weaken dependency integrity or contact production.

Preparation checks: Node syntax, whitespace and the three existing runtime,
Mongo-target and backend-identity negative controls PASS. Independent source
review caught an origin argument missing from the fixture's action-creator call;
it now passes the actual selected app ID, matching production callers, while
retaining middleware/session/intent assertions. Genuine execution is NOT RUN at
this preparation checkpoint because the local Realm N-API binding is absent.
A separate exact-head private hosted control is being prepared for review.

These nine mapped candidates would leave 254 of the original 295 obligations
outside the 32 earlier ports and this package. That is a source census, not an
executed replacement-matrix count. The public CI migration remains incomplete
until reviewed current-protocol coverage is executed and failures dispositioned.
Keep native, physical, deployed-backend and release evidence separate. No merge,
production mutation, distribution or personal Mac work is part of this package.
