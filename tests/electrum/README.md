# Private R5.2 Electrum verification

Run after the frozen dependency installation and `patch-package`:

```sh
node --test tests/electrum/*.test.cjs
npx jest --runInBand tests/services/tls-adapter.test.ts tests/services/electrumConnectionGeneration.test.ts tests/services/networkFailover.test.ts
```

The Node tests require OpenSSL, a C11 compiler with AddressSanitizer/UBSan, and a
JDK (`java` and `javac`, or `JAVA`/`JAVAC` executable paths). `RN_TLS_PACKAGE` and
`ELECTRUM_PACKAGE` can select an explicit extracted dependency for private review.
Ordinary execution uses the installed and patched packages. Missing prerequisites
fail the test; essential trust cases are never silently skipped.

`tls-native.test.cjs` compiles the actual dependency Java socket, certificate
helper and trust policy. It stubs Android resources and React Native bridge/events
only. Handshakes run with real JDK TLS against disposable loopback servers. This
proves Java source/provider behavior and is **not Android runtime acceptance**.
The fixture process installs its own temporary trust store; it never changes
system, application or shared environment trust.

`certificate-policy.test.cjs` compiles the actual iOS DER policy header with
sanitizers and checks validity boundaries, malformed dates/DER, expired anchors,
and SPKI extraction against OpenSSL. It does **not execute Security.framework**.
`tls-rpc.test.cjs` runs the real adapter and pinned Electrum client through a
Node TLS bridge for reconnect, peer trust separation, minimal header/UTXO/history
sync, fee and fake broadcast RPC. No transaction or remote node is used.

All private fixture keys and certificates are generated in a temporary directory
and deleted. The committed `public-trust` fixtures contain only three withdrawn
public root certificates and eight compromised **public** keys. Their manifests
record immutable primary provenance and hashes. Public SPKI test certificates are
signed using the disposable fixture CA; no exposed private key is acquired or
used. These tests check rejection policy without constructing a live counterfeit
chain signed by a compromised key.

For the separately recorded old-failure demonstration, run only the Java test
against the integrity-verified original 6.4.1 package with `LEGACY_TLS_REPRO=1`.
That mode expects the insecure old caller to accept invalid peers and the old
native chain-only path to accept a wrong hostname; it is not an acceptance gate.

Required platform follow-up: Android runtime bridge/handshake and app compile,
iOS app compile plus Security.framework chain/hostname/custom-anchor and
withdrawn-root/SPKI rejection. Use disposable loopback identities from this
fixture generator. In particular, execute expired explicit self-signed leaf and
expired configured CA-anchor cases on iOS. Preserve the selected onion transport
and private-node failure behavior in application smoke checks. Report exact SHAs.
