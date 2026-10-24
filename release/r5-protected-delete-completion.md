# Protected-copy Delete completion witnesses

This separate package adds five current-protocol host integration cases. It
changes no product source, dependencies, fixtures, CI runner or retired matrix.
Ordinary Delete success is already covered by the existing43-case proof. These
cases address its operation-specific consent/session and completion boundaries.

| Case | Genuine boundary | Required invariant |
| --- | --- | --- |
| Saved opt-out | Actual Delete worker, authenticated snapshot/CAS/tombstone after genuine setup enrollment and later opt-out | Explicit Delete works without re-enrolling/re-enabling automatic backup; local encrypted records, account/subscription and older copy survive. |
| New off→on choice | Hold an actual committed Delete ACK | Completion cannot overwrite the newer consent epoch, clear its pending work or report current success. |
| Reentrant choice | Subscribe to the real success dispatch, then make a new choice | Later completion cannot clear the new choice's pending state; the worker returns false for that superseded completion. An already-dispatched historical success action is not erased or claimed to be current verification. |
| A→B→A | Open distinct actual encrypted Realm files before releasing real ACK | Old-session completion cannot clear current consent or claim new-session success; A's local data and older copy survive. |
| Lost ACK | Drop a real committed reply, read the actual tombstone, then try the original consumed receipt again | No manufactured success, same-receipt retry/rebase/recreation, enrollment or implicit older-copy restore. A new explicit Delete request obtains its own fresh intent and is outside this replay assertion. |

All successful and failing requests reach the unchanged signed-v3 transport,
reviewed actual router and bounded transactional backend. Held/dropped replies
are faults on real completed operations, never synthetic successful responses.
Recovery material is the public disposable BIP39 test vector; no production
account or real funds are used. HTTP, traces and backend storage stay loopback
and disposable. Full image comparison covers local recovery records; older
storage, original Keeper identity/local subscription and the backend account's
subscription record are checked independently. Held workers are released and
drained before test Realm/server disposal, preserving an earlier assertion error.

These are host proofs using the existing production-declaration loader, actual
Node Realm and store/worker/queue boundaries. They do not render UI, operate
native MMKV, establish physical-device/PIN/biometric results, prove authentic
historical disk migration or implement all-copy deletion. The original295-case
matrix and its2PASS/293FAIL remain unchanged and visible.

Exact app/backend/control commits, raw case outcomes and actual source/cleanup
receipts belong in the draft PR once executed. Source syntax or guard passes do
not establish these five genuine integration outcomes. A new combined candidate
requires its own exact-source affected checks. No merge, release signing,
upload, distribution, deployment or publication is authorized.

The initial source `bccf70dbc4a075ebcf067dfd3fab0d5b84b93a0a` ran through
private control `4755c9da08fa6d04fdb11a24cd67f7861d177827`, run39851267317,
attempt1/job120077779383: **4PASS/1FAIL/0SKIP/0CANCEL**. All four source checks,
genuine Realm setup and owned writable/removal receipts passed. Case5 incorrectly
started a second explicit Delete worker and required false; it returned true.
The following replay-count/enrollment/preservation assertions were not reached.
This is a proof expectation error, not evidence of automatic replay or a product
regression. The correction observes the first unchanged worker's actual receipt
and mutation arguments and resubmits that consumed receipt to the actual queue.
The failed source/run remain preserved; corrected genuine execution is pending
on its own exact app/control commits. No production behavior is changed.
