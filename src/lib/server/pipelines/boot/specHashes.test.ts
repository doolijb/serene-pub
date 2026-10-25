/**
 * What each core spec's slug resolves to, as a checked-in fact.
 *
 * ## What this used to be for, and what it is for now
 *
 * Seeding matched on `(slug, semver)` and **skipped on a match**, so a changed
 * pipeline published under an unchanged version reached no install that had
 * already booted: the instance kept running the old document while the code said
 * otherwise, and nothing anywhere reported it. Tests could not catch it — a
 * fresh database publishes whatever the code currently says, so every
 * integration test passed on the new shape while real upgrades silently got the
 * old one.
 *
 * Since the content-addressing ruling (2026-09-10) a version is `(spec, semver,
 * canonical hash)`: an edited document publishes as a **new row**, the slug's
 * `active_version_id` moves to it, and the row it moved off is retired for the
 * receipts that pinned it. So an in-place spec edit needs no migration
 * deleting version rows.
 *
 * What remains is the question this file has always really been asking: **did
 * you mean to change what that pin means?** A moved hash is now shippable and
 * still has to be deliberate, which is what a recorded snapshot makes it.
 *
 * Found the hard way, and worth keeping written down. A version bump written as
 * a string replacement matched nothing, because another session had already
 * moved that spec to the version being written; the replace was a silent no-op
 * and the whole change sat behind a version that seeding skipped.
 *
 * ## When this fails
 *
 * You changed a core spec. Either bump its `*_VERSION` and add the new pin, or —
 * under the 0.6 version freeze, which is the usual case — record the new hash
 * against the existing pin, in the same commit as the edit. **No migration is
 * involved.** Every migration number in the comments below names a file of
 * the pre-release chain squashed on 2026-10-01 (archived in
 * `~/.claude/plans/ARCHIVE-drizzle-migrations-0094-0221-v2.tar.gz`), never
 * today's file of the same number; they record why a hash moved.
 *
 * That the slug's row actually *carries* the recorded hash after a boot is
 * asserted by `contentAddressing.int.test.ts`, where a database is available.
 */

import { describe, expect, it } from "vitest"
import { canonicalHash } from "@serene-pub/sdk"
import { CORE_SPECS } from "$lib/server/pipelines/specs"

/**
 * `slug@semver` → the document's canonical hash.
 *
 * The version is *in the key* on purpose: bumping it makes a new entry rather
 * than editing one, so the diff shows a version and a shape changing together
 * instead of a hash quietly moving underneath a version that did not.
 */
/**
 * ## The one-shot rename (2026-09-16; plans/30 §U3, migration 0134) — all seventeen moved at once
 *
 * Every stored document changed words and nothing else: node kinds (`input ·
 * provider · consumer` → `inlet · oracle · outlet`) and the definition ids that
 * carry them, clause kinds (`async · map · route` → `gather · each · junction`)
 * and the `clauses` key itself, `subscribes` deleted (R-4), the inlet lock and
 * the genre surface keyed by event id, triggers saying `venue`, the taxonomy
 * `zone` culled, the tool loop keyed `tools`, and — the one semantic change —
 * the two loser lore lanes and the loser embed node reading their `params`
 * through the owner (R-7 P2). Migration 0134 rewrites every stored row to the
 * same document these hashes name, and the boot after it moves each slug's
 * pointer once. The rows the pointers moved off keep their old hashes,
 * marked `renamed_at`, for the receipts that pinned them.
 */
const PUBLISHED: Record<string, string> = {
	// 1.0.0: the standard session type as a create spec (23 §7) — the F29
	// floor's shape moves from the input descriptor to this document.
	// Hash moved (R-15 *Forms*, 2026-09-17 — U5d): the genre's event surface,
	// which rides `meta.genre` on the create spec, declares
	// `core:event/form-addressed@1` (optional) — the same move for all three
	// create specs. Nothing the pipeline sends changes. (was "9bfdda8a4f589")
	/**
	 * Turn order as state (PLAN-turn-order §4.5, A6). Two specs, one
	 * builder: the cast's order, and one narrator entry per send for the
	 * planner genres.
	 */
	// One turn-order spec per genre since the modder pass (R27, M2); the
	// shared `turn-order` / `turn-order-narrator` pins are retired.
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "2d13f7b17a0fb")
	// Moved 2026-10-19 (PLAN-genre-restructure lane 2): the voices group — a
	// `tasks` step and `unprompted` (`core:task/turn-unprompted@1`) before the
	// write, the narrator's line Narrate. Edited in place under the freeze. (was "404361a5ed026")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was 'a4799f0c90c18')
	"core:spec/story-turn-order@1.0.0": "c9fcf581d1791",
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "1e155929f443a5")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '127cf804a74c6d')
	"core:spec/guide-turn-order@1.0.0": "6e430e962cd0b",
	// Moved 2026-09-27 (lair pass B9): the `TURN_ORDER_NARRATOR_EVENTS` list gains `message-deleted` and
	// `message-hidden`, so Continue re-decides after a delete or a hide.
	// Proven: with those two event ids removed, the document hashes back to
	// the old pin. (was 'b605f68c2205f')
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "61d38f952d6ab")
	// Moved 2026-09-27 (lair pass B9): the `TURN_ORDER_NARRATOR_EVENTS` list gains `message-deleted` and
	// `message-hidden`, so Continue re-decides after a delete or a hide.
	// Proven: with those two event ids removed, the document hashes back to
	// the old pin. (was '6bc2842fd6676')
	// Moved 2026-09-28 (lair re-plan R6): the genre carries the Sanctum and
	// the Castellan, and the history preset reads `channel: '*'`. Proven (SDK and app pins alike): the SDK sources copied with only R6's edits reverted hash back to the old pin.
	// (was "1a9cbfafa790bf")
	// Moved 2026-09-30 (Lair character turns, owner ruling): the pool admits
	// the active delvers, so the character turns a standing plan prepares are
	// kept at the write. Proven (SDK and app pins alike): a copy of core-catalog/src with only this
	// lane's edits reverted (lair.ts, turnOrder.ts, genres.ts) hashes back to
	// every old Lair pin. (was "1bee84716ce1fa")
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "c0edd4e6d3d23")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1a6264ad2eae4f')
	"core:spec/lair-turn-order@1.0.0": "f6801bd2a7aac",
	/**
	 * ⚠ Every respond spec bumped a semver at A6 (§4.4, §7): the `speaker`
	 * node moved to the turn-order spec and `placeholder` returned to
	 * directly after the inlet. A new version rather than an in-place edit,
	 * because the node list changed and a stored document must stay as it
	 * is. The writing room's nine action specs move with them — their
	 * `speaker` node was `turn-manual`, whose whole job was recording the
	 * action's explicit pick, and a pick never enters a strategy now.
	 */
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '1970a642240009')
	// Moved 2026-09-29 (genre uplift F1, Search by meaning is Automatic):
	// `semantic.arm.queries` wires `connection:
	// slot.connectionOf('semantic.arm.embed')` — the embedding connection, for
	// whether one is set up (until 2026-09-30, for whether it ran on this
	// machine; the wiring did not move with the rule). Proven: core-catalog/src and
	// contracts/src copied with only F1's edits reverted (that wiring, the
	// query-windows slot and three-valued switch) hash back to the old pin.
	// (was "ab24c4c296be8")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "e1d9077ca6b80")
	// Moved 2026-10-01 (post-history trigger, owner ruling): the default preset's key and label are `default` / "Default" (was `chat` / "Chat"), so a fresh install's shipped config reads Default. Proven: a
	// copy of core-catalog/src with only this change reverted hashes back to the
	// old pin. (was "58982f85e91a9")
	// Moved 2026-10-02 (author's note AN1, owner ruling): the `context` step
	// wires `fields: $.input.fields`, so a genre declaring the note (Chat)
	// carries it to Assemble. Edited in place under the freeze, content-
	// addressed. Measured with other lanes' in-flight core-catalog edits in
	// the tree. (was "29d6c133bf60f")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4). Edited
	// in place under the freeze, content-addressed, needing no re-projection (no
	// new preset value). Measured with other lanes' in-flight core-catalog edits
	// in the tree, not proven in isolation. (was "1246032026f772")
	// Moved 2026-10-02 (composer attachments phase 4, PLAN §3.5): a
	// `history-attachments` read and a `place-attachments` step before each
	// reading call's prompt; the prompt reads the placed lines. Edited in
	// place under the freeze. (was "cc3acc621b4d1")
	// Moved 2026-10-03 (owner note 39): `save` wires `reasoning` — the port
	// `thinking` -> `reasoning` on generate-text / update-message. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "df7c86394a82")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "75db48c05464b")
	// Moved 2026-10-05 (sprites in-pipeline, plan D1/D-b; owner: "not a
	// wrapper"): the retired `withSpriteTail` nodes give way to the sprite step
	// written out after `save` — `spritePick` (`core:oracle/pick-sprite@1`,
	// handed the reply's text and speaker) and `spriteShow` (`source:
	// 'picker'`). And D-c: the retrieval arms' embed steps lose their
	// `connection` slot, and `semantic.arm.queries` wires its own
	// (`slot.connection()`). Edited in place under the freeze. Measured with other lanes'
	// in-flight core-catalog edits in the tree. (was "6b320446a5eb1")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/respond`; nothing else changed. (was "520aa324cf15f")
	// I12 (2026-10-12): the Default config names its loadouts. (was "1f99b0cdffb35d")
	// Moved 2026-10-13 (live scenes lane D, §6): the reply tick after
	// `spriteShow` — a `tick` step (`core:task/clock-step@1`, exposed to the
	// session as *Each reply advances the clock by …*, By 0 = off) and a
	// `clock` junction holding *Advance story clock*. Off by default: every
	// reply is what it was. Edited in place under the freeze. Measured with
	// other lanes' in-flight core-catalog edits in the tree. (was "82d96ae3629ac")
	// Moved 2026-10-13 (live scenes §15 G4–G7, lane H): the reply tick's
	// *Advance story clock* says `cause: 'tick'` — never a time action, kept by a
	// swipe. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "1306e64e696429")
	// Moved 2026-10-13 (live scenes §15 G12, lane J): the tick's *Advance
	// story clock* says `onRefusal: 'skip'` — a story with no clock skips
	// the tick with a ledger line instead of halting after the reply. Edited
	// in place under the freeze. (was "1384332893aea")
	// Moved 2026-10-19 (PLAN-genre-restructure lane 2): `tasks` at the head,
	// the `retrieval` junction (*Read the lorebook*) before `rank`, the
	// *Read the scene* gate before `context`, and the reckoning's Review
	// arms, item supply and *Describe new places*; the sweep's relationships.
	// Edited in place under the freeze. (was "156aae1808c043")
	// Moved 2026-10-19 (main session after lane 2): the reply's model calls
	// labelled by purpose — Reply, What the reply changed, Look back over the
	// story — and the Review arms' step labels. Edited in place under the
	// freeze. (was "1d2f322ed2c3c9")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was 'f5dec0a9f3778')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O5/O7/O9): the `heard` transcribe-audio step before placement, `generate`'s speech sampling, `save`'s parts; every `generate-text` node names its speech sampling. Edited in place. (was 'e07249d51bcf4')
	// Moved 2026-10-21 (PLAN-layering repair 1): the `heard` step declares no status — a declared one shows on every run; the step says *listening* only when it hears. (was "138b8589c3e476")
	// Moved 2026-10-21 (lane F1, R54): the `context` step offers its prompt choice to the session owner (`expose.promptReach: 'owner'`). (was "1a523538d00b9d")
	// Moved 2026-10-23 (rulesets as functions D7, lane A2): *Replies carry changes* — the `changes` branch (shape → generate-json → the words saved, the changes parsed and applied or proposed at the reply's `reply-changes` mode) beside `reply.prose.*`, which the words' steps moved under. Edited in place. (was "11bb370d5bdf34")
	// Moved 2026-10-23 (core genres on the seams, merge GM): S2: the reply's commit reads its own mode (`reply-changes`), `asked` takes its params, and an `owners` step names whose changes (lane G1). Edited in place. (was "179a3507fd2182")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read; the changes branch's `message` names its params. Edited in place. (was "6cc089a5fe8b0")
	// Moved 2026-10-23 (RF fix 3): the `reply` junction holds only what differs — the prose call; the changes call, its `owners`, `shape`, `asked` and, last, `message` — and ONE tail after it (`save` reading the junction's `text`, the commit's Apply, `spritePick`, `spriteShow`) runs once at the top-level keys; the never-reachable Review arm is gone. Edited in place. (was "b30e48c4270fb")
	"core:spec/story-respond@1.21.0": "e396fa6e5ffb8",
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was 'b0c3e32a16d1d')
	"core:spec/guide-respond@1.1.0": "6739b2495986b",
	// New 2026-09-27 (guide grounding): the guide's own context template as
	// the spec's default `guide` preset — docs in the declared `docsExcerpts`
	// band, an `{{else}}` that says nothing matched. Bumped, not repinned: a
	// new version row. The graph is 1.1.0's; only `version` and `presets` differ.
	// Moved 2026-09-30 (plan A28): the guide reads its lorebook —
	// `gather.worldLore` (`core:query/world-lore@1`) pooled into `lore` — and
	// its template preset places it. Proven: a copy of core-catalog/src with only this lane's edits (guide.ts, whodunitActions.ts, lairActions.ts, adventure.ts, prompts.ts) reverted hashes back to the old pin. (was "1c41387d959cdd")
	// Moved 2026-10-02 (lorebooks Wave 8): an `eligible` step before `rank`
	// (C2). Edited in place under the freeze, content-addressed, needing no re-
	// projection (no new preset value). Measured with other lanes' in-flight
	// core-catalog edits in the tree, not proven in isolation. (was
	// "5b78652fa95ed")
	// Moved 2026-10-02 (composer attachments phase 4, PLAN §3.5): a
	// `history-attachments` read and a `place-attachments` step before each
	// reading call's prompt; the prompt reads the placed lines. Edited in
	// place under the freeze. (was "1c8ff751e606e")
	// Moved 2026-10-03 (owner note 39): `save` wires `reasoning` — the port
	// `thinking` -> `reasoning` on generate-text / update-message. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "1715f4a6ca9555")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "1438b9de1f000e")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): GUIDE_RESPOND_TEMPLATE renders `{{{attachments}}}` in its message loop (the `attached` step placed files the template dropped).
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1293f671d6b4bc")
	// Moved 2026-10-05 (sprites in-pipeline, plan D1/D-b; owner: "not a
	// wrapper"): the retired `withSpriteTail` nodes give way to the sprite step
	// written out after `save` — `spritePick` (`core:oracle/pick-sprite@1`,
	// handed the reply's text and speaker) and `spriteShow` (`source:
	// 'picker'`). Edited in place under the freeze. Measured with other lanes'
	// in-flight core-catalog edits in the tree. (was "abff4d2cceef8")
	// I12 (2026-10-12): the Default config names its loadouts. (was "100e883f026237")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '14bc517e7b7e62')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O5/O7/O9): the `heard` transcribe-audio step before placement, `generate`'s speech sampling, `save`'s parts; every `generate-text` node names its speech sampling. Edited in place. (was '21c627a8d31cf')
	// Moved 2026-10-21 (PLAN-layering repair 1): the `heard` step declares no status — a declared one shows on every run; the step says *listening* only when it hears. (was "ff693a649fd3e")
	"core:spec/guide-respond@1.2.0": "1273d3e728562b",
	// Moved 2026-09-27 (characterDetail genre field): Chat and Adventure
	// declare `fields.characterDetail` (CHARACTER_DETAIL_FIELD: full / brief /
	// speaker-only). Proven: a copy of core-catalog/src with just those two
	// field lines removed from genres.ts hashes back to the old pin. (was '765f3317d71e6')
	// Moved 2026-10-02 (author's note AN1): Chat declares `fields.authorsNote`
	// (AUTHORS_NOTE_FIELD), and create-chat inlines its genre's shape.
	// (was "193fca0f5fc4ae")
	// Moved 2026-10-03 (owner ruling: placed text at the end): `meta.genre`
	// carries Chat's shape, and the author's note field's `depth` default is
	// 0 (was 4). Edited in place under the freeze. (was "1566992a444e50")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/create-chat`; nothing else changed. (was "18b84026deb74b")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '3fd5d0832ce80')
	"core:spec/assistant-answer-form@1.0.0": "1a5af4b489d165",
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '63c78ba748cb9')
	"core:spec/assistant-create@1.0.0": "1180def0f20ddf",
	// Moved 2026-10-19 (PLAN-genre-restructure lane 2): `tasks` at the head,
	// the `retrieval` junction, and *Remember things* (★K) after the answer.
	// Edited in place under the freeze. (was "16a65b471d2187")
	// Moved 2026-10-19 (main session after lane 2): the model calls labelled
	// by purpose — Reply, Reply with tools, Remember things. Edited in place
	// under the freeze. (was "1c74aca94a7dbd")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1f4d71c32add75')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O5/O7/O9): the `heard` transcribe-audio step before placement, `generate`'s speech sampling, `save`'s parts; every `generate-text` node names its speech sampling. Edited in place. (was 'd5e414d4ae2f')
	// Moved 2026-10-21 (PLAN-layering repair 1): the `heard` step declares no status — a declared one shows on every run; the step says *listening* only when it hears. (was "1c104e3f27d708")
	"core:spec/assistant-respond@1.0.0": "1b6b90c7f64460",
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '12e06b4f3ee833')
	"core:spec/assistant-turn-order@1.0.0": "7e2fbf0f4dfd1",
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1244f17da8e07b')
	// Moved 2026-10-21 (lane F1): Story's declaration lost `applyActionChanges` (R55). (was "ae777ed4f3b4e")
	// Moved 2026-10-23 (core genres on the seams, merge GM): Story's `about` and its difficulty words corrected, in the genre shape it carries (lane G0, S7). Edited in place. (was "1b30b1e4ad7357")
	"core:spec/story-create@2.2.0": "37a22c038f516",
	/**
	 * The guide genre (plans/29 R-18; U5g, 2026-09-16) — two new slugs, and
	 * nothing above them moves. `create-guide` carries the genre's
	 * declaration, its one envoy included, on the version row;
	 * `guide-respond` is `respond` with the lore machinery replaced by
	 * `core:query/docs-search@1`, the envoy on the inlet's `speaker`, its
	 * card on the context builder's `speaker` port, and its instructions read
	 * by `slot.prompts({ envoy: 'mascot' })` — configuration at
	 * `envoy:mascot`, never a prompt row.
	 */
	// (was "cbca3b3df89e2") — moved with the genre surface, U5d; see create-chat.
	// (was "fa7a3eb64e2a9") — moved again, R-B (2026-09-17): Guide's genre now
	// declares `writes: { lore: false, scenes: false }`. Its lorebook is the
	// documentation it answers out of, and a session about how the app works
	// opens no scene; the declaration is what the write sites refuse from.
	// `create-chat` and `adventure-create` are untouched — neither declares
	// `writes`, and a genre that says nothing still means both on.
	// (was "1febb9fe3bd3f5") — moved 2026-09-26: the mascot is the genre's
	// `fallback` envoy (ruled that day: everyone has a name — a line nobody
	// claims in a guide session is the Guide's). Nothing else moved.
	// (was "3be276ae1ff00") — moved 2026-09-27 (guide grounding): the
	// mascot's system prompt (excerpts or nothing, a copied path, "I couldn't
	// find that in the docs") and its envoy description, both carried on the
	// genre declaration. Proven: those two strings restored in the document
	// hash back to the old pin.
	"core:spec/create-guide@1.0.0": "1305f4e75ffa6d",
	// Serene (owner, 2026-10-01): the Guide's envoy is named Serene, wears the
	// mascot, speaks in a calm and warm voice, and greets every new session —
	// the create spec gains `welcome` → `greet` → `write` and a `guide` preset
	// naming her. Proven: a copy of core-catalog/src with only these edits
	// (genres.ts guide envoy + prompt, guide.ts create spec, guideMascotImage.ts)
	// reverted builds create-guide@1.0.0 at its recorded pin. Paired with
	// `drizzle/0101_create_guide_greeting_reprojection`, which re-seeds the
	// shipped config so an existing install's Guide greets too.
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/create-guide`; nothing else changed. (was "6b6c45bf731ba")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '16fb2ead93ba5')
	// Moved 2026-10-23 (core genres on the seams, merge GM): the Guide's `tools` field dropped and its `about` written (lane G0, S8). Edited in place. (was "16e203934af640")
	"core:spec/guide-create@1.1.0": "c06cc623f9142",
	// (was "1d39898d4c7a0c") — W9 shape pins, see the note above adventure-ask.
	"core:spec/guide-respond@1.0.0": "b7997d7b1d904",
	/**
	 * The Adventure genre (DESIGN-adventure-genre.md) — five new slugs, and
	 * nothing above them moves. Every node they pin is either one core already
	 * shipped or one declared beside them; no existing spec or type was edited,
	 * which is what keeps `core:spec/respond@1.20.0` on the hash it has.
	 *
	 * `adventure-respond` is the multi-agent turn: plan, narrate, one voice per
	 * speaker the planner named, then a state keeper whose changes are proposed
	 * unless the session trusts the narrator. The other three are actions on the
	 * open `session-action` slot.
	 */
	// (was "1c67b7acb698cf") — moved with the genre surface, U5d; see create-chat.
	// Moved 2026-09-27 (lair pass B9): the genre's `events` map gains `message-deleted` and
	// `message-hidden`, so Continue re-decides after a delete or a hide.
	// Proven: with those two event ids removed, the document hashes back to
	// the old pin. (was '4b16999c12ab3')
	// Moved 2026-09-27 (characterDetail genre field): Chat and Adventure
	// declare `fields.characterDetail` (CHARACTER_DETAIL_FIELD: full / brief /
	// speaker-only). Proven: a copy of core-catalog/src with just those two
	// field lines removed from genres.ts hashes back to the old pin. (was '4e1033c247420')
	// Moved 2026-09-28 (enum option labels on Adventure's tone/difficulty); was e611ef3a97923.
	// Moved 2026-10-13 (live scenes §15 G2): the embedded shape names
	// Adventure's place, `scenes: { place: { stateKey: "location" } }`. (was "17f29013f5ffc6")
	"core:spec/story-create@1.0.0": "2b63bc55e3597",
	// ⚠ MOVED, in place, while the genre is still unreleased: the planner and
	// the keeper now pin `core:oracle/generate-json@1` instead of
	// `generate-text` + `parse-json`, their transcript comes from
	// `core:task/prose-transcript@1`, and the narrator builds its own. A live
	// playtest showed why: asked as ordinary replies, both JSON steps wrote the
	// character's next paragraph and appended the document under it, and the
	// keeper reproduced the PLANNER's schema it had read in the transcript.
	// `core:spec/respond@1.20.0` is untouched.
	// ⚠ MOVED AGAIN, same terms: the resolver now takes the planner's document
	// on a `plan` port (its `worldHints` were required by the schema and read by
	// nobody), the voices take the state and the plan so a cast member knows
	// where they are standing, and the narrator's own assembly template is gone
	// — every variable in it was wrong, so the narrator's prompt arrived with no
	// instructions, no transcript and two `[object Object]` blocks.
	// ⚠ MOVED AGAIN, same unreleased-genre terms: the preset points the
	// planner's and the keeper's Sampling slots at the seeded Background row,
	// by seed identity (`{ seedKey: 'sampling-background' }`) because a row id
	// differs per install. The narrator and the voices are untouched: those
	// are the prose a person waits for, and they keep the session's own pick.
	// ⚠ MOVED, same unreleased-genre terms (09-B B4, 2026-09-15): the turn
	// creates its own row — a `placeholder` outlet after the inlet, `save`
	// an `update-message` filling it — and `contextBudget` shares the
	// narrator's connection for the model's own window (R-8).
	// (was "890fe65ccfdc4")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "179a33c33b9856")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "1cce782246906a")
	// Hash moved (U5a, 2026-09-16): the voices' context builder takes the
	// planner's voice on `sideCharacter` (was `speaker`) — the port rename
	// on `build-side-character-context@1`, R-18 (3). Same value, same
	// prompt. (was "5822ccf7f43da")
	// (was "6471d909046c2") — W9 shape pins, see the note above adventure-ask.
	// Moved (U5f, R-15 *Staleness and order*, 2026-09-17): the keeper's
	// resolver and both `set-state` arms wire `base` from the state query's
	// `version` — the version this turn read, handed back with its deltas.
	// (was "12faeb788b2f4c")
	// Moved (W1, 2026-09-17): the voices `each` gained a per-speaker
	// character-lore lane, its own pool and its own rank, so a voice reads its
	// OWN private lore instead of every cast member's. `speaker` is the
	// reference the voice's context node already resolved. The spine's
	// character-lore lane stays the narrator's.
	// (was "1d49758bb5b83c")
	// Moved (attributes phase 3b, 2026-09-26): an `itemSupply` query
	// (`core:query/item-supply@1`) wired into `keeperResolve.supply`, so a
	// unique item already held is not handed out again. (was "6147f53a5ed3f")
	// Moved 2026-09-27 (owner ruling): the keeper's item arm renamed `possessions` → `inventory` (schema + preset `path: values,inventory`); proven: core-catalog/src with those edits reverted hashes to the old pin (was "5302994c7c0ce").
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '1ae9c2a766fbb3')
	// Moved 2026-09-29 (genre plan F6(a)): the cast's relationships — a
	// `gather.relationships` chain (`relationship-search@1`, read with nobody
	// speaking: the cast-wide read) concatenated into `lore`, `castRelationships`
	// wired from `rank` into `planContext` and `sceneContext` (never a voice),
	// and the preset's `gather.relationships.read` params `{ share: 0.1,
	// loreLinks: false }`. Proven: core-catalog's HEAD adventure.ts (this edit
	// absent) built against the same dist hashes to the old pin.
	// ⚠ The preset value needs a re-projection on installs that already wrote
	// this config (the 0122 precedent) — reported, not written here.
	// (was "11d5443563fd16")
	// Moved 2026-09-30 (plan A28): the places — `gather.rooms` (a location
	// listing with links, its preset) into `locationEntries` on
	// `planContext`, `sceneContext` and `voices.item.context`. Proven: a copy of core-catalog/src with only this lane's edits (guide.ts, whodunitActions.ts, lairActions.ts, adventure.ts, prompts.ts) reverted hashes back to the old pin.
	// (was "ef75fa60df7fe")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "17f4af67ae5bef")
	// Moved 2026-10-02 (lorebooks Wave 8): the vector and entity arms on the
	// spine and per voice, the voice as `speaker` (C3, R3); a `presences` read
	// and an `eligible` step (`core:task/eligibility@1`) before every ranker
	// (C2, R2/R4); the room rule's `place` step wired into every ranker as
	// `shownElsewhere`; statuses on the two embeds. Edited in place under the
	// freeze, content-addressed; its shipped config re-projected for the `place`
	// preset by `0109`. Measured with other lanes' in-flight core-catalog edits
	// in the tree, not proven in isolation. (was "18ef01ac01e5a1")
	// Moved 2026-10-02 (composer attachments phase 4, PLAN §3.5): a
	// `history-attachments` read and a `place-attachments` step before each
	// reading call's prompt; the prompt reads the placed lines. Edited in
	// place under the freeze. (was "1b28a125881f57")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "9ddd07c218618")
	// Moved 2026-10-05 (sprites in-pipeline, plan D-a): gains the sprite step
	// after `save` — `spritePick` (`core:oracle/pick-sprite@1`, handed the
	// reply's text and speaker) and `spriteShow` (`source: 'picker'`). And D-c: the retrieval arms' embed steps lose their
	// `connection` slot, and `semantic.arm.queries` wires its own
	// (`slot.connection()`). Edited in place under the freeze. Measured with other lanes'
	// in-flight core-catalog edits in the tree. (was "70163343495a2")
	// I12 (2026-10-12): the Default config names its loadouts. (was "1b99741eb2c332")
	// Moved 2026-10-13 (live scenes lane F, ★3 — the keeper's clock proposal):
	// the keeper schema gains a `clock` list (`[{ by, unit }]`, required, empty
	// on the ordinary turn); `keeperResolve` wires `clock: keeperWrite.json`,
	// the new `keeperStep` (`core:task/clock-step@1`) decides it, and the
	// trusted arm moves the clock through Advance story clock
	// (`commit.trusted.keeperClock`) — the reviewed arm proposes the clock line;
	// `keeperStep` wires `unless: input.messageId`, so a re-driven reply never
	// moves the clock twice. Edited in place under the freeze. Measured with
	// other lanes' in-flight core-catalog edits in the tree. (was
	// "1a9cc622606e38")
	// Moved 2026-10-13 (live scenes §15 G4–G7, lane H): the keeper's trusted
	// clock outlet says `cause: 'keeper'` and `onRefusal: 'skip'`; `keeperStep`'s
	// `unless` is `input.continuationPrefill` — an extend never moves the clock
	// twice, a regenerate or a swipe moves it anew (the old move went back with
	// the old reply). Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "1185045ca49580")
	"core:spec/story-respond@1.0.0": "18695a640a1593",
	// ⚠ MOVED, unreleased-genre terms (R-8, 2026-09-15): the three actions'
	// `contextBudget` shares the writing step's connection for the model's
	// own window, like every other budget node.
	// (was "17e9e37a86a2c2")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "eb29ca84d5098")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): a `lore` concat now sits between
	// the keyword scan and `rank`, carrying the conversation's band intent
	// beside the scan's candidates — a ranker takes one list and the intent
	// needs a seat in it. (was "11669b8b5b66fd")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "15e41a328459f3")
	// (was "197bb42b7b2bb6") — W9 shape pins, see the note above adventure-ask.
	// Hash moved (plans/31 V2, 2026-09-17): every action spec below lost
	// `contributes.actions[].function` — the key is the identity, and the
	// compiled document carries one word for it. Content of the
	// contribution, not of the run. The 28 old hashes are in git.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '15bfea21b5acfe')
	// Moved 2026-09-28 (action legend): its action now carries the required
	// `description`. Proven: with `description` stripped from its actions, the
	// document hashes back to the old pin. (was "15ca173678f13")
	// Moved 2026-10-01 (post-history trigger, owner ruling): a new default preset (`default`, "Default") ships `postHistoryTokenTrigger: 3000` on its `prompt` step — the step renders the session's growing history. Proven: a
	// copy of core-catalog/src with only this change reverted hashes back to the
	// old pin. (was "e40f2bd858568")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4). Edited
	// in place under the freeze, content-addressed, needing no re-projection (no
	// new preset value). Measured with other lanes' in-flight core-catalog edits
	// in the tree, not proven in isolation. (was "1af76de37abb11")
	// Moved 2026-10-03 (owner ruling: Look onto the scene builder): `context` is
	// `core:task/build-scene-context@1` (cast, state, fields, locationEntries),
	// a `gather.rooms` listing and the room rule's `place` step feeding `rank`'s
	// `shownElsewhere`, and the default preset ships the listing's and the
	// place's values. Edited in place; the preset values on new nodes reach an
	// install through re-projection 0111. (was "18f60ba20840f8")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "259d73182ba0e")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "e99170c35c4c0")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was 'd359d2d1b30f9')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '13a9a71d778ad4')
	"core:spec/story-look@1.0.0": "bd03062aad518",
	// ⚠ MOVED, in place, on the same unreleased-genre terms: Rest and Time
	// passes ask `core:oracle/generate-json@1` for the keeper's own shape
	// instead of parsing prose out of a prefilled reply.
	// (was "eaa7a41b6cd8c" — R-8, see `adventure-look`)
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "1dea5cfc5a78d2")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "4e32a33712802")
	// (was "3755831896611") — W9 shape pins, see the note above adventure-ask.
	// (was "1a5601d7f3d4c") — `base` wired, U5f; see adventure-respond.
	// Moved 2026-09-27 (owner ruling): the same item-arm rename (keeper schema + `write` path); proven: core-catalog/src with those edits reverted hashes to the old pin (was "1594b5fa34f7cc").
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '26b527a812aa')
	// Moved 2026-09-28 (action legend): its action now carries the required
	// `description`. Proven: with `description` stripped from its actions, the
	// document hashes back to the old pin. (was "35793c9c2f752")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "fb3f827cea808")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1e969901b72f1")
	// Moved 2026-10-13 (live scenes lane F, ★3 — the keeper's clock proposal):
	// the keeper schema gains a `clock` list (`[{ by, unit }]`, required, empty
	// on the ordinary turn); `resolve` wires `clock: write.json`, `keeperStep`
	// decides it, and the trusted arm moves the clock through Advance story
	// clock (`commit.trusted.keeperClock`). Edited in place under the freeze.
	// Measured with other lanes' in-flight core-catalog edits in the tree. (was
	// "202a8aa9f3791")
	// Moved 2026-10-13 (live scenes §15 G4–G7, lane H): Rest's trusted clock
	// outlet says `cause: 'keeper'` and `onRefusal: 'skip'`. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "1466f141e5dc14")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '8297e986b8bbc')
	// Moved 2026-10-21 (lane F1): the `commit` junction reads the reckoning's mode (`routineModes`, R55), not `applyActionChanges`. (was "1f294045d3a082")
	// Moved 2026-10-23 (core genres on the seams, merge GM): Rest names what the rules restore (`restores`, `core:script/story-rest-crib`, G1, S3) and applies at its own action's mode — the `commit` junction on the reckoning's mode is gone (GM, G1 ★3). Edited in place. (was "cda4746b28543")
	"core:spec/story-rest@1.0.0": "6eb5ec3a35902",
	// (was "135459cfe7c4c0" — R-8, see `adventure-look`)
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "e1c078298920d")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "17168783bd30d0")
	// (was "1173a06c378df0") — W9 shape pins, see the note above adventure-ask.
	// (was "283effed6289d") — `base` wired, U5f; see adventure-respond.
	// Moved 2026-09-27 (owner ruling): the same item-arm rename (keeper schema + `write` path); proven: core-catalog/src with those edits reverted hashes to the old pin (was "c9dfbd1a0aa41").
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '1dad606f0de694')
	// Moved 2026-09-28 (action legend): its action now carries the required
	// `description`. Proven: with `description` stripped from its actions, the
	// document hashes back to the old pin. (was "1133a732627f04")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "19809118179cf8")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "59b690f0cd3ef")
	// Moved 2026-10-13 (live scenes lane D, §6): *Time passes…* collects the
	// clock step on the stepper (the amount is the player's), and after the
	// keeper's commit the session's story clock moves by it — `step`
	// (`core:task/clock-step@1`) and Advance story clock behind a junction on
	// `moves`. Rest is unchanged. Edited in place under the freeze.
	// (was "9c0d7fb075d72")
	// Moved 2026-10-13 (live scenes lane F, ★3 — the keeper's clock proposal):
	// the keeper schema gains a `clock` list (`[{ by, unit }]`, required, empty
	// on the ordinary turn) — the shared schema only: the keeper's clock is
	// never wired here, the amount being the player's. Edited in place under the
	// freeze. Measured with other lanes' in-flight core-catalog edits in the
	// tree. (was "164e82a5d8d184")
	// Moved 2026-10-13 (live scenes §15 G4–G7, lane H): the keeper context
	// takes the press's `clockStep` (`{{clockStep}}`), and *Advance story clock*
	// says `cause: 'action'` and `onRefusal: 'skip'` — a story with no clock yet
	// skips the move with a ledger line instead of halting. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "1b7157728a8132")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '145dfed9e6763a')
	"core:spec/story-advance-time@1.0.0": "8af797de995bf",
	/**
	 * Forms (plans/29 R-15 *Forms*; 30 §U5d, 2026-09-17) — five new slugs,
	 * and the three create specs above move with their genre surface. The
	 * three `answer-form-*` are one graph published once per shipped genre
	 * (a preset binds a spec locked to its genre): `form-addressed` inlet →
	 * history + cast → the addressee's card → `form-context` → prose
	 * transcript → assemble (inline template) → `generate-json` against the
	 * form's schema → `answer-form`, which fires the block's action as the
	 * addressee. `adventure-ask` is the worked form — the narrator puts a
	 * question with choices to one of the cast — and `adventure-answer` is
	 * what its options fire, by a click or by the answer pipeline.
	 */
	/**
	 * ## The W9 shape pins (2026-09-17, U5d review) — fourteen moved at once
	 *
	 * `validate()` had never run over the catalog, and when it did (it runs
	 * at `saveDocument` now) thirteen shipped specs carried a 01 §3 finding:
	 * `session-history@1` DECLARED `context-candidates@1` on `main` and
	 * `messages` while PUBLISHING transcript rows — every one of them wires
	 * `history.messages` into `process-messages` / `prose-transcript` /
	 * `query-windows` / a turn strategy, which take `messages@1`. The
	 * declaration was wrong, not the rule: the port now says `messages@1`
	 * (the intent rides `band` alone, as it always did), `vector-search@1`'s
	 * `vectors` says `json@1` (a list of query vectors, which is what
	 * `embed-text@1` publishes and the host reads). An edge's compiled
	 * `shape` is part of the document, so every spec reading history moved;
	 * `adventure-answer` moved for its `form` venue (S1) and the answer-form
	 * specs for the outlet's timeout and two new out-ports (W2). Nothing the
	 * runs send changes. (W9 had also made `messages@1` assignable to
	 * `context-candidates@1` one way; the fix pass withdrew it — R-a — since
	 * no shipped spec wires the transcript as candidates, no pin moved.)
	 */
	// (was "b2c4f4431d9a2") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was 'f223539fbe04a')
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "358cb55e1154a")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '183f8263149ade')
	"core:spec/story-ask@1.0.0": "aaaf5626cd65b",
	// (was "1387dc7a4901d6") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '3f7d64a64b379')
	"core:spec/story-answer@1.0.0": "11d95fa0fe8f3e",
	// (was "a2ddb2700ce09") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '4398d5e3dcebc')
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` + `attached` (on `generate`'s pair) before `prompt`, and `{{{attachments}}}` in ANSWER_FORM_TEMPLATE's message loop.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "ef5be600b6ed7")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/answer-form-chat`; nothing else changed. (was "1a1744b015b27a")
	// I12 (2026-10-12): the Default config names its loadouts. (was "a10f3d0d9292d")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '105a87a0b6b917')
	"core:spec/story-answer-form@1.0.0": "17692d8f0cdab5",
	// (was "b89f3d6c0484b") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '837f6311648d6')
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` + `attached` (on `generate`'s pair) before `prompt`, and `{{{attachments}}}` in ANSWER_FORM_TEMPLATE's message loop.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "d38acc496a3c1")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/answer-form-adventure`; nothing else changed. (was "8175a60b3bfc4")
	// I12 (2026-10-12): the Default config names its loadouts. (was "9a0a93d0fce6f")
	// (was "1ddc286846b82d") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '1ff7e25eba1d7a')
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` + `attached` (on `generate`'s pair) before `prompt`, and `{{{attachments}}}` in ANSWER_FORM_TEMPLATE's message loop.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "811b474234fb8")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/answer-form-guide`; nothing else changed. (was "4cc69e9d12db0")
	// I12 (2026-10-12): the Default config names its loadouts. (was "ee8145c98c894")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '110dc3facd34ba')
	"core:spec/guide-answer-form@1.0.0": "1c9bdc6da0eb3a",
	"core:spec/create-chat@2.1.0": "ea80f2679383c",
	"core:spec/create-chat@2.0.0": "a6281141b21ea",
	// 1.16.0 / 1.10.0: the three lore gather branches and the narrator's trigger query
	// wire `params: slot.params()`. The executor resolves only the slots a
	// node's config names, so until now their declared parameters — Scan
	// Depth, Max Recursion Depth, Retrieval Mode — were handed over as
	// `undefined` on every run. The bump is what carries the wiring to an
	// install: seeding matches on (slug, semver), which is exactly what this
	// file exists to make loud.
	// 1.17.0: the three lore gather branches stop going through
	// `core:task/merge-candidates@1`, whose reciprocal-rank `presetScore`
	// overrode every signal weight downstream — the branches are disjoint, so
	// there was nothing for rank fusion to fuse and each entry ranked by its
	// position in its own list. `core:task/concat-candidates@1` instead.
	// 1.11.0: the narrator gets a `contextBudget` node, so `rank` has a budget
	// to select against. Without one `availableTokens` was 0 and the narrator
	// retrieved no lore at all.
	// 1.18.0: `core:query/entity-search@1` joins the three lore gather branches and is
	// concatenated **last**, so an entry the keyword scan already found keeps
	// its keyword signals and the new mechanism only ever adds rows no key reached.
	// It ships inert — both its caps default to 0, which is off — so the bump
	// carries the node to an install without changing any prompt until somebody
	// raises one.
	// 1.19.0: the fourth mechanism. `core:query/vector-search@1` has been built,
	// bound and tested since the decomposition and was wired into no shipped
	// spec at all; it joins the three lore gather branches and the entity mechanism at
	// `concat-candidates`, contributing `signals.semantic` as a **score
	// component** rather than an ordering to be fused. Its own `async` block
	// after `gather` — chains of a parallel block cannot read each other, and
	// the embed Provider on the spine would halt the debug preview. Ships off:
	// `vector-search.maxEntries` defaults to 0.
	// 1.20.0: the fifth mechanism. A `names` block — `mention-spans` → `embed`
	// → `entity-link` — and a `loreLinked` concatenation `rank` now reads
	// instead of `lore`. The mechanism matches the scene's *descriptions* ("the
	// captain") to an entry's *names* (Captain Vell) in a second vector space,
	// and it may only reorder: `entity-link` takes the candidate list on an
	// in-port and returns it enriched, with the unenriched list concatenated
	// behind it, so every way the mechanism can produce nothing lands on exactly what
	// the ranker would have seen without it. Ships off — `maxMentions` is 0, on
	// the first node of the chain, so nothing is read and nothing is embedded.
	//
	// ⚠ **1.20.0 and 1.11.0 moved WITHOUT a version bump, and that is the
	// exception this file's own rule names, not a breach of it.**
	//
	// The version freeze ruled for the 0.6 pre-release — "no SDK spec bumps;
	// all stay a hard 1 until 0.7.0" — leaves editing in place as the only way
	// to ship a spec change. The hazard the freeze creates is exactly the one
	// this file exists to catch: seeding matches on (slug, semver) and, on a
	// match, updates only the display name, so an in-place edit reaches NO
	// database that has already seeded and is invisible on a fresh test one.
	//
	// So the edit is paired with `drizzle/0095_prompt_format_reprojection.sql`,
	// which deletes the published `pipeline_spec_versions` rows for these two
	// pins so boot republishes them. **A moved hash here with no such migration
	// is still the failure this file is for** — updating a line to make the
	// suite green is only correct alongside the re-projection that carries the
	// change to an install.
	//
	// What moved: the `prompt` step gained `connection: slot.connectionOf(
	// "generate")`, so the render finally learns the wire format it is
	// rendering for. Nothing supplied it before — every prompt went out Vicuna
	// whatever the connection said, and the receipt reported the format that
	// was not used.
	// ## The narrator split, and the third in-place edit — answer 3 again
	//
	// `core:spec/narrate-character@1.0.0` is a NEW spec, which is the easy half:
	// a slug seeding has never seen publishes normally, and no migration is
	// involved. It is listed here for the same reason every other pin is —
	// the second test below refuses a published version this table does not
	// record.
	//
	// ⚠ `core:spec/narrate@1.11.0`'s hash MOVED, again without a bump, and
	// again paired with a migration — `drizzle/0100_narration_split_reprojection`
	// deletes its published `pipeline_spec_versions` row so boot republishes it.
	// **A moved hash here with no such migration is still the failure this file
	// is for.**
	//
	// What moved: the three retrieval mechanisms the reply pipeline gained in
	// its 1.18.0, 1.19.0 and 1.20.0 are wired into the narrator —
	// `entity-search`, the `semantic` arm and the `names` arm, concatenated in
	// respond's own argument order, with `rank` reading the linked pool instead
	// of the bare keyword lane. Until now this document wired the keyword
	// mechanism and the ranker and nothing else, so every retrieval control the
	// panel renders for a narrator reached nothing — the same
	// control-with-no-effect class the retrieval audit removed everywhere it
	// could see, hiding in the one pipeline its corpus does not render through.
	// All three ship off (every cap defaults to 0), so an upgraded install
	// retrieves exactly what it retrieved before.
	// ## The transcript window becomes a real control — answer 3, three pins
	//
	// ⚠ All three hashes below MOVED, again under unchanged versions, and again
	// paired with a migration — `drizzle/0110_session_history_limit.sql` deletes
	// the three published `pipeline_spec_versions` rows so boot republishes
	// them. **A moved hash here with no such migration is still the failure
	// this file is for.**
	//
	// What moved, identically in each: the `history` node wires
	// `params: slot.params()`. It never named the slot, and the executor
	// resolves only the slots a node's config names — so `limit`, "How many
	// recent messages are considered for the context", arrived as `undefined`
	// on every turn these three pipelines have ever taken and the binding fell
	// through to a literal 100. This is the third time this exact omission has
	// shipped (1.16.0/1.10.0 for the lore lanes, 1.10.0 for the narrator's
	// trigger query); it is the same one-line wiring and the same finding.
	//
	// Behaviour-preserving by construction: the declared default is 100 as of
	// this ruling, which is the literal the binding has been using, and 0110
	// lifts the stored 40s that `reconcileConfigs` back-filled from the old
	// declaration. An install at defaults reads the same 100 messages after this
	// as before it.
	// ## The reply step's own Connection and Sampling — answer 3, three pins
	//
	// ⚠ All three hashes below MOVED **again**, a second time under unchanged
	// versions, and again paired with a migration —
	// `drizzle/0111_reply_slots_and_relationship_cap.sql` deletes the three
	// published `pipeline_spec_versions` rows so boot republishes them. **A moved
	// hash here with no such migration is still the failure this file is for.**
	//
	// What moved, identically in each: the `generate` node wires
	// `connection: slot.connection()` and `sampling: slot.sampling()`. It is the
	// OWNER of both — `contextBudget` reads `slot.samplingOf("generate")` and
	// `prompt` reads `slot.connectionOf("generate")` — and it never named them
	// itself, so `refId(p.connection)` at the host read `null`,
	// `resolveCapabilityTarget` took that as "the pipeline chose nothing", and
	// the request went to the instance default while the budget and the wire
	// format followed the pick. One window sized the prompt and another received
	// it. Found by `boot/paramsSlotWiring.test.ts`, which had all six of these in
	// its ledger.
	//
	// ⚠ **NOT behaviour-preserving where somebody set the picker, deliberately.**
	// The pick was entered by a person and ignored; honouring it is the fix
	// (STATE-2026-09-08 §1, "Per-node sampling ignored"). An install that never
	// set one is unaffected — `resolveSlot` falls back to
	// `world.activeConnection[kind]`, projected from the same `connection_defaults`
	// row the `capabilityDefault` tier reads — and a session override still
	// outranks the pipeline's tier.
	// ## The ranker's allocation reaches the assembler — answer 3, three pins
	//
	// ⚠ All three hashes below MOVED **again**, a third time under unchanged
	// versions, and again paired with a migration —
	// `drizzle/0113_declared_ports_and_rank_groups.sql` deletes the three
	// published `pipeline_spec_versions` rows so boot republishes them. **A moved
	// hash here with no such migration is still the failure this file is for.**
	//
	// What moved, identically in each: the `prompt` node wires
	// `groups: $.rank.groups` (D-H). `core:task/rank-hybrid@1` has published what
	// each retrieval band was allotted, spent and filled since it was written,
	// and `core:task/assemble@2` has taken `allocate`'s own `?? {}` instead —
	// two adjacent nodes, one computing exactly what the other needed, with no
	// edge between them. Neither port was declared, which is why nothing said
	// so; `boot/registryHashes.test.ts` records both declarations moving in the
	// same change.
	//
	// ⚠ **Behaviour-preserving, and checkably so.** `allocate` copies `groups`
	// onto `AllocatedContext.groups` and reads it nowhere else, so `blocks`,
	// `totalTokens` and `budget` — everything `render` walks — are the same
	// bytes with the edge or without it. The parity corpus is the evidence: all
	// sixteen goldens are byte-identical across this change. What fills in is the
	// RECEIPT — `dispatch.ts` publishes `payload.groups` as the run's `sources`,
	// which is the budget panel's entire data set and has been an empty object on
	// every run ever recorded.
	// (was "127bfb179f55dd", then "13d5772f33e5ec", then "9cfae9a28583f",
	//  then "17c8c28ac7fd7f")
	// ⚠ MOVED (09-B B4, R-17, 2026-09-15): the pipeline owns its row. A
	// `placeholder` outlet straight after the inlet creates the narration row
	// — the speaker fact and the instructions beside it — and `save` is an
	// `update-message` filling it; `contextBudget` shares the generating
	// step's connection for the model's own window (R-8). The trigger inserts
	// nothing any more. Under the 0.6 freeze the semver stays.
	// (was "1a1055550a18d6")
	// ⚠ MOVED again (U1 review C1, 2026-09-16): the placeholder wires
	// `row: $.input.messageId`, as `respond`'s does — a regenerate, swipe or
	// continue on a side character's line routes back here, and without the
	// wire this node inserted a second row while the verb's spun forever.
	// (was "1ef5a87d5d82cd")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "b85fb72d78a44")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "1dcc060b10f7fb")
	// Hash moved (U5a, R-18 (3), 2026-09-16): the side-character fact rides
	// `$.input.sideCharacter` into the placeholder and the context builder
	// (was `$.input.speaker`; that port is the participant reference now).
	// Same fact, same row, same prompt. (was "6ddff19a519fb")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "1e7b25867803a2")
	// Hash moved (2026-09-16): the placeholder wires `speaker:
	// $.input.speaker` — the inlet's participant reference — so a picked
	// character's row carries `metadata.speaker = character:<id>`, the same
	// shape 0138 writes for a migrated row. (was "e3ab80dc58afa")
	// (was "174220ef023ed7") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '199a1f680b0bc3')
	// Moved 2026-09-28 (action legend): its action now carries the required
	// `description`. Proven: with `description` stripped from its actions, the
	// document hashes back to the old pin. (was "f3c5ad02f3015")
	// Moved 2026-09-29 (genre uplift C2): `context` wires `turnDirection:
	// $.input.text` — the narrator modal's text, which only the placeholder
	// stored. Proven: with that edge and config key deleted, the document
	// hashes back to the old pin. (was "6043f75b3991a")
	// Moved 2026-09-29 (genre uplift F1, Search by meaning is Automatic):
	// `semantic.arm.queries` wires `connection:
	// slot.connectionOf('semantic.arm.embed')` — the embedding connection, for
	// whether one is set up (until 2026-09-30, for whether it ran on this
	// machine; the wiring did not move with the rule). Proven: core-catalog/src and
	// contracts/src copied with only F1's edits reverted (that wiring, the
	// query-windows slot and three-valued switch) hash back to the old pin.
	// (was "1087874f5efd87")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "18801db79f4cd2")
	// Moved 2026-10-01 (post-history trigger, owner ruling): a new default preset (`default`, "Default") ships `postHistoryTokenTrigger: 3000` on its `prompt` step — the step renders the session's growing history. Proven: a
	// copy of core-catalog/src with only this change reverted hashes back to the
	// old pin. (was "e448ab0292fdf")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4). Edited
	// in place under the freeze, content-addressed, needing no re-projection (no
	// new preset value). Measured with other lanes' in-flight core-catalog edits
	// in the tree, not proven in isolation. (was "5e0f43d562fd3")
	// Moved 2026-10-02 (composer attachments phase 4, PLAN §3.5): a
	// `history-attachments` read and a `place-attachments` step before each
	// reading call's prompt; the prompt reads the placed lines. Edited in
	// place under the freeze. (was "73ccf84e353e1")
	// Moved 2026-10-03 (owner note 39): `save` wires `reasoning` — the port
	// `thinking` -> `reasoning` on generate-text / update-message. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "2974935a40dd4")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "ed49d36f3f595")
	// Moved 2026-10-05 (sprites in-pipeline, plan D1/D-b; owner: "not a
	// wrapper"): the retired `withSpriteTail` nodes give way to the sprite step
	// written out after `save` — `spritePick` (`core:oracle/pick-sprite@1`,
	// handed the reply's text and speaker) and `spriteShow` (`source:
	// 'picker'`). And D-c: the retrieval arms' embed steps lose their
	// `connection` slot, and `semantic.arm.queries` wires its own
	// (`slot.connection()`). Edited in place under the freeze. Measured with other lanes'
	// in-flight core-catalog edits in the tree. (was "1fa23cc37eaad0")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/narrate-character`; nothing else changed. (was "8bfbf7d9b46e9")
	// I12 (2026-10-12): the Default config names its loadouts. (was "15899aae9ed73d")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '142a27f931338')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O5/O7/O9): the `heard` transcribe-audio step before placement, `generate`'s speech sampling, `save`'s parts; every `generate-text` node names its speech sampling. Edited in place. (was '1bc0aee4f58ea7')
	// Moved 2026-10-21 (PLAN-layering repair 1): the `heard` step declares no status — a declared one shows on every run; the step says *listening* only when it hears. (was "15aa6f9a036898")
	"core:spec/story-side-character@1.0.0": "1f9200326c48e5",
	// (was "b6ba835e86244", then "431aa4254af1", then "12971669b900fd",
	//  then "bc304a8a52b71")
	// ⚠ MOVED on the same terms as `narrate-character` above (09-B B4):
	// placeholder → update, the instructions stored beside the row by the
	// placeholder, the connection shared onto `contextBudget`.
	// (was "1276c81165cdd1")
	// ⚠ MOVED again (U1 review C1, 2026-09-16): `row: $.input.messageId` on
	// the placeholder — the paragraph above `narrate-character@1.0.0`, for the
	// verb on a narration row.
	// (was "8d82b49922817")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "1dae47bcb08545")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "1be02ac2c726fc")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "11ca2223b19a22")
	// (was "3d0b93608ab5b") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was 'd361fe0665805')
	// Moved 2026-09-28 (action legend): its action now carries the required
	// `description`. Proven: with `description` stripped from its actions, the
	// document hashes back to the old pin. (was "c6565cafeca6e")
	// Moved 2026-09-29 (genre uplift C2): the action declares `collects.text`
	// (optional, _What should happen next?_) and `context` wires
	// `turnDirection: $.input.text`. Proven: with the collects and that edge
	// and config key deleted, the document hashes back to the old pin.
	// (was "1dd6ec23b03422")
	// Moved 2026-09-29 (genre uplift F1, Search by meaning is Automatic):
	// `semantic.arm.queries` wires `connection:
	// slot.connectionOf('semantic.arm.embed')` — the embedding connection, for
	// whether one is set up (until 2026-09-30, for whether it ran on this
	// machine; the wiring did not move with the rule). Proven: core-catalog/src and
	// contracts/src copied with only F1's edits reverted (that wiring, the
	// query-windows slot and three-valued switch) hash back to the old pin.
	// (was "1639a309a15c5c")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "3a079aaa9f29d")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4). Edited
	// in place under the freeze, content-addressed, needing no re-projection (no
	// new preset value). Measured with other lanes' in-flight core-catalog edits
	// in the tree, not proven in isolation. (was "15dea968ecfcc3")
	// Moved 2026-10-02 (composer attachments phase 4, PLAN §3.5): a
	// `history-attachments` read and a `place-attachments` step before each
	// reading call's prompt; the prompt reads the placed lines. Edited in
	// place under the freeze. (was "2f90a45b4fbd7")
	// Moved 2026-10-03 (owner note 39): `save` wires `reasoning` — the port
	// `thinking` -> `reasoning` on generate-text / update-message. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "19a874834d9f7e")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "a539352dbc260")
	// Moved 2026-10-05 (sprites in-pipeline, plan D-a): gains the sprite step
	// after `save` — `spritePick` (`core:oracle/pick-sprite@1`, handed the
	// narration's text and no speaker, so it picks nothing) and `spriteShow` (`source: 'picker'`). And D-c: the retrieval arms' embed steps lose their
	// `connection` slot, and `semantic.arm.queries` wires its own
	// (`slot.connection()`). Edited in place under the freeze. Measured with other lanes'
	// in-flight core-catalog edits in the tree. (was "a98a294e26041")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/narrate`; nothing else changed. (was "cdba24cd29eaf")
	// I12 (2026-10-12): the Default config names its loadouts. (was "1890d6de7d7cfc")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1814fbb71316e4')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O5/O7/O9): the `heard` transcribe-audio step before placement, `generate`'s speech sampling, `save`'s parts; every `generate-text` node names its speech sampling. Edited in place. (was '1d69e112b9b8a2')
	// Moved 2026-10-21 (PLAN-layering repair 1): the `heard` step declares no status — a declared one shows on every run; the step says *listening* only when it hears. (was "14543f10b90f87")
	"core:spec/story-narrate@1.11.0": "1015774ca55aa6",
	// ⚠ `core:spec/respond@1.20.0`'s hash MOVED for the SECOND time without a
	// bump, on the same terms as the two paragraphs above and paired with
	// `drizzle/0106_continuation_prefill_reprojection`, which deletes its
	// published `pipeline_spec_versions` row so boot republishes it.
	//
	// What moved: the `lines` node wires
	// `continuationPrefill: $.input.continuationPrefill`, so the text a
	// **continue** is continuing reaches the seed line the model writes from
	// (ruling 2026-09-08, D-2). One edge. Byte-identical for every turn that is
	// not a continue — the port carries "" and the seed renders empty, exactly
	// as it always did.
	//
	// And a THIRD time, by the `history` node's `params` wiring — see the
	// paragraph above `narrate-character@1.0.0`, which moved for the same
	// one-line reason, and `drizzle/0110_session_history_limit.sql`.
	//
	// And a FOURTH time, by `drizzle/0111_reply_slots_and_relationship_cap.sql`,
	// carrying TWO edits rather than one. The `generate` node's `connection` and
	// `sampling` — the paragraph above `narrate-character@1.0.0`, which moved
	// for exactly that and nothing else — plus a change only this document has:
	// `gather.relationshipsPerspectives.read` and
	// `gather.relationshipsKnown.read` wire `params: slot.params()`, so "Most
	// relationships" reaches `capRelationships` instead of arriving as
	// `undefined`. That half IS behaviour-preserving, and the declaration is what
	// makes it so: `maxEntries` carries no default now — uncapped is not a number
	// `min: 0` can hold, and `undefined` is what every run has been reading — and
	// 0111 lifts the stored `12`s `reconcileConfigs` back-filled from the old
	// declaration. `boot/registryHashes.test.ts` records the two moved type
	// hashes in the same change.
	//
	// And a FIFTH time, by `drizzle/0113_declared_ports_and_rank_groups.sql` —
	// the `prompt` node's `groups` edge, the paragraph above
	// `narrate-character@1.0.0`, which all three moved for and nothing else.
	//
	// And a SIXTH time, by `drizzle/0115_config_deviations.sql`, on the same
	// terms and for the last of the three shapes `paramsSlotWiring.test.ts`
	// tracks: the `generate` node wires `params: slot.params()`, so the stop
	// sequences a person types reach `input?.params?.stopSequences` instead of
	// arriving as `undefined`. Behaviour-preserving, and the declaration is what
	// makes it so — `core:oracle/generate-text@1` gives `stopSequences` no
	// default, so an install that never typed one resolves `undefined` exactly
	// as it always has. All three documents moved for this and nothing else;
	// `registryHashes.test.ts` records nothing, because no DECLARATION changed.
	//
	// And a SEVENTH time, by `drizzle/0118_relationship_search.sql`, on the same
	// terms and for the relationships ruling (2026-09-10, Q1). ⚠ This one is
	// respond's ALONE — the narrator has no speaker, and a graph read needs a
	// speaker's perspective, so the two narrate documents are untouched and
	// their pins below have not moved.
	//
	// What moved: `gather` gains a `relationships` branch pinning the new
	// `core:query/relationship-search@1`, and `loreLinked` concatenates its
	// candidates behind the two lists it already had. It reads the same three
	// graph layers the two existing relationship branches read — one traversal,
	// two projections, so they cannot disagree — and publishes them as
	// candidates in the `relationships` budget band, ordered scene presence →
	// speaker → recency.
	//
	// ⚠ **Byte-identical prompts, and the reason is a default rather than a
	// dead edge.** `rank-hybrid`'s `share.relationships` is 0, which `select`
	// reads as "leave this source out": every candidate the arm produces is
	// excluded with `excluded_group_disabled`, spends nothing, and renders
	// nowhere. What fills in is the RECEIPT — the graph appears in the
	// retrieval explanation with a rank reason per tie, which it never has.
	// `registryHashes.test.ts` records the new type as a NEW entry; no
	// published type declaration moved, so it re-projects nothing.
	//
	// And an EIGHTH time, closing the half of that ruling the seventh left open:
	// the ranked band reached allocation and the receipt and rendered NOWHERE.
	// `context` moves BELOW `rank` — nothing between them ever read it — and its
	// two relationship in-ports each carry `{ band: rank.candidates, graph: <the
	// dump> }`, so the prompt's relationship sections are built from what
	// ranking selected, in rank order, inside the band's share. ⚠ Still
	// byte-identical on a shipped install, and by the same default: with
	// `share.relationships` at 0 nothing is allocated and the `graph` half is
	// what renders, exactly as before. Respond's alone again — the narrator has
	// no speaker and no relationship ports. No declaration moved, so
	// `registryHashes.test.ts` records nothing.
	// (was "1f78a2ce64600", then "1bc665208daf27", then "196d136945332b",
	//  then "1586b6f70f4a1c", then "1799ea677e50b5", then "11ff0e3a9af9c9",
	//  then "40057185a1f3c")
	// ⚠ MOVED a THIRD time without a bump (09-B B4, R-17, 2026-09-15): the
	// reply creates its own row. `placeholder` (`create-message`, `generating:
	// true`, the inlet's `characterId` and the row a verb re-drives) sits
	// straight after the inlet, `save` is an `update-message` targeting it,
	// and `contextBudget` shares `generate`'s connection so the one window
	// computation (R-8) reads the model's own window. `generateResponse`'s
	// trigger-side insert and the preview-halt road are gone with it. Under
	// the 0.6 freeze the semver stays; declarations moved too, so
	// `registryHashes.test.ts` records five.
	// (was "1459d5e20d701a")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "18917086c3f34")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "19cac7b1208d4e")
	// Hash moved (U5a, R-18 (3), 2026-09-16): the turn strategy takes
	// `speaker: $.input.speaker` — the participant reference — beside the
	// bare `characterId`, so an envoy can be the trigger's pick. Every
	// downstream reader still takes `$.speaker.characterId`; nothing the run
	// sends changes. (was "1ace29594a6283")
	// (was "1c503cc437da52") — W9 shape pins, see the note above adventure-ask.
	"core:spec/respond@1.20.0": "1c2931c6f16055",
	"core:spec/respond@1.19.0": "fdf2f7090f13c",
	"core:spec/respond@1.18.0": "9315ce3ddeaa4",
	"core:spec/respond@1.17.0": "118378cf44739b",
	// Edited in place with respond@1.20.0, and re-projected by migration 0095 —
	// see the note there. ⚠ The hash recorded against this pin is the one
	// above, not this line: 1.11.0 was edited a *second* time, by the narrator
	// split. Kept here as the drift record of what it hashed to between the two
	// edits, the same way a superseded version is kept.
	// (was "540d1e252d8c9")
	"core:spec/respond@1.16.0": "1cf854da57fc1c",
	"core:spec/narrate@1.10.0": "1db2e9e9b859b4",
	"core:spec/respond@1.15.0": "f8768da5723e3",
	"core:spec/narrate@1.9.0": "1f7a1f6da815d7",
	// Pre-24 (the genre rename): superseded, kept for the drift check.
	"core:spec/create-chat@1.0.0": "e176f2e63375",
	// 1.14.0 / 1.8.0: mode references re-keyed to the create spec (23 §7) —
	// taxonomy.mode and narrate's contributed trigger now name
	// core:spec/create-chat instead of the input type.
	"core:spec/respond@1.14.0": "4e7dcba7841ab",
	"core:spec/narrate@1.8.0": "124ccd9f3b3758",
	// 1.13.0 / 1.7.0 / 1.3.0 / 1.2.0: the catalogue claims (23 §2) —
	// `taxonomy` {zone, role, mode} rides every document.
	"core:spec/respond@1.13.0": "f7c71609c1181",
	"core:spec/narrate@1.7.0": "1e8300f1868ebe",
	// ⚠ 1.3.0's four hashes MOVED under an unchanged version, paired with
	// `drizzle/0102_summarize_batch_budget.sql`, which deletes the four
	// `pipeline_spec_versions` rows so boot republishes them. The version freeze
	// (SDK spec versions pinned at 1 until 0.7.0) is why this is an edit in place
	// rather than 1.4.0, and 0095/0100 are the precedent for the pairing.
	//
	// What moved: the batching Task's `sampling` slot is wired as a REFERENCE to
	// the drafting Provider's (`slot.samplingOf("drafting.item.draft")`), so the
	// window the batch is clamped to is by construction the window it is sent
	// against. Shared rather than a picker of its own — a slot wired with
	// `ofNode` is the owner's to configure (13 §12 finding i) — so an untouched
	// pipeline gains no second Sampling control in the panel.
	// Moved (L3, contracts batch 2, 2026-09-17): `params: slot.params()` on
	// the `create-lore-entry` node. That outlet now declares an `entryType`
	// parameters slot, and a slot the spec never NAMES is not a config key
	// — the panel would render the control, the scope chain would store
	// what a person set, and the run would never read it
	// (`paramsSlotWiring.test.ts`). The value is unchanged: the declared
	// default is world lore, which is what this outlet wrote before.
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "1506542abb583c"; before that, 6a5f107fa3641)
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an `attachments` query (history-attachments) wired into `batches`, which names each file after its message's text and counts it in the cut.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1b308b18a35d96")
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "17b311b14fdba7")
	// I12 (2026-10-12): the Default config names its loadouts. (was "8bc929819eff7")
	// Moved 2026-10-21 (lane F1): declares its `summarize-world` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "16b18ff001d740")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the transcript, `entryType` world lore declared. (was "5761942287ba5")
	"core:spec/summarize-world@1.3.0": "14f8e9c687ee1e",
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "a8021c35f8e63"; before that, 102b4ae06e92a1)
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an `attachments` query (history-attachments) wired into `batches`, which names each file after its message's text and counts it in the cut.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1bad3c7575bf71")
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "1832ba27d42a06")
	// I12 (2026-10-12): the Default config names its loadouts. (was "28cbabf6ea61b")
	// Moved 2026-10-21 (lane F1): declares its `summarize-character` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "a1ba26c4e2971")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the transcript, `entryType` character lore declared. (was "6db76b9e73bdc")
	"core:spec/summarize-character@1.3.0": "1b9730f33d1b7f",
	// ⚠ `summarize-scene@1.3.0`'s hash MOVED a SECOND time, again under an
	// unchanged version, and again paired with a migration —
	// `drizzle/0104_ice_scene_cast_extraction.sql` deletes its published
	// `pipeline_spec_versions` row so boot republishes it. **A moved hash here
	// with no such migration is still the failure this file is for.**
	//
	// What moved: the `cast` step is gone. `core:oracle/extract-cast` is on
	// ice, not deleted (plan §2, ruled 2026-09-08) — the node type, its script
	// hooks and its shipped prompt all survive untouched, and reviving it is
	// restoring one property in the catalog. The scene summarizer stops making
	// an unmeasured LLM call whose participant half is replaced by a roster +
	// speech-gated proposal (100% precision, zero fabrications, no model) and
	// whose mentioned half is derived from `message_annotations` instead.
	// (was "9c990d835747a" between 0102 and this)
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "45c69db1aec6e"; before that, 63c1e956ffead)
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an `attachments` query (history-attachments) wired into `batches`, which names each file after its message's text and counts it in the cut.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1ba1f48dae9bdb")
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "7469e93c1c11c")
	// I12 (2026-10-12): the Default config names its loadouts. (was "e0c98ab5632b4")
	// Moved 2026-10-21 (lane F1): declares its `summarize-scene` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "d99dc8578d801")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the transcript, `entryType` history declared. (was "1507a157e60f91")
	// Moved 2026-10-25 (pr-6 B4): every summarize-scene spec contributes the close-out action; summaries register it with minAge 0. (was "bcb17811f1334")
	"core:spec/summarize-scene@1.3.0": "62e0969c66c68",
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "c6076cc61089a"; before that, d31fcf98fd3d6)
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an `attachments` query (history-attachments) wired into `batches`, which names each file after its message's text and counts it in the cut.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "6a6de8aef8046")
	// Moved 2026-10-05 (role, PLAN-catalogue-and-pipeline-names N3): role `maintenance`, a background lane. (was "1f93de35465e8c")
	// I12 (2026-10-12): the Default config names its loadouts. (was "49cbc8b7ae8dc")
	// Moved 2026-10-21 (lane F1): declares its `summarize-history` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "1a30e9b006458")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the transcript, `entryType` history declared. (was "1940840a09ff76")
	"core:spec/summarize-history@1.3.0": "cd13d24d4094b",
	// 🚧 New 2026-10-13 (live scenes §13–§14): each core genre's own
	// summarize-scene, built by `summarizeScene()` — the scene's range
	// (`summarize-source@2`), its story rows' files (`history-attachments`),
	// the genre's transcript template (`render-transcript@1`), batches of
	// text (`batch-messages@2`), then the shared drafting, synth and naming.
	// Lane A measured "4b6c20c3e215f" / "1c78cf7589fb4f" / "fa5a8af464429" /
	// "668a24f84a6fb" before the reconcile restored the attachment names.
	// Moved 2026-10-13 (live scenes lane E): the aside rows' files are read
	// too (`asideAttachments`, a second history-attachments@1, wired to
	// render's new `asideAttachments` port) and each template's `aside`
	// section names them after its text. (were "655ef144e49ad" /
	// "13274d70ec4b86" / "d0c7ff2c75ec2" / "159e471ba7353a")
	// Moved 2026-10-13 (live scenes fix-ups): the aside read is headed
	// *Transcript aside attachments* (`expose.label`), so a Combining group
	// never shows two steps headed "History attachments". (were
	// "d6d9936a441b" / "150185e62c94a9" / "69c16d2df4303" / "d410ef541cb80")
	// Moved 2026-10-21 (lane F1): declares its `summarize-scene` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "119ee8ce3f667f")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the scene's story rows, `entryType` history declared. (was "1ad856ab45f64f")
	// Moved 2026-10-25 (pr-6 B4): every summarize-scene spec contributes the close-out action; summaries register it with minAge 0. (was "16ed70b70a8b40")
	"core:spec/story-summarize-scene@1.0.0": "a6aee5af27e2f",
	// Moved 2026-10-21 (lane F1): declares its `summarize-scene` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "9c19042ad22a0")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the scene's story rows, `entryType` history declared. (was "1f9d6798655f8b")
	// Moved 2026-10-25 (pr-6 B4): every summarize-scene spec contributes the close-out action; summaries register it with minAge 0. (was "1f16042b617a7")
	"core:spec/guide-summarize-scene@1.0.0": "1f1ee56640bf36",
	// The Lair's reads the Sanctum as asides, through its own template.
	// Moved 2026-10-13 (live scenes §15 G1, ★9): it carries the Lair's own
	// boundary trigger, `contributes.boundaryTriggers` (a new floor on main).
	// (was "14ef483fc1f337")
	// Moved 2026-10-21 (lane F1): declares its `summarize-scene` action (an audience naming nobody — the host fires it), inlet `{ suits: [] }` (R50). (was "69777beaaf6a6")
	// Moved 2026-10-21 (Lair rewrite L3): the floor boundary trigger is gone (no dungeon-floor tracking). (was "485ef62767a03")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `save` is `rememberNote`: `sources` wired from the scene's story rows, `entryType` history declared. (was "249eb28ab0204")
	// Moved 2026-10-25 (pr-6 B4): every summarize-scene spec contributes the close-out action; summaries register it with minAge 0. (was "eadef3540cfdf")
	"core:spec/lair-summarize-scene@1.0.0": "8217737712bc2",
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "1cb6f0d989e99c")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): `propose` wires `sources` from the scenes it walked. (was "17b96dc6b3f539")
	"core:spec/graph-build@1.2.0": "26ee0f1d808d5",
	// 1.12.0: the session rename (0141) — session-scope/-history/-cast ids
	// and sessionId/sessionScope ports ripple into every pinned type.
	"core:spec/respond@1.12.0": "72df744027f6d",
	// 1.11.0: turn-taking becomes a node (19 §5, U-C4) — the `speaker` task
	// records the trigger's pick, and context + generation take their
	// speaker from its output instead of only from the run scope.
	"core:spec/respond@1.11.0": "8ae7ccbf18fae",
	// 1.6.0: the session rename, as above.
	"core:spec/narrate@1.6.0": "1e7f35cc2ddaaa",
	// 1.5.0: declares `contributes.triggers` — the narrate button on the
	// standard mode is now a fact in the document, not a branch in
	// generateResponse (19 §3–§4, U-C3).
	"core:spec/narrate@1.5.0": "1bfa0898d8db15",
	"core:spec/summarize-world@1.2.0": "11dc51df9014b",
	"core:spec/summarize-character@1.2.0": "460b20537ef94",
	"core:spec/summarize-scene@1.2.0": "42b49662a7449",
	"core:spec/summarize-history@1.2.0": "235d7d8abbef1",
	"core:spec/graph-build@1.1.0": "122aaab2d9ed79",
	// core:spec/echo@1.0.0 was here until 2026-10-02: the review-gate demo
	// action, removed with its `/echo` slash (owner note 35). (was "11ae37dfe16695")
	// 2026-09-26: annex fields — core's one pipeline for every declared field.
	// Moved 2026-10-05 (lock, PLAN-catalogue-and-pipeline-names N3): its inlet loses the Chat lock. (was "7e5c1e7091921")
	"core:spec/set-annex-field@1.0.0": "1fc239ad46fb2d",
	// 🚧 A person's message, saved through the pipeline (owner ruling 2026-10-15).
	"core:spec/save-message@1.0.0": "17c4e2a15296cd",
	/**
	 * The built-in writes (U5b, R-15, 2026-09-16) — five NEW slugs, one per
	 * message verb core implements: `core:inlet/built-in-request@1` straight
	 * into the write outlet, bound to no genre. Published like every other
	 * spec so a delete is a receipted, gate-eligible run pinning a hash.
	 */
	"core:spec/builtin-delete@1.0.0": "12f3d9411b2680",
	"core:spec/builtin-hide@1.0.0": "2d89ebfc08d47",
	"core:spec/builtin-edit@1.0.0": "1f50517efb4c61",
	"core:spec/builtin-swipe@1.0.0": "b69ef788e2df7",
	"core:spec/builtin-branch@1.0.0": "be5ac081454e9",
	// A person's pick of a line's sprite (DESIGN-sprites §6). NEW — not a
	// built-in (its outlet is also placed by the reply specs' sprite tail).
	// The five reply specs above moved in place for the tail; re-projected by
	// drizzle/0169_sprite_tail_reprojection.
	// Moved 2026-10-05 (plan D1): the outlet states `source: 'person'`, which
	// the host decided from this spec's id until then. Edited in place under
	// the freeze. (was "1546b4989f83e5")
	"core:spec/show-sprite@1.0.0": "17dc7bd666c9b9",
	// 1.0.0: local image generation end to end — a composer button, the review
	// gate as the prompt entry, and the render posted as a message.
	// Hash moved: `render` names its `params` slot, which the node type now
	// declares — without it the streaming control would render and do nothing.
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "19338b1db2497c")
	// Moved 2026-09-28 (action legend): its action now carries the required
	// `description`. Proven: with `description` stripped from its actions, the
	// document hashes back to the old pin. (was "167183f5f621cc")
	// Moved 2026-09-28 (lair re-plan R3, `collects`): its action declares `collects.text` ('What
	// should the image show?', required) — it read `$.input.text` and got none since B10 — and the
	// description says _Describe an image_. Proven: the built document with `collects` deleted and
	// the old description hashes back to the old pin. (was "98d860e73c870")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/generate-image`; nothing else changed. (was "13c2fc5dd571ad")
	// 1.1.0 (2026-10-11, PLAN-less-confusing D2): the `review-on` preset is no
	// longer the default and is relabelled "Review the prompt before
	// rendering", so the action's own form is the one prompt entry. A bump,
	// not a move: 1.0.0 stays what it was. (1.0.0 was "136d2be67a5584")
	// I12 (2026-10-12): the Default config names its loadouts; measured with
	// lane A4's (I7a) `workflow: slot.workflow()` wiring on the render node in
	// the tree. (was "1f4f95d38c8c86")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was 'afcb4a23d1cbc')
	"core:spec/story-generate-image@1.1.0": "235ebebbafe60",
	// 🚧 1.0.0 (image generation I5, 2026-10-12): the Sprite set fill — a card
	// action from the Sprites tab, no session: build-sprite-series → generate-
	// image (series, likeness references, one seed per run) → cut-out →
	// attach-sprite. A new spec: no migration.
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1a4b358b7d51d3')
	"core:spec/sprite-set-fill@1.0.0": "15598708863480", // 2026-10-12 sweep: Default preset names core:loadout/sprites@1
	// Image generation I8 (2026-10-12): Portrait — a card action from the
	// Gallery tab. New spec.
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '438207384f24e')
	"core:spec/character-portrait@1.0.0": "78a91b905834b", // 2026-10-12 sweep: both presets name core:loadout/portrait@1
	"core:spec/describe-likeness@1.0.0": "bb28ace5bf811", // D1 2026-10-12: Describe from image — a card action, no loadout
	// Image generation I9 (lane C3, 2026-10-12): the Scene action — a quiet
	// scene prompt off the last lines, the picture with the likeness images
	// as references, posted and/or set as the backdrop. A new slug.
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '78e8e1adf0d59')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was 'dd093ed71a4be')
	"core:spec/story-illustrate-scene@1.0.0": "1c5a6e00dbb9e4", // 2026-10-12 sweep: purposes on the two calls
	// §16 follow-up D3 (2026-10-12): the same Scene graph with Adventure's
	// inlet (`shared/illustrateScene.ts`; an inlet is one genre's). A new slug.
	// Chat's hash above did not move when its graph was lifted into the shared
	// builder.
	// 1.0.0: the tool-loop reference (20 §9, 01 §4a) — a bounded agentic turn
	// written out, bound to no genre so it is never offered in a composer. New
	// slug, not a bump: the 0.6 freeze forbids moving an existing semver and
	// says nothing about publishing a new one.
	// Hash moved: `generate`'s dead `prompts` share now points at `prompt`,
	// which owns the pool, instead of the reverse (2026-09-10).
	// Hash moved: the template's opening instruction and its closing reminder
	// are the `prompts` slot's shipped row now, not literals (2026-09-10).
	// Hash moved (09-B B4, 2026-09-15): the answer's row is the pipeline's —
	// a `placeholder` after the inlet, `save` an `update-message` filling it.
	// (was "1802d01a31438f")
	// Hash moved (U1 review C1, 2026-09-16): the placeholder wires
	// `row: $.input.messageId`, so a genre binding this spec to a reply
	// function has a regenerate claim the verb's row as the reply specs do.
	// (was "1aa8631e70603b")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "9420cfdf9c246")
	// (was "1d560d3f202dd5") — W9 shape pins, see the note above adventure-ask.
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '182cfadc250d12')
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "e8f879ce23fa7")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): placement steps outside the loop, and the template's conversation section walks `sessionMessages` (it read `{{{chatMessages}}}`, which nothing supplies — the transcript never rendered).
	// ⚠ So this prompt moved for every run, files or none — the one spec
	// here outside the parity guard. (was "17e31a156cbbd1")
	// Moved 2026-10-05 (sprites in-pipeline, plan D1/D-b; owner: "not a
	// wrapper"): the retired `withSpriteTail` nodes give way to the sprite step
	// written out after `save` — `spritePick` (`core:oracle/pick-sprite@1`,
	// handed the reply's text and speaker) and `spriteShow` (`source:
	// 'picker'`). Edited in place under the freeze. Measured with other lanes'
	// in-flight core-catalog edits in the tree. (was "1978e9fb475a8")
	// 2026-10-05 (PLAN-catalogue-and-pipeline-names N3): left `CORE_SPECS` — a reference spec, no longer
	// seeded — so this pin is a record and checks nothing; the SDK's own tests pin it.
	"core:spec/tool-loop@1.0.0": "94d7aa42be32b",
	/**
	 * The **Lair** genre (plans/genres-and-showcase-plugins §3, U3) — nine new
	 * slugs, and nothing above them moves. Every node they pin is one core
	 * already shipped; no existing spec or type was edited.
	 *
	 * `lair-respond` is the reverse crawler's turn — the Castellan's (R8,
	 * 2026-09-28): plan, then a junction that either halts at a room nobody
	 * built (a Castellan question with a `choices` block addressed to the
	 * OWNER) or plays — the beats row in the Sanctum, then one voice call per
	 * character the planner named, the first streamed. Narrate is its own
	 * branch, routed first. Each branch opens its own row (F7 per execution
	 * path).
	 *
	 * ⚠ **Recorded before the catalog's `dist` carries them.** These pins were
	 * computed from `core-catalog/src` (the SDK suite's `lair.test.ts` records
	 * the same nine), and this file reads the catalog through its **build**. So
	 * until `npm run sdk:build` runs, `current()` does not contain these keys and
	 * the first test skips them by construction (`now[pin] &&`) — they start
	 * being checked the moment the build catches up, which is exactly when a
	 * drift would matter.
	 */
	// Moved 2026-09-27 (lair pass B9): the genre's `events` map gains `message-deleted` and
	// `message-hidden`, so Continue re-decides after a delete or a hide.
	// Proven: with those two event ids removed, the document hashes back to
	// the old pin. (was '14053b92f897da')
	// Moved 2026-09-27 (lair pass B7, owner D4): the genre declares
	// `messageVerbs: { continue: false }`. Proven: a copy of core-catalog/src
	// without that line hashes back to the old pin. (was 'c72c2e0357622')
	// Moved 2026-09-28 (rename, NOMENCLATURE §25): `messageVerbs: { continue:
	// false }` is `{ extend: false }` (the verb is `core#extend`). Proven: a
	// copy of core-catalog/src with only that key reverted hashes back to the
	// old pin. (was '13a122e59e48b8')
	// Moved 2026-09-28 (enum option labels on genre fields; proven in the SDK pin tests); was 4cc43f9196f51.
	// Moved 2026-09-28 (lair re-plan R12, cast only): the embedded Lair shape drops
	// `fields.turnStyle` and Pick's present-when; proven in the SDK pin tests
	// (canonical diff, dist vs source). (was "db68e32f7f418")
	// Moved 2026-09-28 (lair re-plan R2, retake): the embedded Lair shape
	// declares `turnControls.retake: true`. Proven in the SDK pin tests: the
	// built document with that one key deleted hashes back to the old pin.
	// (was "599f52f417f68")
	// Moved 2026-09-28 (lair re-plan R4, playerLabel): the create spec's `genre`
	// row carries `playerLabel: { en: 'Dungeon Master' }`. Proven in the SDK pin
	// tests: the built document with `genre.playerLabel` deleted hashes back to
	// the old pin. (was "12208c611c679e")
	// Moved 2026-09-28 (lair re-plan R6): `genre.envoys` (the Castellan) and
	// `channels` (the Sanctum), and the greeting read and write (`welcome`,
	// `greet.greets.write`, preset `lair`). Proven (SDK and app pins alike): the SDK sources copied with only R6's edits reverted hash back to the old pin. (was "114844f1333859")
	// Moved 2026-09-28 (lair re-plan R13): the embedded Lair shape declares
	// `fields.sanctumSteers` (on by default) and relabels `trustNarrator`
	// (_Apply the Castellan's stat changes without asking_); the Castellan's
	// prompt reads `{{sanctumSteers}}` and `{{scratchpad}}`. Proven (SDK and
	// app pins alike): the SDK sources copied with only R13's edits reverted
	// hash back to the old pin, and the golden with it. (was "1bc219796d240b")
	// Moved 2026-09-30 (Lair party speech, owner ruling): the embedded Lair
	// shape declares `fields.partySpeech` (_How the party speak_). Proven (SDK
	// and app pins alike): a copy of the SDK sources with only this lane's
	// edits reverted hashes back to this old pin, lair-respond's and the
	// golden. (was "cd14c9acfe99c")
	// Moved 2026-09-30 (Lair character turns, owner ruling): the embedded
	// shape's `partySpeech` description says each delver takes a turn of
	// their own. Proven (SDK and app pins alike): a copy of core-catalog/src with only this
	// lane's edits reverted (lair.ts, turnOrder.ts, genres.ts) hashes back to
	// every old Lair pin. (was "17398a61457451")
	// Moved 2026-10-13 (live scenes §15 G2): the embedded shape names the
	// Lair's place, `scenes: { place: { stateKey: "location" } }`. (was "b41ea5ad6054d")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1dff70c6bd68c1')
	// Moved 2026-10-21 (Lair rewrite L3): the embedded genre shape is the rewritten Lair's (personas min 0, sanctum audience owner, fields roomsLayer/askBeforeRolling/autoRoll/showDice; partySpeech and trustNarrator gone). (was "1d24f862baa0f3")
	// Moved 2026-10-21 (Lair rewrite L5): Auto roll's description says "the rules' usual difficulty" (§28). (was "8a34738f8b52d")
	// Moved 2026-10-22 (lair fix 2): the embedded shape labels `main` *Story* (the story's channel tab), and the Castellan's greeting says Narrate plays what it would. (was "1244f8cd5cbb03")
	// Moved 2026-10-22 (rulesets M2): the embedded shape's *Show dice* reads *Show outcomes* (the field id `showDice` kept). (was "9eeaaa394f17f")
	// Moved 2026-10-22 (rulesets M3): Auto roll's description says "When the rules decide", never "Under Rules and dice". (was "799554471956d")
	// Moved 2026-10-23 (core genres on the seams, merge GM): the Lair's relabels (_Ask me before each check_, _Decide checks at once_, _Show the outcomes_) and its recommended rulesets, in the genre shape it carries (lane G0, S6–S7). Edited in place. (was "c46bd3f8d3a77")
	// Moved 2026-10-23 (RF fix 2): the genre shape it carries says `lorebook: 'optional'` — 'required' is retired; a Lair session may start without a book (its own book is the dungeon). Edited in place. (was "1cb73ccca537ee")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): the genre it carries declares the Sanctum `lore: 'aside'` (pass 9 S1); the document is otherwise byte-identical. (was "1a7932ed813f14")
	"core:spec/lair-create@1.0.0": "d927ed6661005",
	// Moved twice on 2026-09-17. First (L3, contracts batch 2): `params:
	// slot.params()` on the `create-lore-entry` node. That outlet now declares
	// an `entryType` parameters slot, and a slot the spec never NAMES is not a
	// config key — the panel would render the control, the scope chain would
	// store what a person set, and the run would never read it
	// (`paramsSlotWiring.test.ts`).
	//
	// Then by the Lair finish lane, two preset values on that same node: the
	// review gate is turned ON (the docblock has promised it since the spec was
	// written, and `resolvePosition` defaults an undeclared position to `off`,
	// so a drafted room was landing unseen), and the entry type is
	// `core:entry/location` — a room is a place, not world lore that happens to
	// be laid out. The exits stay prose: `create-lore-entry@1`'s `links` port is
	// unwired because nothing in core parses a drafted `Exits:` line into names.
	// (was 15ceae616882db, then 94ce032b7c0b)
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '164975f16c6c17')
	// Moved 2026-09-28 (lair re-plan R3, `collects`): `composerText` became `collects.text` ('Room
	// name'), and the description says _Name it_. Proven: the built document with `collects`
	// deleted, `composerText` restored and the old description hashes back to the old pin. (was
	// "147519b9d27469")
	// Moved 2026-09-30 (plan A28): `gather.rooms` (a location listing, its
	// preset) into `context`'s `locationEntries`, and `input.text` on
	// `turnDirection`. Proven: a copy of core-catalog/src with only this lane's edits (guide.ts, whodunitActions.ts, lairActions.ts, adventure.ts, prompts.ts) reverted hashes back to the old pin. (was "160737b487903c")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4); the room
	// rule's `place` step (+ preset `path`) as `shownElsewhere`. Edited in place
	// under the freeze, content-addressed; its shipped config re-projected for
	// the `place` preset by `0109`. Measured with other lanes' in-flight core-
	// catalog edits in the tree, not proven in isolation. (was "1756e1be2ceb54")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1f69f3eeb34e18")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '12bcd383afd725')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '1a26f0c2c8ea06')
	// Moved 2026-10-21 (Lair rewrite L3, D2/D10): the draft is one JSON answer (`LAIR_ROOM_DRAFT_SCHEMA`: body, ways out, the place entry type's fields) made into the write by `core:script/lair-room`; ways to known rooms linked in the entry's own commit. (was "108d95a7e9f0d")
	"core:spec/lair-build-room@1.0.0": "7d6ab54d3173c",
	// New 2026-09-28 (lair re-plan R11): File as a room, on a message's ⋮.
	// Proven (SDK and app pins alike): a copy of the SDK sources (sdk,
	// contracts, core-catalog) with only R11's edits reverted has no such
	// spec, and the golden and every other pin come back with it.
	// Moved 2026-09-30 (plan A28): `gather.lore` reads as the Castellan
	// (`speaker: 'envoy:castellan'`). Proven: a copy of core-catalog/src with only this lane's edits (guide.ts, whodunitActions.ts, lairActions.ts, adventure.ts, prompts.ts) reverted hashes back to the old pin. (was "2e1e00db48eec")
	// Moved 2026-09-30 (plan A28 review): the draft reads `gather.worldLore`
	// and `gather.historyEntries` in place of `gather.lore`, so no character
	// lore reaches a room. Proven: a copy of core-catalog/src with only this
	// fix-up's edits (lairActions.ts, whodunitActions.ts) reverted hashes back
	// to the old pin. (was "f93786f4c28b1")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "1f779b5c86196a")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4); the room
	// rule's `place` step (+ preset `path`) as `shownElsewhere`. Edited in place
	// under the freeze, content-addressed; its shipped config re-projected for
	// the `place` preset by `0109`. Measured with other lanes' in-flight core-
	// catalog edits in the tree, not proven in isolation. (was "626f077468ed5")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an `attachments` query on the spine and `attached` in the drafting arm, before its `prompt`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "e7dab423b1f49")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '15e4a1a9fb7c47')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '5fd05e1c777d3')
	// Moved 2026-10-21 (Lair rewrite L3, D2/D10): drafts as JSON with typed fields, as build-room. (was "1995d8e27f5306")
	"core:spec/lair-file-room@1.0.0": "638ab8005cf0e",
	// Moved (L1, 2026-09-17): the knock's options write the room. The one
	// write-class outlet is `core:outlet/create-lore-entry` (was
	// `create-message`), the `build` branch drafts the dungeon's room layout
	// for the master to fill in, and a preset turns the review gate on. The
	// action is now `effects: 'world'` in the `composer` venue — an
	// owner-addressed block may name one.
	// Moved again by the Lair finish lane: the room files as a
	// `core:entry/location`, exactly as *Build room* now files one.
	// (was "912b4d1226a36", then 1c5e452458312a, then 3899346f4eb21)
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '334691209cc9f')
	// Moved 2026-09-27 (lair pass B12): the build branch drafts the room with
	// the model (`choice.build.*`, was a fixed template), `save.name` is the
	// block's `referent`, and `onward` + `resume` write the master's line
	// after the gate. Only these edits moved it. (was "1460f968fd6d09")
	// Moved 2026-09-27 (lair pass W-GATE D3): `presentWhen` — present only
	// while a knock is open. Proven: with that edit reverted in a copy of
	// core-catalog/src it hashes back to the old pin. (was "1463350a023f68")
	// Moved 2026-09-28 (lair re-plan R9): collects optional text (_Describe the
	// room_); the `room` junction on `input.text` — `room.typed.save` (the
	// typed text verbatim, review off) or `room.drafted.*` (the Castellan's
	// draft, review on); the improvise branch retired. Proven with the
	// lair-respond pin above. (was "18a1fa33f65921")
	// Moved 2026-09-29 (places plan B6): Answer the door links the new room to
	// the room the party stand in — `gather.rooms`, `here`
	// (`undescribed-name@1` at `path: 'world.location'`) and the `link`
	// junction (`link.resolved.write`, `link-lore-entries@1`, `leads to` both
	// ways) with their preset values. Proven with the lair-respond pin above.
	// (was "15f936dc559f84")
	// Moved 2026-09-30 (plan A27 P5): `here` takes `fallbackName` from
	// `answer.vantage`. Proven with the lair-respond pin above.
	// (was "ea7e0ac0ac269")
	// Moved 2026-09-30 (plan A28): `gather.lore` reads as the Castellan, and
	// `room.drafted.context` takes the rooms as `locationEntries`. Proven: a copy of core-catalog/src with only this lane's edits (guide.ts, whodunitActions.ts, lairActions.ts, adventure.ts, prompts.ts) reverted hashes back to the old pin.
	// (was "acb2d1c54207b")
	// Moved 2026-09-30 (plan A28 review): the draft reads the world-lore and
	// history lanes in place of `gather.lore`. Proven with the lair-file-room
	// pin above. (was "16343d5b03a3ac")
	// Moved 2026-09-30 (config grouping, catalog lane): `expose.label` (and, on
	// a model call of a multi-call spec, `expose.purpose`) names the step in
	// settings. Display text only; the run is unchanged. Proven: a copy of
	// core-catalog/src with only this lane's edits reverted hashes back to the
	// old pin. (was "7ff1efdd3c37a")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4); the room
	// rule's `place` step (+ preset `path`) as `shownElsewhere`. Edited in place
	// under the freeze, content-addressed; its shipped config re-projected for
	// the `place` preset by `0109`. Measured with other lanes' in-flight core-
	// catalog edits in the tree, not proven in isolation. (was "1688d15ea113ef")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an `attachments` query on the spine and `attached` in the drafting arm, before its `prompt`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "b3f5009baca91")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was 'aeba7feeb1b33')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '1bda2c525885a6')
	// Moved 2026-10-21 (Lair rewrite L3, D2/D10): drafts as JSON with typed fields, the both-ways link kept. (was "1156167a5aff2f")
	"core:spec/lair-room-answer@1.0.0": "3d7d4cce10e94",
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '1c2a2e148f7f4e')
	// Moved 2026-09-27 (lair pass W-GATE D2): the typed line wired to
	// `context.turnDirection`. Proven: with that edit reverted in a copy of
	// core-catalog/src it hashes back to the old pin. (was "be6bf430fc3bd")
	// Moved 2026-09-28 (lair re-plan R3, `collects`): `composerText` became `collects.text` ('What
	// do you whisper?'). Proven: the built document with `collects` deleted and `composerText`
	// restored hashes back to the old pin. (was "4ea205316b7e6")
	// Moved 2026-09-28 (lair re-plan R10, whisper recipients): collects
	// `recipients` (Who hears it, min 1, `overwrites` the whisper slot) and a
	// new description; the graph is pure — inlet, state, `resolve` (`owners` =
	// `input.recipients`), `apply` — the model call and its preset values
	// gone. Proven with the lair-respond pin above. (was "76066b2c2a5ab")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '17cf2e37e34e6')
	"core:spec/lair-whisper@1.0.0": "8e2c522cf5ea9",
	// NEW 2026-10-15 (PLAN-dungeon-crawler-2026-10-14, the create lane): the
	// genre published — create, the welcome (`member-added`), the interview
	// with genesis at its end, the reply (story ⏳ + the Planner's lanes), the
	// answer form, and the turn order (scripted, the round script by seed key,
	// history `*`). 🚧
	// Moved 2026-10-15 (walkthrough fixes): the Planner's greeting says
	// "I'm the {{char}}". (was "baefc49a22797")
	// Moved 2026-10-15 (deletions and retry, unreleased): the genre's shape
	// the create inlet carries declares the Honour mode field and Story's
	// `messageVerbs: { retry: false }`. (was "12456d5817a890")
	// Moved 2026-10-16 (🚧 table channel, PLAN-rulesets §30): the shape the
	// create inlet carries declares the `table` channel (folio, voice none,
	// _Dice_). (was "16ffc138e02ee9")
	// Moved 2026-10-17 (rulesets W3-B, DC onto the ruleset handler + the session's own notes; recorded W4-A): the annex keys the
	// create seeds blank are `progress` (⏳ was `world` — the world is the
	// session's own lorebook now), and the genre the create inlet carries
	// declares `writes.lore: true` and its sheet's `crawl-*` slots.
	// (was "11a21e67c9365f")
	// Moved 2026-10-18: lanes by person (channel-lane), one exit model, asks, journal kinds, solo standing order, A11 placeholder-first (was "aeb8428aa5bef").
	// Moved 2026-10-18 (lane C, after the 100-turn walk): the genre's characters `hint` (companions), its layout's faces strip (`owners: seats`), the Dice tab (`messages#table`) and Line kinds as a ticked list (was "64ba72a67b170").
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '79c5aef3f2a47')
	// Moved 2026-10-23 (RF fix 5): the Honour mode field the create inlet's
	// genre carries reads "…and the host delete the latest turn where
	// deleting is on. Off: neither." (deletion needs a pipeline). (was "1249c16d98f1e")
	"core:spec/dungeon-crawler-create@1.0.0": "4d5dc06bd6b9e",
	// Moved 2026-10-18: lanes by person (channel-lane), one exit model, asks, journal kinds, solo standing order, A11 placeholder-first (was "10e007b633e3a9").
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '169cfff3d40856')
	"core:spec/dungeon-crawler-welcome@1.0.0": "19ed24cbe42e4",
	// Moved 2026-10-15 (the multiplayer lane, unreleased): the interview asks
	// the standing order under the sheet and answers it on the seat. (was "c15d142de0003")
	// Moved 2026-10-15 (walkthrough fixes): the interview and sheet scripts
	// are handed the state (no change that changes nothing), and genesis
	// files each seat's location at the opening's row. (was "f08003273f275")
	// Moved 2026-10-15 (per-character max HP, unreleased): the sheet's
	// `healthConfig` configures the seat's hp max (`set-stat-config@1`,
	// `route.sheet.after.seat.health.set.write`) before its stats. (was "da692d91998c5")
	// Moved 2026-10-16 (wire fixes, unreleased): the class offer, the sheet,
	// the world and the opening are laid out by DUNGEON_CRAWLER_BRIEF_TEMPLATE
	// (the brief the last user turn), and an acknowledgement is a table line
	// (`route.noted`, `nextWrite`). (was "2d3cc4d68cbd")
	// Moved 2026-10-17 (rulesets W3-B, DC onto the ruleset handler + the session's own notes; recorded W4-A): the class's starting
	// kit is the handler's `apply` (`core:task/ruleset-resolve@1`, compendium
	// ids); genesis files the world into the session's own lorebook (places
	// as location entries, people as character lore). (was "15ad13f8b81797")
	// Moved 2026-10-18: lanes by person (channel-lane), one exit model, asks, journal kinds, solo standing order, A11 placeholder-first (was "14b3d46be252fc").
	// Moved 2026-10-18 (the 100-turn walk, lane A): each answer said back as the person's line (`said.echo`, kind `answer`) before the answer's changes, filed there; the sheet's summary first (`route.sheet.told.said`), its stats filed at it; the kit on the seat named in the same run (`after.seat.kit.given`); a new character's seat `retire`s the fallen's. (was "f142e90bf72c3")
	// Moved 2026-10-18 (the 100-turn walk, lane B — P2-4, P2-6): the sheet's apply step is handed the turn's ruleset (`ruleset: $.input.ruleset`), so the kit follows the casting choice and Story's words. (was "109b9da5a90972")
	// Moved 2026-10-19 (PLAN-dc-after-walk2 Q1-6, Q3-3): the sheet writes the seat's own spell-point most (`seatWrites` points junction), and genesis says on the lane that the story has started (`started`, a table line by the Planner). Measured with other lanes' in-flight edits in the tree. (was "1d4b9e6a65efcf")
	// Moved 2026-10-19 (PLAN-dc-after-walk3 R1-4, R2-1, R2-2, ★4): the seat's full health and spell-point most are filed at the stats' row (`worldRow`); genesis reads the places back and holds the world's ways out as `exits` pieces (`worldPlaces`, `ways`, `hold.ways.apply`); a way out's grammar carries the trap's `trapDamage` and `trapCondition`; the sheet writes the class's trained skills (was "18eea397cb41e1").
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '14255f89e8559f')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '1d1e19c43ee743')
	// Moved 2026-10-21 (Lair rewrite L2, D1/D9): the sheet's class, difficulty and goal are their slots' own schemas (`jsonSchemaOf`, descriptions and options read, '' kept for "not asked"); genesis's ways out read the ruleset's exit piece (kinds, standings, the trap's condition). Edited in place. (was "1544203ee9975e")
	// Moved 2026-10-23 (core genres on the seams, merge GM): kits as the session's rules' class rows, read at run time (lane G3, S4). Edited in place. (was "62087cf4de501")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "1ff08425d1064c")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): the world writes are `fileLore`; only the ORDER of the `entryType` preset values moved — nodes, edges and values identical (diffed against HEAD). (was "563a02b06d940")
	"core:spec/dungeon-crawler-interview@1.0.0": "fe64892e7ed",
	// NEW 2026-10-15 (the multiplayer lane): Reveal the planning notes (D8). 🚧
	// Moved 2026-10-15 (walkthrough fixes): a quick action — a button among
	// the composer's actions. (was "ded39ad9f077b")
	// Moved 2026-10-18 (lane C, P4-10): the reveal asks first (`confirm`) (was "172e46833e9041").
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '14e4e70ccbba9f')
	"core:spec/dungeon-crawler-reveal@1.0.0": "25c62df03bdec",
	// Moved 2026-10-15 (the story-turn lane, unreleased): the story branch is
	// the hidden Planner's JSON, the dice, the books and the Narrator — no
	// longer the ⏳ Narrator-only placeholder; the story read is 30 rows.
	// (was "19e45d072e274a")
	// Moved 2026-10-15 (one heading per step): the parley's crib text step is
	// "The Planner's out-of-character crib, as text". Proven: with that label
	// reverted the document hashes back to the old pin. (was "2041de49e7d50")
	// Moved 2026-10-15 (walkthrough fixes): the ledger and the edits are
	// handed the state, so a change that changes nothing is dropped.
	// (was "171ac1ff83ed79")
	// Moved 2026-10-15 (per-character max HP, unreleased): the story turn's
	// `raise.levels.*` raises a levelled seat's hp max (`set-stat-config@1`)
	// before the round's changes. (was "1292603d104813")
	// Moved 2026-10-15 (Planner lane bug, unreleased): the parley branch reads
	// its own channel lane (`channel.parley.lane`, `session-history@1`'s
	// `channelLane` in-port) as the conversation, the story as
	// `recentStory`; `deliverSecrets` reads what the lanes were told
	// (`told`) so a secret is told once. Also carries the concurrent
	// story-turn edits of the same day. (was "89775cf4fb8e2")
	// Moved 2026-10-16 (🚧 table channel, PLAN-rulesets §30): the roll line
	// is written after the Narrator's placeholder, on `table`, with no
	// speaker and `tableLine` naming the placeholder (its anchor); the
	// ledger's outcomes reach the Narrator as `fields` (`channel.story.outcomes`,
	// `{{outcomes}}` after the history). Measured with other lanes' in-flight
	// edits in the tree. (was "713bf53888435")
	// Moved 2026-10-17 (rulesets W3-B, DC onto the ruleset handler + the session's own notes; recorded W4-A): the story turn is
	// books → `resolve` → Planner → placeholder → `apply` → door script →
	// table line (with the explain) → ledger → Narrator; the dice/ledger gate
	// and the snapshots are gone. (was "1190e52759cf39")
	// Moved 2026-10-18: lanes by person (channel-lane), one exit model, asks, journal kinds, solo standing order, A11 placeholder-first (was "2a8b7145dd0c5").
	// Moved 2026-10-18 (the 100-turn walk, lane A): the books call's round and the Narrator's outcomes are their last user turn (DUNGEON_CRAWLER_BRIEF_TEMPLATE, DUNGEON_CRAWLER_NARRATE_TEMPLATE); the Planner's calls read an empty answer as unreadable (`emptyIsUnreadable`); the turn step reads the session and its owners are their own part (`turnOwners`), the replay applying on them; the fields step reads the books and the state; the crib reads the turn's ruleset; the told step the session and the places. (was "84299a0e9f34e")
	// Moved 2026-10-18 (the 100-turn walk, lane B — P2-1, P2-4, P2-6): the books are handed the turn's ruleset (kit, casting, death saves, rigour), and a delta carries its `aimedAt` (the Planner's and the talk's grammar). (was "8dc7ecb75d9aa", then "a70c7ae6eec76" while the member was still called `target`)
	// Moved 2026-10-19 (PLAN-dc-after-walk2 Q2-1…Q2-4, Q3-1, Q3-2): the story turn's words branch (`plan.words`, the Story ruleset asked in plain words), a raise naming its slot, the traverse's actor and the door's own lock difficulty, the redo's raises, the books' standing in words. Measured with other lanes' in-flight edits in the tree. (was "28326d2e17935")
	// Moved 2026-10-19: the two Planner placements (dice / words) carry their own headings (was "e52300ed3a81f").
	// Moved 2026-10-19 (PLAN-dc-after-walk3 R2-1): a way out's grammar carries the trap's `trapDamage` and `trapCondition` (a table of words' carries neither) (was "14f666c57c1284").
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '340a50523c9ac')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '1a239efe6d813e')
	// Moved 2026-10-21 (Lair rewrite L2, D9): a way out's grammar reads the ruleset's exit piece — its kinds and standings and what a trap may leave (`jsonSchemaOf`). Edited in place. (was "1d07b704852bb6")
	// Moved 2026-10-23 (core genres on the seams, merge GM): the Planner's grammar laid over the session's rules (`core:script/dungeon-crawler-shape`, lane G3, S1, S4), and its two resolve steps headed by their branch (_(dice)_ · _(words)_, GM). Edited in place. (was "7514f5a052a56")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "bb0ea113263db")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): the world writes are `fileLore`; only the ORDER of the `entryType` preset values moved — nodes, edges and values identical (diffed against HEAD). (was "9ec5ea8729236")
	"core:spec/dungeon-crawler-respond@1.0.0": "1a18135c4edb35",
	// NEW 2026-10-15 (the story-turn lane): Rest (no model call) and what
	// follows the goal (its form; one call for a new goal). 🚧
	// Moved 2026-10-16 (🚧 table channel, PLAN-rulesets §30): the rest's
	// line is the table's — on `table`, no speaker, anchored to Story's
	// newest line (a `head` read, `rested.said.anchor`). (was "1510d75025efb6")
	// Moved 2026-10-17 (rulesets W3-B, DC onto the ruleset handler + the session's own notes; recorded W4-A): the rest's script
	// reads the progress annex (no world document, no fuses burnt there —
	// fuses are `crawl-fuses` on the world owner) and its line goes to the
	// journal only, anchored to Story's line. (was "730f8893b76e6")
	// Moved 2026-10-18: lanes by person (channel-lane), one exit model, asks, journal kinds, solo standing order, A11 placeholder-first (was "1e4d17ded73ca6").
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '11ad47b290ec51')
	// Moved 2026-10-23 (core genres on the seams, merge GM): Rest's length the session's rules' and one body with *After a rest* (lane G3, S3, S4). Edited in place. (was "f58384e131f26")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "1dfa16c74e4181")
	"core:spec/dungeon-crawler-rest@1.0.0": "53224cac7f345",
	// Moved 2026-10-15 (one heading per step): "Draw up the new goal" (the
	// script) and "Keep the new goal in the world" (the write), no longer both
	// "File the new goal". Proven: with the labels reverted the document hashes
	// back to the old pin. (was "ae87e3a077dd3")
	// Moved 2026-10-16 (wire fixes, unreleased): the new goal's call is laid
	// out by DUNGEON_CRAWLER_BRIEF_TEMPLATE. (was "688d793e413fd")
	// Moved 2026-10-17 (rulesets W3-B, DC onto the ruleset handler + the session's own notes; recorded W4-A): the goal's
	// bookkeeping (`goalReached`, `goalDone`, `ended`) is the progress annex's,
	// no longer the world document's. (was "19f071376de2e1")
	// Moved 2026-10-18: lanes by person (channel-lane), one exit model, asks, journal kinds, solo standing order, A11 placeholder-first (was "54a3aeac8cfec").
	// Moved 2026-10-18 (the 100-turn walk, lane A): End has the Narrator close the adventure at once (`route.closing.*`, the narrate row and template). (was "118dc8ba87098b")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '543d52c482263')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '94629a034f581')
	"core:spec/dungeon-crawler-goal@1.0.0": "169cb881199cd5",
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1524465e47d46c')
	"core:spec/dungeon-crawler-answer-form@1.0.0": "1e7803cf9f381",
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was 'b315665323b9a')
	"core:spec/dungeon-crawler-turn-order@1.0.0": "6199658f630c5",
	// Moved 2026-09-28 (lair re-plan R3, `collects`): `composerText` became `collects.text`
	// ('Direction the party should feel'). Proven: the built document with `collects` deleted and
	// `composerText` restored hashes back to the old pin. (was "16413e137630d4")
	// Moved 2026-09-28 (lair re-plan R8): the description tells the Castellan. Proven (SDK and app pins alike): a copy of the SDK sources (sdk, contracts, core-catalog) with only R8's edits reverted hashes back to the old pin, and the golden with it.
	// (was "1877bfe4e0a7c3")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '21b5bb80f5a13')
	"core:spec/lair-nudge@1.0.0": "1f6e668013b7c1",
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '13c47a285b09c5')
	// Moved 2026-09-27 (lair pass B17, owner D7a): a streamed Narrator row
	// (placeholder + update with `thinking`), the typed text as
	// `turnDirection`, status 'Springing a trap', new description. Proven: a
	// copy of core-catalog/src with those edits reverted hashes back to the
	// old pin. (was '1a76572366c955')
	// Moved 2026-09-28 (lair re-plan R3, `collects`): `composerText: 'optional'` became
	// `collects.text` with `ifEmpty`, and the description stops saying _Type_. Proven: the built
	// document with `collects` deleted, `composerText` restored and the old description hashes
	// back to the old pin. (was "13037fcf38e983")
	// Moved 2026-09-28 (lair re-plan R8): the Castellan's row (`speaker:
	// 'envoy:castellan'` on the placeholder) and description. Proven (SDK and app pins alike): a copy of the SDK sources (sdk, contracts, core-catalog) with only R8's edits reverted hashes back to the old pin, and the golden with it.
	// (was "7908780de567e")
	// Moved 2026-10-01 (post-history trigger, owner ruling): a new default preset (`default`, "Default") ships `postHistoryTokenTrigger: 3000` on its `prompt` step — the step renders the session's growing history. Proven: a
	// copy of core-catalog/src with only this change reverted hashes back to the
	// old pin. (was "5d480cd988aac")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4), in the
	// Castellan's action builder. Edited in place under the freeze, content-
	// addressed, needing no re-projection (no new preset value). Measured with
	// other lanes' in-flight core-catalog edits in the tree, not proven in
	// isolation. (was "435ec04f9e98")
	// Moved 2026-10-03 (owner note 39): `save` wires `reasoning` — the port
	// `thinking` -> `reasoning` on generate-text / update-message. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "b0bed56a5f13d")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "132d6d7d30e21c")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "2cd46fc610e39")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '15e6228b78c851')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '10aa3bf67ebd2d')
	"core:spec/lair-trap@1.0.0": "1b7dac15d70c7f",
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '194ea02b271eb3')
	// Moved 2026-09-27 (lair pass B17, owner D7a): as the trap; status
	// 'Revealing'. Proven the same way. (was '1a6fea0495e3bc')
	// Moved 2026-09-28 (lair re-plan R3, `collects`): as the trap. Proven: the built document with
	// `collects` deleted, `composerText` restored and the old description hashes back to the old
	// pin. (was "1c5849cac7c2d2")
	// Moved 2026-09-28 (lair re-plan R8): the Castellan's row (`speaker:
	// 'envoy:castellan'` on the placeholder). Proven (SDK and app pins alike): a copy of the SDK sources (sdk, contracts, core-catalog) with only R8's edits reverted hashes back to the old pin, and the golden with it. (was "14a4a433b3e291")
	// Moved 2026-10-01 (post-history trigger, owner ruling): a new default preset (`default`, "Default") ships `postHistoryTokenTrigger: 3000` on its `prompt` step — the step renders the session's growing history. Proven: a
	// copy of core-catalog/src with only this change reverted hashes back to the
	// old pin. (was "87fe755438456")
	// Moved 2026-10-02 (lorebooks Wave 8): a `presences` read and an `eligible`
	// step (`core:task/eligibility@1`) before every ranker (C2, R2/R4), in the
	// Castellan's action builder. Edited in place under the freeze, content-
	// addressed, needing no re-projection (no new preset value). Measured with
	// other lanes' in-flight core-catalog edits in the tree, not proven in
	// isolation. (was "53192d1eaa51e")
	// Moved 2026-10-03 (owner note 39): `save` wires `reasoning` — the port
	// `thinking` -> `reasoning` on generate-text / update-message. Edited in
	// place under the freeze. Measured with other lanes' in-flight core-catalog
	// edits in the tree. (was "1e20019e4ba718")
	// Moved 2026-10-03 (history window): `contextBudget` runs before the
	// reads and the transcript read takes its `budget` — sized by the window,
	// not the newest 100 rows. Edited in place under the freeze. (was "1a79a7dcd1eb46")
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` (history-attachments) + `attached` (place-attachments on `write`'s pair) before `prompt`, which reads `attached.messages`.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "177a82bd12699e")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '130237fa29fa50')
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '819bb19781bcf')
	"core:spec/lair-reveal@1.0.0": "1e25c31a42adad",
	/** The genre's answer pipeline — one graph, published once per shipped genre. */
	// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
	// statuses are declared on `expose` (`stream`, `status`). Proven: with those
	// two keys stripped, the document hashes back to the old pin. (was '15c9296cf3ab70')
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): `attachments` + `attached` (on `generate`'s pair) before `prompt`, and `{{{attachments}}}` in ANSWER_FORM_TEMPLATE's message loop.
	// Prompts with no attachments are byte-identical (parity guard,
	// `attachments/promptPath.int.test.ts`). (was "1c32eb6a456349")
	// Moved 2026-10-05 (rename, PLAN-catalogue-and-pipeline-names N4): the id was `core:spec/answer-form-lair`; nothing else changed. (was "d5cd2911aa349")
	// I12 (2026-10-12): the Default config names its loadouts. (was "1e04feae5374a")
	// Moved 2026-10-20 (PLAN-layering lane 3): no inlet lock — `{ suits }` — and the author default preset is the declared defaults (`.defaults()`, non-default author presets gone); the replies' background tasks became routines (story-respond: `reading` duty; assistant-respond: optional lore lane, memory out). (was '1c86e1cc01c1b7')
	"core:spec/lair-answer-form@1.0.0": "e03c023079828",
	// NEW 2026-10-21 (Lair rewrite L3): the reply — plan, checks, voices
	// (was lair-respond; the books and the scratchpad are routines now).
	// Moved 2026-10-22 (lair fix 2): the voice's `say` wires `currentCharacterId`, the turn plan stores the plan as the turn plays it (`door.play.played`, its speakers filled when the planner named nobody), and the Sanctum's reminder lands at no token trigger. (was "3732939546be3")
	// Moved 2026-10-23 (core genres on the seams, merge GM): _Deciding the checks_ as its status (lane G0, S7). Edited in place. (was "18ab1e1e72aac4")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "5cbe8f5325b1b")
	// Moved 2026-10-23 (RF fix 2, Lair voice): the voice's `prompt` step places its reminder at no token trigger, so a delver's turn reads whose turn it is after the GM's first line. Edited in place. (was "ee12352ed2052")
	"core:spec/lair-reply@1.0.0": "c4fe814f1e089",
	// NEW 2026-10-21 (Lair rewrite L3, D5): a seat taken, told to the GM in the Sanctum.
	"core:spec/lair-welcome@1.0.0": "1bf873c4b48d0b",
	// NEW 2026-10-21 (Lair rewrite L3, D7): routines — the keeper (Story's
	// reckoning under the Lair's prompt), the scratchpad, file the current room.
	// Moved 2026-10-23 (core genres on the seams, merge GM): _Keep the books_ (G0), the one change grammar of the shared reckoning (G1, S1), and the keeper's lift `tableRules` retired (GM). Edited in place. (was "123fac28db816a")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "13f43d1c42809")
	"core:spec/lair-keeper@1.0.0": "1e7e03116e5d3d",
	"core:spec/lair-scratchpad@1.0.0": "8ffdc89f6eb8",
	// L4 (2026-10-21): its two saves headed apart — two steps of one group never share a heading. (L3's was "507d5063e77de")
	"core:spec/lair-file-current-room@1.0.0": "567f7947865d0",
	// NEW 2026-10-21 (Lair rewrite L3, D3): the GM's Roll and a roll form's answer.
	"core:spec/lair-roll@1.0.0": "196c24d8b373b6",
	// Moved 2026-10-23 (core genres on the seams, merge GM): _Deciding the check_ as its status (lane G0, S7). Edited in place. (was "10e23e3a75024")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "180b95879690f1")
	"core:spec/lair-roll-answer@1.0.0": "132974277207e4",
	// New 2026-10-20 (PLAN-layering lane 3): Story's routines — the reckoning
	// and the sweep, out of story-respond, and *Picture each new scene* (the
	// Scene action's graph on a routine inlet) — and Chat's *Remember things*.
	// Moved 2026-10-23 (core genres on the seams, merge GM): _Note what changed_ titles its duties card (G0, S7); the one change grammar — the crib writes the schema the call asks in, commit arms `ruled` · `ruledHeld` · `words` (G1, S1). Edited in place. (was "1ea1946ced835")
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "155e7dcd4aa7d")
	"core:spec/story-reckoning@1.0.0": "10867c2eda2502",
	// Moved 2026-10-23 (core genres on the seams, merge GM): _Look back over the story_ titles its duties card (lane G0, S7); its model call labelled _File what is worth keeping_, never the routine's name its duties card carries (GM). Edited in place. (was "17981ba0e2bec5")
	// Moved 2026-10-25 (pr-6 lane C3, supervisor C): the lore writes are `fileLore` / `rememberNote`; only the ORDER of the `entryType` preset values moved — nodes, edges and values identical (diffed against HEAD). (was "1baa5f325cd667")
	// Moved 2026-10-25 (sprint 2 lane I2, pass 7 / R-i): the crib and the sort read the duties step's `sceneCheck` (and the crib the history), and a `sceneCue` junction offers `propose-scene-cue@1` — Full as the scene mode decides, Review with `ask`. Edited in place. (was "131df6899cf85d")
	"core:spec/story-sweep@1.0.0": "2f4aae4332c2b",
	// Moved 2026-10-21 (PLAN-layering lane 8, omni O7): every `generate-text` node names its speech sampling (`speechSampling: slot.speechSampling()`). Edited in place. (was '1989d733a38b8')
	"core:spec/story-illustrate-new-scene@1.0.0": "9b8440cff74d8",
	"core:spec/assistant-memory@1.0.0": "1811e7b16e1c3",
	// NEW 2026-10-23 (rulesets as functions D6): a ruleset's action — the one generic pipeline every invokable function runs, Full or Review by its registration's mode.
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read. Edited in place. (was "47e5217d6d257")
	"core:spec/rules-action@1.0.0": "988b95d02e6db",
	// NEW 2026-10-23 (PLAN-genres-seams S3, lane G3): the crawl's own effects after the rules' Rest, on `rest-taken`.
	// Moved 2026-10-23 (rulesets as functions, repair 1): every `ruleset-resolve` step names its params slot (`params: slot.params()`), so its `emits` switch is read; its resolve steps take the routine's cause as their `event` (the functions' `ctx.event`). Edited in place. (was "1c6b2a2d957d5")
	"core:spec/dungeon-crawler-after-rest@1.0.0": "12de3951048577",
	// NEW 2026-10-23 (genres GM, G1 ★5): Story's clock moved by the rest the rules raised, on `rest-taken`.
	"core:spec/story-after-rest@1.0.0": "ef952f79caa2",
}

describe("published spec hashes", () => {
	const current = () => {
		const out: Record<string, string> = {}
		for (const entry of CORE_SPECS) {
			const doc = entry.build()
			out[`${doc.id}@${doc.version}`] = canonicalHash(doc)
		}
		return out
	}

	it("resolves every recorded pin to the hash recorded for it", () => {
		const now = current()
		const drifted = Object.entries(PUBLISHED)
			.filter(([pin, hash]) => now[pin] && now[pin] !== hash)
			.map(([pin, hash]) => `${pin}: recorded ${hash}, code ${now[pin]}`)

		expect(
			drifted,
			drifted.length
				? "This pin now names a different document. That is shippable — " +
						"the edited document publishes as a new version row and the " +
						"slug's pointer moves to it, with no migration — but it must " +
						"be deliberate: bump the spec's *_VERSION and add the new " +
						"pin, or record the new hash against the existing one in the " +
						"same commit as the edit."
				: undefined
		).toEqual([])
	})

	it("records every spec this build publishes", () => {
		const missing = Object.keys(current()).filter((pin) => !PUBLISHED[pin])
		expect(
			missing,
			missing.length
				? `New or bumped spec version(s). Add the pin and hash below:\n` +
						missing
							.map((pin) => `\t"${pin}": "${current()[pin]}",`)
							.join("\n")
				: undefined
		).toEqual([])
	})
})
