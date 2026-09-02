-- A targeted re-projection, on the 0099/0106/0170 precedent and just as
-- deliberately narrow: `core:consumer/create-message` gained an in-port before
-- any release shipped it, so the registry row is a stale snapshot of code that no
-- longer exists.
--
-- What changed: a `media` in-port, carrying references to media that should be
-- posted WITH the message.
--
-- There was no way to do that at all. `attach-image` exists, but it needs a
-- messageId from *outside* the run — `write-result@1` is deliberately not
-- assignable to `row-ids@1`, because under async review the row a create node
-- promised may never exist, so a create-then-attach pair in one spec is a
-- dangling write waiting for a rejection. That rule is right, and its consequence
-- was that an image could be rendered and stored but never posted as a NEW
-- message.
--
-- The resolution is the one streaming already got: one node with a settled
-- output, not two nodes and a hope. The write that creates the message is the
-- write that attaches its media.
--
-- Deleting the row lets boot sync re-project the current declaration. Safe here
-- only because nothing outside this repo pins the version.
--
-- This must not become a pattern (13 §12b): once 0.6.0 ships, a changed type is
-- a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:consumer/create-message'
AND "version" = 1;
