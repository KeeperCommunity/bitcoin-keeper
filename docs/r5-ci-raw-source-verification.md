# CI tracked source verification

The main CI source guard and its five offline contract callers retain their
existing event-head selection, paired Relay pin, two explicit manual-contract
routes, read-only permissions and source-only schema 1 receipt. The receipt's
keys and scope do not change. It remains source evidence, with no native,
security, backend-compatibility or release acceptance attached to it.

The guard now independently reads the exact commit's complete Git tree and
checks every tracked input against its raw Git blob bytes and Git's owner
execute bit 0100. Git status still rejects staged changes and added nonignored
source; it is no longer the sole check on tracked files. The checker does not
clear index flags, trust a generated manifest, apply text/checkout filters, or
import application code. Read-only Git commands disable optional index writes
and local replacement refs.

Checkout roots and tracked inputs must be literal regular paths. Symlinked
roots, parents or files, committed symlink entries and gitlinks fail closed.
Reads verify the opened regular descriptor still corresponds to the checked
path, including a replacement during reading. Binary inputs and NUL-delimited
Git paths are checked without text conversion. Owner execute changes fail even
when status hides modes; group and other execute permissions alone do not
change Git's regular-file executable mode.

Both the app checkout and the existing fixed paired Relay checkout use this
raw checker. The paired checkout must still be exactly
`838049e537e07eb646a2a0393eb969fba43d0739`, have clean Git status and occupy the
single existing `.ci-relay/` exception. There is no test or environment override
for that pin. Ignored generated output retains its previous allowance and is
not treated as tracked source.

The regression controls create only owned throwaway Git repositories. They
cover clean binary/unusual paths; assume-unchanged and skip-worktree edits,
deletions, file/directory replacements and same-byte aliases; all owner/group/
other execute combinations; local replacement refs; and replacement during a
real delegated read. They also check that failed raw verification preserves
the throwaway index and that the CLI emits only its existing fixed failure
message. Paired-shaped fixture controls exercise the same raw primitive; they
do not fabricate the fixed Relay commit or claim a genuine paired backend run.

Run the focused checks with Node 22:

```sh
node --test .github/tests/ci-raw-source.test.cjs \
  .github/tests/ci-source-identity.test.cjs \
  .github/tests/contract-source-identity.test.cjs
```

Existing weak-source reproduction and earlier CI failures remain separately
attributed to their original SHAs. This isolated package changes no app,
dependency, protocol, workflow trigger, native harness or release operation.
The original public matrix assertions remain unresolved until their actual
current-protocol work is completed and tested.
