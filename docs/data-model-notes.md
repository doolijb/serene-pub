# Data model notes

Why some tables in `src/lib/server/db/schema.ts` are shaped the way they are, for contributors
reading or changing the schema. Each table's comment in the schema states its rule; where the
reason is too long for a comment, it points here.

## connection_models

**A connection is an endpoint; its models are rows under it.** `connections` holds where the
compute is: the base URL, the key, the wire mode, the token counter. `connection_models` holds the
models reachable through that endpoint, each with its own settings. One llama.cpp host serving
three models is one connection with three model rows, so its URL and key are stated once, and
testing the endpoint covers every model behind it.

**Every selection is a pair.** Wherever something picks a model (the pub defaults, a
pipeline config's connection slot) it names both the endpoint and the model. A connection has no
default model, so a selection naming only the endpoint is incomplete and resolves as
unconfigured rather than guessing.

**Rows, not a JSON array on the connection.** `connection_defaults.connection_model_id` and the
pipeline config's connection slot both reference a model, and a reference needs an id that a
foreign key can clear. In an array the index would be the reference, and deleting the second of
three models would silently repoint every selection that named the third.

**A model's settings are overrides, so they are nullable.** `prompt_format`, `token_counter` and
`context_window` on a model row are NULL unless an admin set them, and NULL means "whatever the
endpoint says". `capabilities` has the same `{ resolved, overrides, probe }` shape as
`connections.capabilities`; `layerCapabilities` in `server/connections/models.ts` lays a model's
capabilities over its endpoint's. It is resolved at every run and never cached on either row.

**Model rows are synced from the service.** When a listing of the endpoint succeeds and no longer
names a model, `missing_since` is set on that model's row. It keeps its first value across later
syncs, and is cleared when the model is listed again. A missing model is refused at dispatch and
when starred, and every picker shows it greyed with the reason. The row is kept, so the overrides
and selections that name it survive the model coming back.

`models_synced_at` and `models_sync_error` on the connection record the last attempt. A listing
that **fails** writes only those two and touches no model row: an unreachable host is a fact
about the host, not about any model. See `server/connections/modelSync.ts`.
