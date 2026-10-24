# Optional original-startup failure receipt

This offline diagnostic preparation starts from frozen source
`1bc34890cb8618b2fffd446a63924974e0fe15b5`. It implements no credential,
navigation, dependency, signing, simulator-service or acceptance correction.
The app-source changes add observability only; the original failure behavior stays.
It has not run on hosted iOS or Android. The original native source remains unchanged. Its run completed naturally;
this observer has not run on a native candidate. Actual future native status is required before proposing
a correction.

The1bc iOS receipt contains the fixed credential-error and Retry public flags.
Its guarded Splash catch covers both `hasPin` and navigation. The native
Keychain status was not retained. Historical source
`d865ca9c4f91532a1524443cc6da42d8d7b07e1a` swallowed every `hasPin` exception and
returnedfalse; its CreatePin pass did not establish a successful Keychain read.
RNKeychain10.0.0's original query rejects status other than0/-25300 with a
decimal-string `error.code`, and performs no library error logging. A successful
false return is not proof of exact-25300.

## Original failure boundaries

`hasPin` accepts an optional second callback. Existing callers retain their
arguments and legacy false-on-error behavior. Startup registers the observer;
its original native query, service choice, call count, return and original thrown
error are retained. No extra read, write, reset or Retry is introduced. Failures
are classified only where they occur:

- `ACCOUNT_STATE`: Redux/account selection throws.
- `NATIVE_CREDENTIAL_READ`: a synchronous call throws, or its original awaited
  result rejects. Only the latter may retain a canonical ASCII decimal signed
  int32 `error.code`; other code values remainnull.
- `CREDENTIAL_JSON`: credential-property access or JSON parsing throws.
- `NAVIGATION`: the existing Login/CreatePin navigation call throws, after a
  completed credential decision. This separate catch prevents attributing a
  navigation error to a native read or duplicating its failure receipt.

The callback receives fixed phase/outcome/error-name values and the optional
numeric code. It never receives an error object, message, stack, service,
username, password, account identifier or credential value. Error getters and
observer failures are contained; no observer means no error-property inspection.
Only failures emit markers. Successful and empty reads emit nothing, and a
missing marker does not establish that a read succeeded.

## Source-supported transport, not hosted proof

The development-only sink checks `__DEV__` and the direct
`global.nativeLoggingHook`, then emits a fixed Error-level3 marker. It does not
call `console.log`, `console.error`, ExceptionsManager or LogBox. Missing hooks,
invalid clock/receipt data and sink failures are quietly ignored. The public
epoch milliseconds are used solely to relate a receipt to the original Maestro
command's capture window; neither that value nor raw log content is exported.
This relation uses the simulator and host's shared Unix-epoch clock convention,
not a performance measurement or an inferred compact-log timezone. Missing,
invalid or outside-window relations remain unknown; multiple own PIDs or markers
prevent selecting one unambiguous failure.

Pinned React Native0.83.9 source establishes the path:

- js-polyfills `console.js` uses level1 for log/info and3 for error; its
  `console.error` wrapper can invoke ExceptionsManager/LogBox.
- `RCTInstance.mm:452` binds `nativeLoggingHook` to
  `_RCTLogJavaScriptInternal`; `RCTLog.mm:328` calls the configured log function.
- `RCTLog.mm:74` maps level3 to `OS_LOG_TYPE_ERROR`; the default function at107
  uses `os_log_with_type` with public fixed text, subsystem
  `com.facebook.react.log` and category `javascript`. The app has no custom
  logging override. This direct path bypasses the console-error wrapper.

RN tarball SHA1: `61d2a4ccd89e06b98992c9b9781856ad88a09d39`;
`RCTLog.mm` SHA256:
`a72a020e0047026a8b6710fb3942fc638a7b87bda1f78f06655598793b5e97a7`.
The separate js-polyfills0.83.9 tarball SHA1 is
`8178d55abcb6ffdf3b4afe69ea4dc76051e43408`; `console.js` SHA256:
`3446f28d3f79e91ed37f40f56faf520fc9f914e30566879b4605db05cacfa9f2`.
Both tarballs matched the frozen lock's SHA512 integrity. These are source facts;
actual hosted transport remains NOT RUN.

## Existing collection only

The reconciled own-process compact `log show` query retains #7129's --info
option, last10m selection, predicate and25s deadline. There is no new query. Its already validated records feed a pure bounded
collector. The marker's epoch is compared with the capture start immediately
before the original Maestro command and the end before failure collection.
Compact timestamps are not guessed into a timezone. Exact marker messages and
the fixed React JavaScript subsystem/category prefix are recognized grammar;
other framing stays unknown. This grammar is not a claim about an observed
hosted renderer.

The optional `startup_failure_receipt` exports at most32 fixed records and
bounded counts. Missing/malformed/partial input, missing or invalid windows,
outside-window markers, foreign processes, multiple own PIDs, duplicates and
limits remain explicit UNKNOWN/AMBIGUOUS states. Process and timestamp values,
raw text and marker epochs are not exported. Import/collector/query failure
leaves UNKNOWN and preserves the original startup failure. Rendered log markers
are observations, not authenticated provenance or failure-cause proof.

No acceptance predicate consumes this optional receipt. App selectors, actions,
deadlines, installed-byte requirements and all cleanup remain unchanged. Current
#7068 head `4bef0b78581ccaf4acc89053d3c7d30b04fa1338` has no `src`, iOS, Android,
dependency or patch delta from1bc and supplies no observed Keychain/PIN fix.

## Reconciliation with #7129

The separately reviewed full-ancestry child selects this one direct hook and
removes the earlier console.info helper. It adds #7129's current-attempt guard
to suppress late callbacks after unmount. Its canonical pure compact parser
remains the single framing/category implementation and feeds this collector;
the older inline parser is not restored. Source controls from both producers
remain, adapted to the selected V1 grammar. See [the current source contract](r5/STARTUP-FAILURE-BOUNDARIES.md).
