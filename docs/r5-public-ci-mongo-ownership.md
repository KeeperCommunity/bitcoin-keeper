# Public legacy CI replica ownership

The historical automatic-backup matrix retains its existing paired Relay
`838049e537e07eb646a2a0393eb969fba43d0739`, Mongo image digest, replica set,
loopback port27058, assertions and observed2PASS/293FAIL baseline. This package
changes only ownership/readiness/cleanup of its disposable CI container.

Previously its static container name and `docker rm ... || true` could leave a
green cleanup step after an unknown removal outcome. The helper derives an
exact name and label from this hosted run/attempt, rejects an existing container
at start, and verifies label, immutable image and live state before every replica
initialization probe. It uses the same initialization query and a bounded
writability deadline. Raw Docker output never enters its fixed receipts.

The always-run cleanup independently inventories only that exact name. An empty
successful query proves absence; a failed, oversized or malformed query does
not. Removal requires the expected label/image and confirms both the removal
reply and subsequent absence. A committed start with a lost CLI reply remains
discoverable by the deterministic name/label. Unknown ownership never permits
removal. A failure stays a failure; no `|| true` converts it to success.

Fault tests use fake Docker replies exclusively. They cover wrong context,
foreign image/owner, stopped runtime, collision, lost start reply, timeouts,
malformed/oversized responses, readiness deadlines, and uncertain disposal.
The main workflow runs them before starting the actual disposable replica.
Its push filter additionally admits only this isolated package branch so its
actual CI can run while its draft review uses a fixed, unadvanced review base.
Actual Docker execution is established only by the new package's own hosted
run and exact-source receipts, not these tests or another source SHA.

This is an isolated CI package. It changes no app/backend protocol, dependencies,
native build, physical/device behavior, trust installation, signing or release
permission. Existing matrix assertion failures remain visible. CI replica
cleanup proves neither native feature acceptance nor release readiness.
