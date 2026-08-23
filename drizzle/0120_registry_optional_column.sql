-- Store `optional` on the registry row.
--
-- It has been in the type content hash from the start and stored nowhere, so
-- the only reader that could see it was the executor. The panel could not:
-- its other source is the in-process descriptor, which does not exist for a
-- `transport: 'process'` plugin type and is precisely what F6 forbids reaching
-- for. A property the hash protects but no reader can see is a declaration only
-- half the system honours.
--
-- It is what decides whether a node may be switched off — `optional` already
-- means "an empty result here is fine", which is exactly the precondition — so
-- the panel needs it to know whether to offer the control at all.
--
-- Defaulted rather than backfilled from a hardcoded list: `syncTypeRegistry`
-- now compares the stored column against the declaration on every boot and
-- corrects it, so an existing row heals itself the first time the app starts.
ALTER TABLE "pipeline_type_registry"
ADD COLUMN IF NOT EXISTS "optional" boolean DEFAULT false NOT NULL;
