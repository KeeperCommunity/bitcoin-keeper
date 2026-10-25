# Private D13 artifact transport preparation

`private_software_artifact_zip.py` is a separate, pure ZIP32 reader for the
thirteen selected-platform metadata members emitted by Relay D
`448e09d7a373fc7e9d9c540880b45e2c742997f7` (#187). It does not change the
existing single-member `software_artifact_zip.py` API, limits or consumers.
This source package does not enable an Actions route, collect artifacts,
authenticate source identities, validate receipt contents, grant native or
installed trust, or authorize an operation.

`read_archive(raw: bytes, platform: str) -> dict[str, bytes]` accepts exactly
`IOS` or `ANDROID`. `member_limits(platform)` declares the finite thirteen
names and their canonical return order. The returned values are the original
uncompressed bytes, including invalid JSON or binary bytes. Receipt schema,
identity, source hashes, native proofs, stage outcomes and cleanup must be
validated separately against an independently authenticated expected context.
The reader never parses or reserializes member contents and never extracts
paths to disk.

The fixed limits match the parent software validator's D profile:

| Members | Count | Maximum uncompressed bytes each |
| --- | ---: | ---: |
| Integration aggregate, startup, final app metadata, three public wrappers | 6 | 2,000,000 |
| Protected, recovery and account metadata | 3 | 32,768 |
| Three fixture receipts and Mongo receipt | 4 | 8,192 |

Every member must be nonempty. The member caps total 12,131,072 bytes. Both
the archive input and total inflated output have a fixed 12 MiB (12,582,912
byte) ceiling. The 451,840 byte margin accommodates ZIP headers for an archive
with every member at its individual limit. In particular, the aggregate has
the same 2,000,000 byte limit as the raw validator; the actual producer's
2,048-event budget ledger can exceed 262,144 bytes before its other fields.
There are no caller-provided names, limits or bypass modes.

Any physical permutation of the exact thirteen selected-platform names is
accepted. Central records must follow that physical order and describe every
contiguous local record. Return order alone is canonical: original C2 ten
members, followed by public-probe, public-features and public-product. The
reader rejects prefixes, gaps, overlaps, unlisted records, hidden compressed
tails, trailing data, duplicate or unknown names, alternate paths, links,
directories, ZIP64, encryption, multidisk archives and comments. Only stored
or raw-deflate payloads, matching ZIP32 headers/descriptors, valid CRCs and
finite timestamp extensions are accepted. Deflate output is bounded during
decompression, then checked against the declared size and member cap.

The CLI takes one platform argument and reads at most the archive limit plus
one byte from stdin. Its successful stdout is a compact base64 mapping for
captured IPC, with no member-content JSON interpretation. A consumer must
capture this envelope and must not print it in logs. Failure returns exit 1,
empty stdout and the fixed `PRIVATE_SOFTWARE_ARTIFACT_ZIP_INVALID` error without
a payload, path or traceback. No source identity is inferred from the CLI.

Run the synthetic host controls with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .github/tests -p 'test*software_artifact_zip.py' -v
```

These controls use generated disposable byte archives. They prove transport
behavior only. They do not run an app, simulator, emulator, backend, provider,
Actions API, native suite or release operation. Live transport and the private
Actions adapter remain separate packages with their own reviewed identities
and evidence requirements.
