# Disposable Android startup boundaries

The exact `5bb116a530a4f6ebabd85bb3cbed62947c5c028d` Android build and installed
bytes passed in run `40161613081`, job `121074185388`. Startup then failed waiting
for `Create a passcode`. The app process was alive and resumed, but the retained
fixed snapshot did not identify its route or the startup boundary reached.
Persistence, workers, first-wallet and Skip measurements did not run. This
package adds observations to answer that remaining question; it does not claim
an application fix or native acceptance.

The app-owned helper emits at most one record for each of twenty fixed stages
per JavaScript boot. It is disabled outside Android development builds.
Production and iOS return the original children without the observer wrapper.
The pinned RN 0.83.9 new-architecture logger installs `nativeLoggingHook` through
`JReactInstance.cpp`; `JSLogging.cpp` maps level 1 to Android INFO. Positive
startup witnesses use that level rather than creating application error logs.

| Witness | Meaning and limit |
| --- | --- |
| Entry ready / registered | Imports finished, then existing setup and component registration returned. No calls are reordered. |
| Root wrapper / App rendered | These actual functions were invoked. They do not prove a committed tree. |
| App committed | Its existing mount effect ran after PersistGate released it. |
| SafeArea child rendered / committed | Its actual provider released children; the separate committed witness distinguishes a later descendant render failure. |
| HCE wrapper / child rendered / committed | Brackets the existing provider. No extra HCE call, method replacement, Promise handler or fallback is introduced. |
| Navigator / Splash committed | Those components committed; this does not prove window visibility. |
| Credential entered / resolved / rejected | Brackets the existing single probe. No result, error, account identifier or credential is logged. |
| Route replacement entered / returned / threw | Brackets the existing call; returning does not establish a visible route. |
| CreatePin committed / Splash unmounted | Component lifecycle facts only. |

The reserved prefix contains only version and stage enums. No payload, wall
clock, duration, route parameters, native values, credentials or arbitrary error
text is accepted. Missing events stay UNKNOWN. Render witnesses deliberately
record attempts, including attempts that a descendant error later aborts; they
must not be reported as commits or visible screens.

The existing failure-only Android collector reads the reserved prefix in one
additional bounded logcat query, using the existing fifteen-second capture
timeout and at most forty-one matching records. The pure parser accepts at most
forty, binds records to current owned process IDs, retains positive observations
only, and exports neither process IDs nor guest timestamps. Its raw query files
are deleted by existing capture cleanup. Existing UI waits, retries, route and
provider behavior, native/dependency inputs, artifact limits and release guards
are unchanged. The existing fixed failure remains the failure being reported.

The same package corrects one diagnostic classification: RN's warnings about a
non-null NativeEventEmitter argument lacking listener methods do not establish
a null module. Actual pinned constructor controls retain the genuine iOS
non-null-argument invariant classification and leave the Android null argument
behavior intact. No HCE or startup cause is inferred from those warnings.

The React/provider, entrypoint, credential and native-emitter controls run in
the existing Tests job after its frozen patched dependency installation. Pure
receipt/ownership/privacy controls run through the existing Python contract
discovery. They establish source and observation behavior, not Android app
execution. A separately selected exact-source native run is still required.
