-- A targeted re-projection, on the 0099/0106/0170/0174 precedent: every provider
-- whose `connection` slot now declares what the connection must be able to DO.
--
-- What changed: `SlotDecl.requires`, a list of capability ids, on the connection
-- slot of each type below. `shape` is untouched and still types the slot; this is
-- a separate fact about the CONNECTION bound to it.
--
-- Why it was needed: the picker and the bind check both filtered by the
-- connection's `modality` column — one scalar, one answer. KoboldCPP writes
-- replies and draws pictures from the same process, so `modality: 'text-gen'`
-- made an image node refuse it for being what it is. `requires: ['text->image']`
-- is what makes that connection offerable, and without a declaration on any slot
-- the whole capability-filtering path in `choicesFor` was unreachable code.
--
-- Note which types are NOT here. The two MCP nodes kept their bare `shape`
-- filter deliberately: an MCP server serves tools, it does not turn one kind of
-- data into another, so no transform id is true of it and `text->text` would
-- have made every chat connection in the install look offerable there.
--
-- Deleting the rows lets boot sync re-project the current declarations. Safe
-- here only because nothing outside this repo pins these versions.
--
-- All fourteen in ONE migration on purpose: re-projection is legal only until
-- 0.6.0 ships, and after that a changed type is a new version, never a rewrite
-- of the row (13 §12b). A second pass to add the `optional` half later would not
-- be available, so `optional` was deliberately left undeclared rather than
-- guessed at — a node's binding must actually consume a capability before
-- declaring it, and none of these do yet.
DELETE FROM "pipeline_type_registry"
WHERE "version" = 1
AND "type_id" IN (
	'core:provider/generate-text',
	'core:provider/generate-image',
	'core:provider/embed-text',
	'core:provider/speak',
	'core:provider/extract-cast',
	'core:provider/name-entry',
	'core:provider/summarize-batch',
	'core:provider/summarize-synth',
	'core:provider/graph-node-description',
	'core:provider/graph-node-resolution',
	'core:provider/graph-perspective',
	'core:provider/graph-pre-filter',
	'core:provider/graph-state-detection',
	'chariot.comfy:render-image'
);
