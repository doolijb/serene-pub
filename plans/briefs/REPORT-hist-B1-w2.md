# REPORT hist-B1-w2
writeTools.ts: removed `history` from ENTRY_TYPES; in writeEntry.run, right after `kind` is read (after the name/content check), `kind === "history"` throws ToolError("History comes from scenes: capture the moment and compile it, or write world lore.") before fileThrough. Header comment unchanged.
writeTools.test.ts: added one `it` (refuses history, ToolError message exact, `filed` empty).
Tests: tools/ dir 4 files, 27 tests passed, exit 0.
Noticed, not done: none.
