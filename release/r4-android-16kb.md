# R4 Android 16 KB supplier correction and Local retest

15 October 2026. State: **NEEDS_LOCAL / NOT RELEASE-READY**. This is a targeted
continuation of [#7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045),
preserving `698078e1765d1e0728145f0ef6def05195192b30`. The newest PR **Codex local
handoff** names the full final SHA; this file cannot contain its own eventual SHA.
Read [AGENTS.md](../AGENTS.md), the [complete native handoff](r4-automatic-backup-local-handoff.md)
and [backup matrix](../openspec/changes/fix-recovery-backup-freshness/automatic-write-validation.md).

## Failure and supplier identity

The [retained exact-698 Local report](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6178691569)
records developmentDebug 2.6.4(627), package `io.hexawallet.keeper.development`, APK
SHA256 `8d73e790f9b47766c92e927d7fe8425ad4967cfe44607cf35312cbb87e469af8`.
A genuinely fresh Android17/API37 arm64 emulator reported `PAGE_SIZE=16384`.
Default launch reached Create Passcode and initialized MMKV files. After enabling
the official strict properties on that new emulator only, relaunch aborted:

```text
lib/arm64-v8a/libjnidispatch.so program alignment (8192) cannot be smaller than system page size (16384)
Fatal signal 6 (SIGABRT)
```

The failing library's LOAD `p_align=0x10000` and STORED ZIP data offset `48709632`
both pass their respective alignment checks. Its GNU_RELRO end is `0x36000`,
with remainder `0x2000` modulo 16 KB. This is not a failed LOAD or ZIP check.

Cloud downloaded official Maven Central AARs and reproduced the reported library
identity without accessing any Mac-local artifact:

| Bytes | SHA256 |
| --- | --- |
| [Official JNA 5.14.0 AAR](https://repo.maven.apache.org/maven2/net/java/dev/jna/jna/5.14.0/jna-5.14.0.aar) | `81a8b9afc65f9d6b205338c25908af8de0ff8411a00985104c9d83fffdfab380` |
| Its raw arm64 library, 168176 bytes | `3730ce014f7a6807ae74af78c3b9f5a3cba1f5886316b3d3858493df923efe96` |
| Same library after LLVM 19.1.7 `llvm-strip --strip-unneeded`, 157720 bytes | `fe9c603f2a7a5d19197b87f275d6e0afb975f997a57ff4f8ca801cb8c5e7b731` |
| [Selected JNA 5.18.1 AAR](https://repo.maven.apache.org/maven2/net/java/dev/jna/jna/5.18.1/jna-5.18.1.aar) | `7f053e3ec99e14dd71259c82c1c8a02738d64a13c31226b2acc170f3060951e0` |
| Selected raw arm64 library | `abc26e994517bcaa3309acdb0a27373864086c7569c89d3087b8626fada9ef06` |

Maven's published SHA1 sidecars independently matched 5.14.0 and 5.18.1 downloads
(`17b4b6c99bdc5586644d7f97fca4dd84d8889fb0` and
`8e93d068c4eab70ada4c79e010198a112aa3c581`). Local separately reproduced the
same 5.14.0 packaged hash with its trusted NDK27.1 strip tool. The new supplier
arm64 library has LOAD alignment `0x4000` and RELRO end `0x2c000`, remainder zero.
LLVM 19.1.7 stripping of the new arm64 library yields
`ddfc6c965bbe366615c000ec1f06552ddf0bb2b4f9d921d0bff8c75b3cb2ca4c`;
verify the actual build transformation rather than assuming this future APK hash.

## Narrow dependency change

The pinned [Portal bridge](https://github.com/bithyve/libportal-react-native/blob/2ff681b0b725009768acadb35b2731fb1a402fa3/android/build.gradle#L99)
declares `implementation "net.java.dev.jna:jna:5.14.0@aar"` without a debug-only
condition. Its Git pin is unchanged in `package.json` and `yarn.lock`. The app
retains arm64 for both flavors and excludes only x86_64 `libjnidispatch.so`.
This establishes production dependency/packaging input risk. It does not prove
the contents or behavior of an unbuilt signed production AAB or generated split.

An app-level strict `implementation('net.java.dev.jna:jna:5.18.1@aar')` selects
one matched Java/native artifact for every app variant. No Portal source, native
library exclusion, compatibility switch, app-wide linker flag or readiness gate
is changed. A version conflict fails resolution instead of silently selecting
another version.

The version is based on upstream fixes and actual binaries:

| JNA | arm64 LOAD alignment | arm64 RELRO end | Result |
| --- | --- | --- | --- |
| 5.14.0 / 5.15.0 | 0x10000 | 0x36000 | FAIL, effective program alignment 8192 |
| 5.16.0 | 0x4000 | 0x2a000 | FAIL, effective program alignment 8192 |
| 5.17.0 | 0x4000 | 0x2c000 | First fixed native binary |
| 5.18.0 / 5.18.1 / 5.19.0 / 5.19.1 | 0x4000 | 0x2c000 | Same fixed arm64 native bytes |

[JNA #1654](https://github.com/java-native-access/jna/pull/1654), commit
`5305913155092d793f806f51f3c3e0e85869c4da`, adds `common-page-size=16384`, rebuilds
natives and advances native ABI 7.0.3 to 7.0.4. Replacing only the `.so` would
break the matched supplier relationship. 5.18.0 fixes the Structure constructor
deadlock introduced in 5.16 ([#1681](https://github.com/java-native-access/jna/issues/1681));
5.18.1 fixes the concurrent `sortFields` race reported by Android UniFFI
([#1686](https://github.com/java-native-access/jna/issues/1686)). Portal uses
concurrent UniFFI calls and nested JNA Structures. Thus 5.18.1 is the minimum
selected line including those relevant managed fixes, rather than the earliest
native-only fix. These races were not reproduced in Keeper. Static classfile
inspection found all 19 explicit Portal JNA member references in the selected
classes, with matching names/descriptors; this is not runtime compatibility proof.

A resolution-only Gradle 8.14.3 project with the actual Portal declaration and
the app's strict declaration passed three tasks: original 5.14.0 baseline,
single 5.18.1 AAR on app compile/runtime paths with the transitive 5.14 request
upgraded, and rejection of an incompatible strict 5.19.1 request. The resolved
5.18.1 AAR matches the supplier SHA above. This harness is not an actual AGP
developmentDebug or productionRelease dependency graph; those remain Local checks.

## Static inspection scope

The [official Android guide](https://developer.android.com/guide/practices/page-sizes)
requires ELF, RELRO, packaging and runtime checks separately, and rebuilding or
reimporting affected prebuilts. Repository linker flags cannot change a supplier
prebuilt. The checker models the public Android17 bionic revision
[`06356e41c5ed7b12220b24c05ba4fdb873b126a7`](https://android.googlesource.com/platform/bionic/+/06356e41c5ed7b12220b24c05ba4fdb873b126a7/linker/linker_phdr_16kib_compat.cpp).
For a RELRO that exactly prefixes but does not cover its entire LOAD, that helper
uses the lowest set bit of its end: `lowbit(0x36000)=8192`. This matches the
observed diagnostic. The exact emulator linker revision was not inspected.

The earlier 49/59 nonaligned RELRO ends are retained as a raw observation, not
49 demonstrated strict-mode crashes. A whole-LOAD RELRO is exempt in the
checked Android17 helper. The pinned Portal library has that layout on both
64-bit ABIs and passes the computed program-alignment/overlap checks; its raw
end remainder alone does not justify rebuilding or removing Portal.

`scripts/check-android-16kb.py` separately records each supplied library's SHA,
LOAD alignment/congruence, raw RELRO end, whole-LOAD exception, Android17
effective alignment/LOAD-page overlap and actual APK local-header data offset.
AAR ZIP offsets are not APK evidence. Compressed APK entries report
`NOT_PROVEN` because extraction/manifest behavior is not established. Its PASS
means only the supplied static checks passed, never that Android ran the app.

The [supplier inventory](evidence/r4-android-16kb-suppliers-2026-10-15.json)
records 50 64-bit entries across 13 explicitly downloaded AAR inputs, including
both old/fixed JNA and duplicate debug/release shared runtimes. This is not a
count of retained APK libraries. The 48 entries outside old JNA pass these static
checks. Old JNA arm64 fails effective8192; old JNA x86_64 also fails LOAD4KB but
that ABI's JNA is already excluded by this app. The other inspected inputs are:

| Supplier input | Inspected 64-bit entries | Static result |
| --- | --- | --- |
| React Android0.83.9 debug + release | 10 + 10 | PASS |
| Hermes Android0.14.1 debug + release | 2 + 2 | PASS |
| fbjni0.7.0 | 4 | PASS |
| pdfiumandroid1.0.32 | 4 | PASS |
| Sentry native0.13.3 | 4 | PASS |
| Pinned Portal0.3.4-SNAPSHOT | 2 | PASS, whole-LOAD exception |
| MMKV2.4.0 | 4 | PASS |
| MLKit barcode17.3.0 | 2 | PASS |
| CameraX1.5.0-alpha03 image processing | 2 | PASS |

These are supplier-byte observations. Actual resolved graph selection,
`libc++_shared.so` pick-first identity and source-linked Realm/RN/autolinked
outputs must be inventoried from the rebuilt APK. A static source archive or
repository linker option cannot establish their final ELF layout.

Cloud cannot access the Mac's retained APK or full 59-library scan. Downloading
the existing hosted diagnostic APK was blocked at the signed artifact host with
HTTP403. That older artifact is production-flavor/public-debug-key/placeholder
configuration and is not the reported development APK or a signed production
release. Therefore exact-APK supplier mapping and all packaged/source-linked
libraries remain required; a supplier sample is not a complete APK inventory.

## Actual Cloud checks

- Checker regression suite: PASS 20/20, including failing JNA-style RELRO prefix,
  corrected prefix, whole-LOAD exception, overlapping LOAD pages, malformed ELF,
  APK local-header offsets, duplicate entries and compressed-entry uncertainty.
- Genuine Node22.23.3/native Realm/transactional loopback Relay matrix: PASS
  263/263, zero skips, paired Relay `838049e537e07eb646a2a0393eb969fba43d0739`.
- Recovery: PASS 448/448, zero skips. Jest: PASS 42 suites / 432 tests.
- Release rules: PASS 28 Node and 7 Python tests. Ruby fake-action regressions:
  NOT RUN here, `ruby` unavailable; the combined release command exited127.
- Version consistency: PASS 2.6.4 / Android627 / iOS620, still provisional.
- Release preflight: FAIL; both authenticated store baselines exceed24hours.
- Full TypeScript/lint: NOT RUN for this Android-only dependency change. The
  prior inherited failures remain failures, not new clean results.
- Actual AGP variant graphs, new native build, install, launch, MMKV/Realm,
  Portal/wallet/backup smoke, physical hardware and production AAB/splits:
  **NOT RUN in Cloud**. No Android SDK or interactive emulator is installed here.

The tests above used this source change with the unchanged package/Yarn inputs
and existing dependency caches; the final commit adds this evidence/handoff.
Neither hosted-backup gate nor approved contributor pins changed. The manifest
SHA256 remains `2706b8a1c250c93d4098384201cba0188c667777b8fa2d2fdc5267380e0ccfcc`.

## Exact-head Local continuation

1. Resolve the newest PR handoff and verify its full SHA equals the live head,
   using the safe isolated setup in the complete handoff. Preserve all owner
   apps/data and old test artifacts. Keep Relay `838049e537e07eb646a2a0393eb969fba43d0739`
   separate from the approved contributor stack. No paid/real provider calls.
2. With the source's JDK17/SDK36/NDK27.1 toolchain and disposable `.env.local`,
   capture `:app:dependencyInsight --dependency net.java.dev.jna:jna` for
   `--configuration developmentDebugRuntimeClasspath`,
   `developmentDebugCompileClasspath` and `productionReleaseRuntimeClasspath`.
   Inspect `:libportal-react-native:dependencies` as well. Production graph
   inspection is read-only, not permission to build/sign a production artifact.
   Verify one matched 5.18.1 AAR; retain any standalone Portal compile5.14 edge
   separately from the app's final compile/runtime selection.
3. Build **developmentDebug only** from the exact SHA with the disposable debug
   certificate, for arm64. Record package/version/certificate/APK SHA and SDK/NDK.
   Scan the actual APK and the resolved AAR, including every retained64-bit
   library. Preserve JSON and failed results; do not filter the scan to JNA.

   ```bash
   python3 -B -m unittest scripts/test_check_android_16kb.py
   python3 scripts/check-android-16kb.py /actual/resolved/jna-5.18.1.aar
   python3 scripts/check-android-16kb.py /actual/new-development.apk > /private/evidence/new-apk-16kb.json
   "$ANDROID_SDK_ROOT/build-tools/35.0.0/zipalign" -c -P 16 -v 4 /actual/new-development.apk
   ```

   Attribute every `.so` to resolved Maven/local AAR or actual source-linked
   output, particularly `libc++_shared.so` selected by `pickFirst`. Reconcile the
   earlier59-entry scan and distinguish raw RELRO remainders from strict failures.
   Verify JNA supplier-to-merged/stripped-to-APK byte identity using the actual
   NDK strip transformation. No LOAD-only or AAR-only compatibility claim.
4. Use a **new disposable arm64 Android17/API37 16KB AVD only**. Prove serial/AVD,
   ABI and `adb shell getconf PAGE_SIZE` =16384. Following official guidance,
   set and read back `bionic.linker.16kb.app_compat.enabled=fatal` and
   `pm.16kb.app_compat.disabled=true` on that AVD, before the strict install/launch
   sequence. Never alter the owner's device properties or enable compatibility
   to obtain a pass. Record actual install, force-stop/cold-launch and native
   logs: no SIGABRT, linker alignment error, Java/native mismatch or swallowed
   Portal initialization error. Portal SDK construction is eager; reaching PIN
   alone is not full Portal acceptance. Also retain a normal4KB launch regression.
5. On the strict16KB runtime, actually exercise disposable PIN/onboarding,
   native MMKV creation/cold persistence, encrypted Realm create/read/reopen,
   wallet/vault/import/export and paired-loopback backup opt-in, complete
   readback, automatic local-first mutation, recovery and relevant relaunch
   regressions. Record Portal constructor/native dispatch and available safe
   Portal UI/cancellation separately from unavailable NFC/card signing. Keep
   Android C8/#7056 **parked and failed**; do not restart its fix/retest cycle.
6. Required local checks remain **IOS, ANDROID, HARDWARE**. Rerun relevant iOS
   Debug simulator/PIN/Realm/wallet/backup smoke against the new exact SHA and
   continue other feasible existing native requirements. Do not claim an old
   artifact validates the new SHA. Hardware/NFC/USB tests are NOT RUN unless
   actually performed; a new exact-SHA owner scope decision is needed for any
   physical-only deferral. A locked Mac may permit command-line preparation,
   but unperformed build/install/launch/UI checks remain BLOCKED/NOT RUN.
7. Post an exact-SHA **Codex local validation** comment with hashes, per-library
   static results, strict-property/page-size proof, actual native outcomes and
   every failed/blocked/unrun category. Preserve the698 LOCAL_FAILED evidence.

Android C8 remains a separate known failure. Human review, current Local
acceptance, production backend all-instance/index/transaction/old-writer rollout
proof, fresh store histories and separate Desktop/website deliverables remain
open. Both backup gates and approved contributor manifest stay unchanged.
No merge, deployment, index creation, release signing, AAB/split construction,
upload, publication, customer message or real transaction is authorized here.
Production AAB/split identity and strict runtime verification require a separate
owner-approved artifact stage. R4 stays independent of Reproducibility and
Bitkey Wallet; this source correction is not release readiness.
