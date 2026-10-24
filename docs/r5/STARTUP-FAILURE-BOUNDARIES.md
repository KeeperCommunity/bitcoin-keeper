# Reconciled startup failure observations

This source-only reconciliation preserves the full ancestry of [#7129](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7129)
(`cd9d50a80bdd9035b532604bd10bcfeb21fe484e`) and [#7131](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7131)
(`e34331083959c94b5f0a17603d8c1f578305c474`). It selects one development-only
direct `nativeLoggingHook` emitter and retains the current-attempt/unmount guard.
App package A is `04be52e61569b88597ccc24504993247cd33ac48` on the fixed
mechanical join `4b6cabc55a82d4f9d200a97db137202d01236e82` (tree exactly #7129).
This successor B exposes the canonical collector bridge separately. Both packages
retain explicit full new-source and cumulative size estimates in their handoffs.
It replaces the earlier console.info marker; the two emitters never run together.
The original producer branches and their review evidence remain unchanged.

The exact `1bc34890cb8618b2fffd446a63924974e0fe15b5` iOS window built and
installed successfully, then failed its first Create a passcode assertion.
[The pinned artifact readout](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7123)
found credential-error and Retry flags in one retained snapshot. The flags do
not establish the current route, tap delivery or failure cause. Its 616
own-process error records contain 18 CONNECTION markers and 598 unclassified
records. No native Keychain status was retained. These observations cannot be
transferred to this new source or the combined candidate.

The original Splash catch spans both `hasPin` and navigation. `hasPin` spans
Redux/account selection, native credential reading and JSON parsing. Empty
fresh credentials ordinarily resolve false and select CreatePin. No Keychain,
entitlement, SDK or navigation cause has been established. This package makes
those original failure boundaries observable; it supplies no app correction.

`hasPin` accepts an optional second callback. It receives only a fixed phase,
THREW/REJECTED outcome, whitelisted error name and optional numeric code. Only a
native-read rejection may retain a canonical ASCII decimal-string signed int32
code. Guarded property access never forwards the original error, message, stack,
credential, account/service identifier or native response. Original rejection
identity and legacy false-on-error behavior survive observer faults. No callback
means no error-property inspection.

A current development attempt emits at most one direct Error-level3 hook call
for its failure. It calls no console or LogBox wrapper. For example:

```text
KEEPER_STARTUP_FAILURE_V1|1500|NATIVE_CREDENTIAL_READ|REJECTED|Error|-34018
```

This is illustrative grammar, not an observed native status. Production startup
supplies no observer. Abandoned attempts emit nothing. Existing modal, Retry,
read count, service selection, success navigation and cleanup behavior remain.
Navigation exceptions have their own fixed phase after the original read.

The existing canonical pure compact-log parser validates framing and exact own
executable attribution. It retains its generic category/count contracts and
feeds already validated fields to #7131's pure bounded receipt collector. A
complete standalone V1 marker, optionally preceded by exactly
`[com.facebook.react.log:javascript] `, is supported. Other framing cannot supply
one observed receipt. The collector relates its bounded epoch to the original
startup command's start and failure-collection end; raw epoch, timestamps, PID,
process and message are never exported. Missing/invalid windows, partial input,
foreign processes, duplicate markers, multiple own PIDs and limits stay explicit
UNKNOWN/AMBIGUOUS. At most32 fixed records are retained. Rendered markers are
observations, not authenticated provenance, a failure cause or acceptance.

The same own-process log query keeps --info, its last10m selection, predicate
and25s deadline. There is no additional query, SDK/configuration/selector change,
new native operation or acceptance-predicate relaxation. Pinned RN0.83.9 source
supports the direct Error sink and fixed React prefix; actual marker visibility
on hosted native remains UNVERIFIED. No native run has exercised this source.

App source controls cover original results/errors, hostile getters, observer and
sink faults, production silence, Retry/navigation and late unmount. Pure parser,
collector and fake-query controls cover exact envelopes, window/PID ambiguity,
bounds and privacy. These tests do not establish native feature, backend,
physical-device or release acceptance. No personal Mac or release operation is
required by this source preparation. See [the transport source record](../r5-startup-credential-failure-observation.md)
for the original #7131 source analysis.
