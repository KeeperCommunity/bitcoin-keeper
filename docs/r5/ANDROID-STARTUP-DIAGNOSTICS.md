# Android startup fault identity

The frozen 3f4e8127e3698accd3760a4a039448964a5285a4 diagnostic
40085793409/attempt1 built the app but failed the first Create-passcode
assertion. Its retained Metro observations showed an actual-app bundle request,
build completion and outer HTTP 200, followed by a successful symbolication
request. The original error identity was not retained. The Skip experiment did
not run, and the app's startup cause remains unknown.

This correction uses the existing runner, Metro configuration, emulator and
startup flow. It adds no artifact-reader workflow. The standard CLI
--client-logs switch is used only for the ordinary startup entrypoint; the
pinned CLI otherwise disables forwarding. Source-executing controls show that
this switch only forwards existing HMR console events to the reporter.
Resolver, transformer, serializer, entrypoint, app inputs, native dependencies,
credentials, deadlines and acceptance requirements stay unchanged.

The existing reporter now observes client_log and unstable_server_log
without changing the original TerminalReporter call or return value. It exports
only closed error/code/module identities, counts, coverage and source
coordinates. At most sixteen data items and 8,192 characters per message or
data-only stack field are inspected. Payload getters and coercion hooks are not
called. Unknown types, messages and source locations stay unclassified. An
accessor-backed Error stack is intentionally not read.

The existing /symbolicate middleware also projects the actual pinned Metro
response's source frames. The producer was checked against Metro 0.83.6:
stack[*].file is the original graph module path, lineNumber is one-based and
column is zero-based. Exported columns are normalized to one-based values.
Only seventeen declared first-party startup paths, exact repository-relative
or exact current-checkout absolute paths, are admitted. Foreign paths, URL
paths, traversal, method names, code frames and arbitrary stack text are never
exported. Coordinates must fit the current public source and its UTF-16 line
width.

Symbolication capture copies at most 256 KiB of application response writes
and inspects at most sixty-four frames, exporting at most eight distinct public
coordinates. HTTP status, UTF-8, JSON shape, depth, node count, source namespace
and coverage are checked. Buffers are cleared on finish, close or writer failure.
The original bytes, headers, callback arguments, receiver, return values and
backpressure are preserved. The pinned CLI installs compression before the
enhanced Metro handler, so the observer sees application JSON before compression;
a real gzip HTTP control verifies unchanged compressed wire content while
retaining the public source frame. An already encoded response at observer entry
remains unsupported.

The Python collector independently regenerates both new row types from closed
vocabularies, source coordinates and bounded counts. Host launch-window timing
does not prove that an event belongs to the app or that it caused startup
failure. Missing, rejected, incomplete, unknown or capped observations never
establish absence, successful JavaScript evaluation or native acceptance.

Controls execute the pinned React Native registry, CLI logger/HMR forwarding,
Metro symbolicator and compression middleware with synthetic errors. A real
Node HTTP streaming control checks response preservation. These are host-side
controls, not mobile passes. The exact old reporter's missing-runtime-receipt
failure is retained separately. Source-replay cases explicitly skip if mobile
dependencies are unavailable; they are run with the frozen dependency graph for
the source review.

A new native run requires coordinator selection of the reviewed exact head.
The original failed native run remains failed. R4, R5 integration, private
security proposals, canonical/full acceptance, signing and distribution are
separate. No production fix is asserted by this diagnostic correction.
