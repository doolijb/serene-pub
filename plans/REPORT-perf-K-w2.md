# REPORT perf-K w2
Status question: none relayed.

## Changed files
- src/lib/server/plugins/fetchHost.ts (cap constant + bounded read)
- src/lib/server/plugins/store.ts (retention)
- src/lib/server/plugins/fetch.int.test.ts (3 new cases x 2 backends)
- src/lib/server/plugins/store.retention.int.test.ts (new, 4 tests)
- docs/plugins.md (one sentence, network bullet)

## Rules
- Fetch cap: `FETCH_RESPONSE_MAX_BYTES = 4 * 1024 * 1024` exported, spliced via `${}` (number and "4 MB" both derive from it). Content-Length over cap refuses before reading; otherwise stream read with TextDecoder, byte count, reader.cancel() on overflow; null body is ""; exactly the cap passes. mask() still runs on the passed text. Redirect/allowlist/SSRF/secrets code untouched. No new pluginRuleRef.
- Retention: `INVOCATION_RETENTION_DAYS=30`, `INVOCATION_MAX_ROWS=50_000`, module-local `PRUNE_EVERY=100`, `writesSinceBoot`; `pruneInvocations(db, now, opts)` runs two deletes on the given handle (age cut, then OFFSET maxRows by finished_at DESC, id DESC). writeInvocation prunes when `writesSinceBoot++ % 100 === 0`, after the insert, same handle; failure is caught and warned `[plugins] invocation log prune failed: ...`. No setting/timer/randomness; no global db import; schema/drizzle untouched.

## Refusal sentence as shipped
`fetch: the response is larger than 4 MB — keep bigger payloads in ctx.storage`

## Tests (capped scope)
fetchHost.test.ts, fetch.int.test.ts, store.int.test.ts, store.pluginId.test.ts, store.retention.int.test.ts: 5 files, 71 tests passed. Masking of a passed body is covered by the existing echo-auth tests, which now run through the bounded read. tsc: no errors in my files. Prettier: fetchHost.ts and store.retention.int.test.ts clean; store.ts and fetch.int.test.ts were already unclean at HEAD (not reformatted).

## Noticed, not done
- NOMENCLATURE §25 needs the ledger entries for FETCH_RESPONSE_MAX_BYTES, INVOCATION_RETENTION_DAYS, INVOCATION_MAX_ROWS, pruneInvocations (not my file).
- Content-Length is the compressed size if the server gzips; the streamed byte count (post-decompression) still enforces the cap.
