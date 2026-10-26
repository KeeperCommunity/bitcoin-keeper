# Specific BHR node, archive dependency and final metadata obligations

This private test-only slice ports original182,185–188: five cases. Exact source
IDs, prior dispositions and production boundaries are recorded in the adjacent
`r5-caller-metadata-obligations.json` map.

The actual BHR node producer first backs up its genuine persisted NodeConnect
collection, then a second actual native commit deletes every node. The actual
worker must send replaceNodes true with counts1 then0, chain its own prior ACK,
and fully verify the exact empty remote set with all other records retained.

The archive dependency case genuinely commits both archive and create effects,
then deliberately supplies only the new vault ciphertext with archiveVaultId.
Without preceding archived ciphertext, the projector rejects before any CAS.
The historical map says zeroHTTP, but original185 asserts zero mutations. A real
valid initial snapshot read is retained; no original assertion is waived. Both
local effects survive and the complete actual remote image stays original.

Three final-readback cases preserve the single updateAppImage caller and each
specific publicId/version/subscription defect. Actual positive ACK and exact
initial-read/CAS/final-read order are required. Corruption keeps the original
revision, so v3 raw integrity stops the final caller before metadata comparison.
Separately invoking the unchanged actual production metadata comparator must
return true for the original and false for the selected changed field; no false
final-caller branch coverage is claimed. Full original pending/completed flags,
local/account data, actual backend copy and no-HTTP receipt replay remain.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedCallerMetadataObligations.proof.cjs
```

Require exactly five actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller/raw-source fences and owned cleanup.
Source review and offline checks confer no runtime pass. No product/fixture,
protocol, KDF, dependency, version or counter changes; historical public2 PASS /
293 FAIL remains unchanged and remaining obligations are separate.
