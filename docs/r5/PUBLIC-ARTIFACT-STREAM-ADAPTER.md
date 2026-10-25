# Pinned github-script manual artifact transport

This bounded correction is stacked on frozen P2A #7128. It preserves that
producer and adds no workflow, native operation, credential lookup or authority.

The exact pinned github-script action is
ed597411d8f924073f98dfc5c65a23a2325f34cd. Inspection of its bundled Octokit
fetchWrapper established that request.redirect is not forwarded to fetch.
The previous P2 adapter would reject the eventual response but its SDK could
first follow and buffer the archive. This was found by source inspection;
no actual hosted failure is claimed.

Pinned upstream dist/index.js Git blob:
bb06b77b98c6d994acb116b86ce49a064712a240; 1,259,242 bytes;
SHA256 4af8211e8a7ef1f8e03e03fab7fdbd204c1108713af5c18b3d48f04d194c9abe.
The source was fetched without credentials and matched its Git blob.
The test model reproduces its relevant forwarding/body-parsing behavior;
it is not a replacement for an actual hosted client check.

The adapter uses the supported request.fetch hook, validates the one fixed
GitHub API origin/repository/artifact URL and GET method, forces manual redirect,
requires a 302, cancels the API response body, and sets
parseSuccessResponseBody: false. Invalid status and error bodies are never
passed to SDK parsers. The second HTTPS storage request receives no API headers,
follows no redirect, and retains the existing bounded stream and timeout.
The exported transport sanitizes all errors and returns untrusted bytes only.

SDK-shaped controls cover ignored redirect options, hook use, wrong API
origin/path/method/body, API cancellation, unsupported clients, retries and
error privacy. A separately reviewed, finite, fixed-existing-artifact hosted
probe must verify the actual action client. No current native, installed
collector, private integration, canonical or release acceptance follows from
these source controls.
