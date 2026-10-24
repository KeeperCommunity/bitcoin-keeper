# Rejected artifact response cleanup

An independent synthetic check of frozen adapter #7133 at
`a23992f1604e47bd68e898cb696e51ef3814d4eb` confirmed that an oversized storage
Content-Length was rejected before its response body was cancelled. The rejected
archive was never accepted. This is an inherited response-cleanup defect, not a
reported failure of the successful fixed-artifact hosted transport probe #7134.

This separate successor encloses status/header validation and streaming in one
cleanup boundary. It cancels an unread body when validation or reader acquisition
fails, or the acquired reader once streaming starts. A cancellation failure
prevents success and retains the existing fixed-vocabulary error boundary. The
original one-MiB cap, API origin, redirect policy, storage permissions, timeouts,
untrusted-byte return type and authorization behavior are unchanged.

Controls cover failed status, invalid/oversized length, reader acquisition,
read failure, length mismatch, success and cancellation failure. These use
synthetic responses, make no API call and provide no native or release acceptance.
The published producers and their original checks remain preserved. Durable
hosted test-command wiring is part of the separately bounded Actions-ingestion
continuation; this package makes no hosted-pass claim.
