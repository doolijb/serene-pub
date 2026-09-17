# Data model notes

Design rationale for tables in `src/lib/server/db/schema.ts` that is too long
to live as a comment there. Each table's schema comment carries the
present-tense rule and, where it points here, the paragraph behind it.

## connection_models

`connections` stays the ENDPOINT (its id, and every foreign key pointing at
it, is untouched); `connection_models` holds the models reachable through
that endpoint. Selection everywhere is an (endpoint, model) PAIR, and both
halves are required: connections have no default model (0128 dropped
`is_default` and the endpoint's `model` mirror), so a pair naming only the
endpoint is incomplete and resolves as unconfigured rather than guessing.

**Rows are synced from the service, not imported (0129).** `missing_since`
on a model row is set when a successful listing of its endpoint stops naming
it, kept at its first value across later syncs, and cleared when the model is
listed again. A missing model is refused at dispatch and by the star, and
every picker shows it greyed with the reason; the row is kept so the overrides
and selections naming it survive the model's return. `models_synced_at` /
`models_sync_error` on the endpoint record the last attempt; a FAILED listing
writes only those two and touches no model row, because an unreachable host
is a fact about the host, not about any model. See
`server/connections/modelSync.ts`.

Before this split, a `connections` row was a URL, an auth bag, a wire mode,
ONE model string and ONE capability set — conflating where the compute is
(a key, a base URL, a token counter) with which model is being asked for (a
context window, a completion template, a vision capability). One llama.cpp
host serving three ggufs had to be three connections, each re-stating the
same URL and key and each with its own probe, so testing one said nothing
about the others and changing the key meant editing three rows.

**Rows, not a JSON array on the connection.** `connection_defaults.connection_model_id`
and the pipeline config's provider slot both REFERENCE a model, and a
reference needs an id a foreign key can clear. In an array the index would be
the reference, and deleting the second of three models would silently repoint
every selection that named the third.

**The settings on a model row are OVERRIDES, nullable for that reason.**
`prompt_format`, `token_counter` and `context_window` are NULL on a row the
migration that introduced this table created, and NULL means "whatever the
endpoint says" — the backfill copied the model string and nothing else, so
every merged pair was byte-identical to the row it replaced. `capabilities`
follows the same shape `connections.capabilities` uses (`{resolved,
overrides, probe}`); see `resolveModelCapabilities` for how a model's layer
sits over the endpoint's.

> "Endpoint/Model split. We would still need to be able to manage different
> models independently with their own settings, and choose via
> connection+model for i.e. system defaults & service node overrides."
> — ruling, 2026-09-10
