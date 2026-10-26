# After-send A to B to A with two genuine recovery identities

This private test-only slice ports original legacy173–179: three PARTIAL and
four UNCOVERED operation cases. Existing early queued invalidation and simple
account-switch cases do not establish distinct-key B native/remote recovery or
preservation of every account's UI flags while an old real ACK is outstanding.

Each A operation uses a genuine committed receipt and real signed transactional
CAS. Its original positive ACK is held. While it remains unsettled, selection
moves to a separate encrypted Realm for account B, using a second valid public
disposable mnemonic, its actual64-byte bip39 seed and original sha256(seed) ID.
B receives its own real protected enrollment, full encrypted backup and current
UI proof; a signed read must completely match its native image. No fabricated
baseline or backend seed substitutes that independent B setup.

After returning to A, capture every per-account ByAppId flag and the action
boundary before releasing old ACK. Its completion cannot confirm, change either
account's new-session UI flags, dispatch a final verification or opt A out for
Delete. Every committed native A record and complete KeeperApp must remain.
A's actual remote effect is read back, while B's entire ciphertext/tuple and
native image/account must remain unchanged. An explicit old A receipt replay
sends zero further HTTP. The held original writing is released/drained in
finally. Original pending/completed and new-session consent assertions remain.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedAfterSendSessionGrid.proof.cjs
```

Require exactly seven actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks grant no genuine runtime pass. No production, KDF, protocol,
dependency, version or counter changes are included. Historical public2 PASS /
293 FAIL remains unchanged; other fault combinations are separate obligations.
