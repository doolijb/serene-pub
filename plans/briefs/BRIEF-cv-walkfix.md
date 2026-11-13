# BRIEF cv-walkfix — two findings from the stage-1 walk (client)

Lane-supervisor (fresh, Opus). Read `BRIEF-cv-common.md`, the "Stage 1 walk" bullet at the end of the plan, `plans/REPORT-cv-member2-2026-11-06.md` (the `bindingsForCharacter` members carry `cardVersion` / `cardCurrentVersion` / `behindCard`). Lane id **cv-walkfix**. One worker. Client only (`src/lib/client/components/characterForms/**`). `--maxWorkers=2`.
1. The editor's sentence (`castEditWords` / `castEditParts`, `CharacterForm.svelte`) names only the members that follow the **version being edited** (a member pinned to v1.0 is not changed by editing v1.1); none → no sentence. The cast line itself stays as is.
2. After **Save as new version** (and after a version save), the cast line re-asks `lorebooks:bindingsForCharacter` so the Update offer shows without a reload.
DOM tests for both. Report as `# REPORT cv-walkfix (2026-11-06)`.
