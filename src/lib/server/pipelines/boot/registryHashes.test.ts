/**
 * What each shipped slug resolves to, as a checked-in fact.
 *
 * A type slug is an indirection to a content hash (ruling 2026-09-10): the
 * registry row for `id@version` carries whichever declaration the slug resolves
 * to now, `pipeline_type_declarations` keeps every one it has ever resolved to,
 * and a boot that finds a changed declaration publishes it and moves the
 * pointer. So an edited descriptor no longer stops anything — which removes the
 * *disaster* this file was written for and leaves the *question* it exists to
 * ask.
 *
 * The question is: **did you mean to change what that pin means?** A hash moving
 * is a normal, shippable event; a hash moving without anyone noticing is not.
 * Nothing else in the suite can tell the difference, because a fresh test
 * database publishes whatever the code currently says and passes either way.
 *
 * So this stays a snapshot, and updating a line stays deliberate — what changed
 * is the cost of the answer. Where the three answers used to be *bump the
 * version*, *it was only display text*, or *write a re-projection migration*,
 * the third is gone: an edit is carried to every install by the pointer move
 * alone. Update the line in the same commit as the edit, and the diff shows a
 * declaration and its hash changing together.
 *
 * ⚠ **A version bump is still the honest answer to a breaking change.** Content
 * addressing removed the boot failure, not the judgement: moving a port under
 * `@1` still changes what every spec pinning `@1` does, and this file is where
 * that becomes visible enough to argue about.
 *
 * That a slug's row actually *carries* the recorded hash after a boot — the
 * database half of the same fact — is asserted by
 * `contentAddressing.int.test.ts`, which is where a database is available.
 */

import { describe, it, expect } from "vitest"
import {
	allTypes,
	allScriptTypes,
	snapshotRegistry,
	declarationHash,
	DESCRIPTOR_DISPLAY_KEYS
} from "@serene-pub/sdk"
import { typeContentHash } from "$lib/server/pipelines/boot/registrySync"
// Importing the contracts is what registers them — the same fact-about-the-code
// route `bootstrapPipelines` takes, rather than a list maintained beside it.
//
// Note that `@serene-pub/contracts` resolves to its **`dist`**, not its source
// (its package `exports` say so). That is deliberate — this guards what actually
// ships and what the running app loads — but it means editing a descriptor in
// `serene-pub-sdk/contracts/src` changes nothing here until that package is
// rebuilt. If you edited a descriptor and this test did not react, you have not
// run `npm run build` in the contracts package yet, and neither has the app.
import "@serene-pub/contracts"
// And the catalog, for the same reason: core's **entry** types are declared
// there beside the genres and pipelines, and declaring one registers it. Boot
// loads the catalog through `specs/respond`, so a guard that walked only the
// contracts would leave three published types unfrozen — which is the one thing
// this file exists to prevent.
import "@serene-pub/core-catalog"

/**
 * `pin -> contentHash`, for every slug this build publishes.
 *
 * **Do not update a line here to make a test pass.** A changed hash means the
 * declaration behind an already-published pin moved, and there are three correct
 * responses:
 *
 * 1. **Bump the version.** Publish `@2` and leave `@1` in place for the specs
 *    pinning it. This is the answer whenever the change would break them — a
 *    removed port, a narrowed range, an enum option withdrawn. Content
 *    addressing does not make this optional; it makes it a judgement rather than
 *    a boot failure.
 * 2. **You changed only display text.** Labels (`i18n`, `label`) and
 *    `description` are stripped before hashing precisely so they can change
 *    freely. If the hash moved, you changed something else too — find it.
 * 3. **The edit is a correction, and the pointer carries it.** A declared port
 *    that was always supplied, a widened range, a default that was wrong: the
 *    next boot publishes the new declaration, moves the slug's pointer to it,
 *    and keeps the old one under its hash. Record the new hash here in the same
 *    commit as the edit, and say in a comment what moved and why it does not
 *    break the pins.
 *
 * ⚠ **Answer 3 used to require a migration and no longer does.** Migrations
 * 0099, 0106 and 0113 each delete registry rows so the next boot could re-project
 * them — the comments below that name one are history, not instructions. Nothing
 * written from now on needs the migration half.
 *
 * Adding a *new* type is safe and needs nothing — just add its line.
 *
 * ## Migration 0176 — answer 3 as it used to be written, fourteen entries at once
 *
 * Every type with a `connection` slot gained `requires`: the capability ids that
 * connection must satisfy, e.g. `['text->image']` on `generate-image`. Scattered
 * through this table rather than grouped, so they are noted here instead: the
 * providers for text, image, embeddings, speech, the four graph nodes, the two
 * summarizers, name-entry, extract-cast, and the comfy plugin example.
 *
 * `shape` did not move — it still types the SLOT. `requires` is a separate fact
 * about the CONNECTION bound to it, and it exists because filtering on the
 * connection's `modality` scalar refused KoboldCPP an image node for being
 * "a text connection" while it was drawing pictures from the same process.
 *
 * The two MCP nodes are deliberately absent: no transform id is true of a tool
 * server, so they keep filtering by `shape` alone and their hashes did not move.
 */
const PUBLISHED_HASHES: Record<string, string> = {
	"chariot.comfy:render-image@1": "8cab45abdf9c1",
	"chariot.dice-tray:roll@1": "b7457cf04e36d",
	"chariot.recall:rank-recall@1": "17b9069e6e0b65",
	"core:consumer/attach-audio@1": "2a3ce393ac3d8",
	"core:consumer/attach-image@1": "dce5f172a6edb",
	"core:consumer/create-lore-entry@1": "f8eff8031562c",
	// Re-projected by 0174: a `media` in-port, so an image can be posted AS a new
	// message. `attach-image` could not do it — a message created inside a run is
	// not a valid target for a later node — which left no path at all from a
	// render to a posted image.
	"core:consumer/create-message@1": "14a3a9a68ea88d",
	"core:consumer/emit-socket@1": "7658edce87c6",
	"core:consumer/graph-proposal@1": "437560532d042",
	"core:consumer/save-plugin-data@1": "1548f67cc814f",
	"core:consumer/update-message@1": "f912a25836fda",
	"core:input/message-created@1": "f90c5108c7e82",
	"core:input/summarize-request@1": "118295257093fb",
	// Gained the `greeting` field on its sessionShape (20, migration 0151) —
	// the default greeting-on-creation behaviour stated, not changed.
	//
	// Re-projected by **0106** (policy answer 3): a `continuationPrefill`
	// out-port, so a caller can supply the text a **continue** is continuing
	// (ruling 2026-09-08, D-2). Additive — `echo`, `generate-image`,
	// `graph-build` and `narrate` share this input type and wire nothing to the
	// new port, so a port nothing wires is never resolved and none of their
	// documents move. Only `respond` reads it.
	"core:input/user-message@1": "1a8550b1c61c38",
	"core:input/session-created@1": "18daad12cc8870",
	// The side-character turn (ruling 2026-09-07). A NEW type — no migration,
	// just a line: it inserts a row and conflicts with nothing.
	//
	// Its own type rather than a flag on `user-message@1`, because that type
	// carries the standard chat's `sessionShape` and therefore *is* the chat
	// mode; a per-turn action must not restate a session's shape. It also
	// carries a `speaker` port the chat input has no room for, and the
	// new-name fact as declared `extras` on its scripts hook — which is what
	// lets a script read "the lorebook has never heard of this name" through
	// the one dispatch core scripts and extension hooks already share.
	"core:input/side-character-turn@1": "aae12bf9be9a8",
	"core:query/session-greetings@1": "5c57ecc64e730",
	"core:consumer/seed-greetings@1": "1247e34e381a2f",
	// Re-projected by **0201** (policy answer 3): the node is `optional`, which
	// in the executor turns an error into an empty `ok` with `recoveredAsEmpty`
	// on the receipt. It is wired into a shipped spec for the first time in
	// respond 1.19.0, and most installs have no embedding model — the host
	// answers that by throwing, which is the right answer to a caller and the
	// wrong thing to let end somebody's turn. The plan's second governing rule
	// is an absolute (*an unavailable mechanism subtracts a signal; it never
	// disables a path*), so the guarantee is structural here rather than a
	// `try` in one binding. It also earns the node its "Use this source"
	// switch, which is the zero-cost way to turn the semantic mechanism off.
	"core:provider/embed-text@1": "16825493af627c",
	// Gained its two script hooks in 0.6-preview (migration 0146): `scripts`
	// before over `content`, `castScripts` after over `cast` — the paste-rung
	// half of replaceable cast extraction (ruling of 2026-08-26). Replacing
	// the extractor itself stays a node rebind, never a script.
	"core:provider/extract-cast@1": "972921f6b6931",
	// Gained `currentCharacterId` in 0.6-preview (migration 0134): the §27l
	// stop-string exclusion follows the next-speaker node's output through
	// the host's payload-wins seam (19 §5).
	// Re-projected by 0170 (policy answer 3): the type gained a multimodal
	// contract — an `attachments` in-port, a `parts` out-port, and a declared
	// `media` capability — before any release shipped it.
	// Gained `params.streaming` (`auto | off`): a per-node say in whether the
	// request is sent as a stream, beside `stopSequences`. Additive with a
	// declared default, so a config that has never held the address resolves
	// `auto` and every existing pipeline sends what it sent.
	"core:provider/generate-text@1": "867d5d06400c5",
	"core:provider/graph-node-description@1": "175a464ce58684",
	"core:provider/graph-node-resolution@1": "15e22620687cf1",
	"core:provider/graph-perspective@1": "200c0141d4ebf",
	"core:provider/graph-pre-filter@1": "f017bf224984f",
	"core:provider/graph-state-detection@1": "16d24f04ed08c0",
	// Re-pinned when 14 was built out (the draft stub's hash never reached an
	// install — 0141's core wipe re-projects every row at boot).
	"core:provider/mcp-tool@1": "2a4ceca243862",
	"core:provider/mcp-resource@1": "9d9890414a3d8",
	// Re-projected by **0113** (policy answer 3), with the two summarize steps
	// below: a `loreType` in-port (D-I). `summarizeSpec` writes it as a literal
	// into the node's config, in the same map as `content` and `batch`, and
	// `resolveInput` passes a non-ref config value through untouched — so the
	// binding reads `input.loreType` exactly the way it reads a port, and a
	// port is what it is. Declared rather than made a parameter, which would
	// have put "which kind of entry this pipeline writes" in the panel as
	// something a user could tune their scene summarizer into a world one with.
	"core:provider/name-entry@1": "ae679fda6bf0",
	"core:provider/speak@1": "e36fdde93956d",
	// Re-projected by **0113** — `loreType`, on the same terms as `name-entry`
	// above.
	"core:provider/summarize-batch@1": "fcd1efb71d68",
	"core:provider/summarize-synth@1": "17543b07afc2ac",
	"core:query/session-cast@1": "142e94006413af",
	// Re-projected by 0186 (policy answer 3), together with `history-entries`
	// below — one hash, because the three lore gather branches share a slot declaration
	// and the content hash strips display text. `scanDepth`'s declared default
	// moved 3 → 10 to match `DEFAULT_RETRIEVAL.scanDepth`, the number every
	// scan has actually run on: the gather branches shipped without a wired `params`
	// slot, so the declaration was never handed to anything and the two could
	// not be seen to disagree. Wiring the slot is what makes the number live,
	// which is why the correction and the wiring land together.
	//
	// Re-projected again by **0192** (policy answer 3), all four lore types
	// together: `loreSlots` and `lorebook-triggers` each gain
	// `admitThreshold`, the declared control behind the admission gate. The
	// scan admitted on `pinned || keyword > 0 || nameMatch > 0`, so an entry
	// with no matching key could not reach the prompt however relevant it was
	// — the condition that forces a lorebook to be hand-indexed. It defaults to
	// **0, which is off**, so every existing install behaves exactly as it did
	// until somebody moves it; the hash still moves, because a declared field
	// is contract whatever its default.
	//
	// Re-projected a third time by **0199** (policy answer 3), the four lore
	// types again: `lexicalScoring`, `trigramFolding` and `titleWeight` —
	// retrieval plan phase 1's three lexical-quality controls. BM25 in place of
	// the raw per-occurrence sum, character trigrams in place of exact
	// substring only, and a title that can outrank the keys it sits beside.
	// Every default reproduces today: `overlap` is the sum the scan already
	// computed (and still literally calls `tfidfSignal` for), `0` folding is off
	// by the `admitThreshold` convention, and `1` is neutral rather than off
	// because a space cannot split a token, so weighting the title and the keys
	// alike is arithmetically the one bag of words they already were. The hash
	// moves because a declared field is contract whatever its default.
	//
	// Re-projected a fourth time by **0203** (policy answer 3), the three lore
	// gather branches and `vector-search` together: `retrievalMode` is **culled**. It
	// named which mechanism might surface an entry that had declared nothing of its
	// own, and two of its three values had already collapsed into one behaviour
	// — `both` meant "fuse the two mechanisms' rankings" and respond 1.17.0 removed
	// the fusion, so the mechanisms contribute additively to one score and there
	// is nothing left to choose between. The third value switched a mechanism
	// off in bulk for entries whose authors never asked, which is the shape the
	// governing rule forbids.
	//
	// ⚠ **No hash moves for its sequel.** Migration 0204 drops the per-entry
	// `retrieval_strategy` column — the same shape one scope down, and the last
	// exclusive routing there was — and nothing in this file moves with it. It
	// was a tier-one *column*, declared by no entry type in `roles` or `fields`
	// and addressed by no query type, so no content hash contains it and no
	// registry row needs re-projecting. That is worth stating rather than
	// leaving as an absence: the way to tell a column change from a contract
	// change is whether a pin here has to move, and this one does not.
	//
	// Re-projected again by **0099** (policy answer 3), with the third gather
	// branch and `lorebook-triggers`: `guaranteedMessages` is **declared**. It
	// was the audit's mirror-image finding — engine-read and declared nowhere,
	// so the only value it could ever hold was `DEFAULT_RETRIEVAL`'s hardcoded
	// 10, while it set the presence window for character-lore co-occurrence and
	// the term-frequency window for tf-idf. Declared at 10, which is what every
	// scan has silently run at, so it is behaviour-preserving by construction.
	"core:query/world-lore@1": "e252379dcbac9",
	"core:query/character-lore@1": "e252379dcbac9",
	// Gained the `channel` param in 0.6-preview (migration 0149, 20 §7);
	// default 'main' reproduces the legacy read byte-for-byte.
	//
	// Re-projected by **0110** (policy answer 3): `limit`'s declared default
	// moves 40 → 100 (ruling 2026-09-09, D-8's terms). The number is not a
	// retune — the binding read `input.limit`, which nothing supplies, so every
	// run since this node existed has taken its literal 100 while the panel
	// showed 40. Declaring the effective value is what lets the control be
	// wired without moving a single install's transcript window; changing the
	// number is a separate decision against the measure corpus.
	// (was "2272f3cfb8f4b")
	"core:query/session-history@1": "24ce875b04648",
	"core:query/session-state@1": "138a9731c106d9",
	// ⚠ `core:query/graph-context@1` was here, and is gone rather than frozen.
	// It split into the two below, because one node emitting both directions of
	// the graph gave them one heading, one layout and one switch. Removing a
	// published pin is what the third test in this file exists to catch, and it
	// is allowed here only because 0.6 has not shipped: every stored spec
	// pinning it is a preview document, and `0124` deletes its registry rows
	// along with the specs that named it.
	//
	// ⚠ **Both hashes MOVED — answer 3, paired with
	// `drizzle/0111_reply_slots_and_relationship_cap.sql`**, which deletes both
	// registry rows so boot re-projects them. Reading this file's own rule
	// before editing these lines: a parameter's default is hashed, and this is
	// the third response, not the first.
	//
	// What moved: `maxEntries` — "Most relationships" — **lost its default**.
	// Neither spec named the `params` slot on either node, so `resolveInput`
	// never resolved it and `bindings.ts` called
	// `capRelationships(section, undefined)` on every run this node type has
	// ever made, which that function reads as *no ceiling* and returns the
	// section whole. `respond` wires `params: slot.params()` on both as of 0111,
	// so the declaration becomes live, and under ruling D-8 the declared default
	// must therefore BE the value every run has actually used.
	//
	// That value is "uncapped", and it is not expressible as a number here. `0`
	// is taken and means the opposite (`capRelationships` returns `null`,
	// dropping the section — the off-switch convention this package uses
	// everywhere); a negative sentinel IS what `capRelationships` reads as no
	// cap, but `min: 0` forbids one and no other parameter in the contracts uses
	// a negative sentinel; and a large finite number is a different value that
	// is merely usually indistinguishable. An absent default is the exact one:
	// `resolveSlot`'s params branch copies a schema default only
	// `if (v?.default !== undefined)` and `reconcileConfigs` back-fills a row
	// only when a declaration carries one, so an untouched install resolves
	// `undefined` and stays uncapped. 0111's third statement lifts the stored
	// `12`s the old declaration had already back-filled — without it, wiring the
	// slot would cap every upgraded install at 12.
	//
	// `min: 0`, `type: 'integer'` and the label are unchanged; the description
	// gained "leave it empty for no ceiling", and display text is stripped
	// before hashing, so the whole of the movement is the missing `default`.
	// (was "133fb1aab4e288")
	"core:query/relationships-perspectives@1": "1cb5dd5736dd89",
	// (was "1a709dd0599745")
	"core:query/relationships-known@1": "feb131426e5",
	// The graph as a ranked retrieval mechanism (ruling 2026-09-10, Q1) — the
	// same three layers the two nodes above publish as keyed sections, read
	// instead as candidates in the `relationships` budget band and ordered
	// scene presence → speaker → recency. A **new** type, so nothing is
	// re-projected: it has never been published, and the two above are
	// untouched. It reuses their `relationshipSlots`, so the ceiling means the
	// same three things here as it does there.
	"core:query/relationship-search@1": "1a07eb0bde9fac",
	"core:query/graph-scenes@1": "93cf67e05eb1",
	// The third gather branch, added in 0.6 after its absence was found: the
	// split into world and character lore left `history` with no node, so those
	// candidates were read, scored and dropped for two spec versions. A *new*
	// type needs no re-projection — nothing has published it before.
	// Re-projected by 0186, again by 0192, again by 0199 and again by 0203 with
	// the other two gather branches; see the note there.
	// Re-projected a fifth time by **0099** with its two siblings, for
	// `guaranteedMessages`; see their note.
	"core:query/history-entries@1": "e252379dcbac9",
	"core:query/lorebook-probabilistic@1": "6ac9faa6efbb8",
	// Re-projected by 0186: the same `scanDepth` correction, on this type's own
	// duplicate declaration of the field. Deliberately still a separate schema
	// rather than folded into the shared `loreSlots` — the two overlap in that
	// one field name and nothing else, and folding would cull five declared
	// addresses and hand this node a `retrievalMode` its binding never reads.
	// (That mode is gone from `loreSlots` too as of 0203, and this type's hash
	// is untouched by it — which is the separation earning itself a second
	// time: a shared declaration would have moved this hash for a field this
	// node never had.)
	//
	// Re-projected again by 0192, which adds `admitThreshold` here as well as
	// on the shared declaration — the narrator runs its lore through this type,
	// and a gate reachable on the reply pipeline and not on the narrator would
	// be a control that exists on one screen and not the other for no reason a
	// user could discover.
	//
	// Re-projected a third time by **0195** (policy answer 3), which closes
	// plan bug 15 — this type's own dead-control cluster, the last of the ones
	// bug 12 found the first of. `caseSensitive`, `useRegex`, `weight` and
	// `minInclude` rendered, validated and stored a row while
	// `retrievalParamsFrom` read none of them; they are **culled**, two because
	// they describe how an *entry* matches and live on the entry
	// (`signals.ts` reads `entry.caseSensitive` and `entry.matchMode`), two
	// because they are the ranker's and are `share`/`signal*` and `minEntries`
	// on `rank-hybrid` — the same pair `session-history` lost for the same
	// reason. `recursionDepth` is **wired instead of culled**, by renaming it
	// to `maxRecursionDepth`: one letter is why it looked live and was not, and
	// that is the name `retrievalParamsFrom` and the three lore gather branches already
	// use. 0195 carries the stored values across the rename and deletes the
	// four culled addresses' node overrides, which the reconciler cannot see.
	//
	// Re-projected a fourth time by **0199**, with the three lore gather branches above:
	// the same three lexical-quality controls, on this type's own duplicate
	// schema, for the reason 0192 gives — the narrator runs its lore through
	// this type.
	//
	// Re-projected a fifth time by **0099**, again with the three lore gather
	// branches: `guaranteedMessages`, for the reason 0192 gives — the narrator
	// runs its lore through this type and reaches the same `keywordQuery` from
	// the same seam, so a window that exists on the reply pipeline and not on
	// the narrator is a difference no user could discover a reason for.
	"core:query/lorebook-triggers@1": "74f456fa99d6a",
	// A **new** type, so no migration and no bump — policy's own sentence,
	// "adding a new type is safe and needs no migration". Nothing else in this
	// table moved when it landed, which is the check that says the declaration
	// really is additive: it declares its own ports and its own two parameters
	// and spreads nothing from a sibling, so no existing content hash could
	// follow it. See `ranking/keyProposal.ts` for what it binds to.
	"core:query/entry-keys@1": "7b6c180485049",
	"core:query/message-text@1": "13028fee53a4e1",
	"core:query/persona-card@1": "a0b05bce48983",
	"core:query/summarize-source@1": "172011b74d3c72",
	// Re-projected by **0201** (policy answer 3), retrieval plan phase 2: this
	// mechanism is wired into the shipped reply spec at last, and it gains the switch
	// that lets it be. `maxEntries` defaults to **0 — off** — on the
	// `admitThreshold` convention, so an upgraded install embeds nothing and
	// retrieves nothing through it until somebody raises the number. The type
	// also gains `optional`, which is what lets an admin skip the node outright
	// and what stops a missing embedding model costing anybody a turn: an error
	// becomes an empty result, and the plan's second governing rule (an
	// unavailable mechanism subtracts a signal, it never disables a path) holds
	// in the executor rather than only in prose.
	//
	// Re-projected by **0203**: `retrievalMode` is culled here too. It was
	// declared on both mechanisms so that neither could disagree with the other about
	// an undecided entry, so it had to leave both together — and it leaves them
	// agreeing for a better reason, since each now reads the entry's own column
	// and nothing else. See the lore gather branches' note above for the argument.
	//
	// Re-projected by **0099**, and this one is two contract changes at once.
	// `topK`'s default moves 12 → 40 because the binding read it off an in-port
	// name the node does not declare and ran on a literal `?? 40` — 40 is what
	// every install has actually searched at, so wiring the control must not
	// re-tune anybody. And `minScore: 0.35` is **culled** for
	// `similarityFalloff`: a floor removes a row from the pool, where no other
	// mechanism can reach it either, which is the one thing the governing rule
	// forbids. The replacement shapes the contribution (`cos ** falloff`) and
	// ships at 1 — the raw cosine, which is what ran while the floor sat unread.
	"core:query/vector-search@1": "132b49d9fcceb4",
	// The third retrieval mechanism (design §13.5), added 2026-09-06 — retrieval by
	// the names a scene is using, over annotations written in the background. A
	// **new** type id, so the registry inserts it and nothing conflicts: no
	// re-projection migration, on the same terms as the tool-calling pair below.
	"core:query/entity-search@1": "b8050d92df823",
	// The fifth mechanism (retrieval plan phase 4), added 2026-09-06 —
	// retrieval by *description*: a second named vector space holding one
	// vector per name, queried with the descriptive references the scene used
	// ("the captain" → Captain Vell). **New** type ids, so the registry inserts
	// them and nothing conflicts; the re-projection in 0202 is for
	// `rank-hybrid`'s new weight alone.
	//
	// `mention-spans` carries the mechanism's one switch (`maxMentions`, 0 = off) and
	// it is on the *first* node of the chain, so a switched-off mechanism reads
	// nothing and embeds nothing. `entity-link` takes the candidate list on an
	// in-port and returns it enriched, which is what makes "a link is a score
	// contribution, never an admission" a property of the ports rather than a
	// promise in a binding.
	"core:query/mention-spans@1": "773d78c837203",
	"core:query/entity-link@1": "103770dd960003",
	// Gained a `variables` slot for its post-budget lore and history in
	// 0.6-preview. Re-projected by migration 0108, on the same terms as 0107.
	// Migration 0095 — answer 3.
	//
	// `core:task/assemble@2` gained a `connection` slot. It calls nothing with
	// it: the only thing read is `metadata.promptFormat`, so the node that
	// renders the prompt can learn which wire format it is rendering for.
	// Nothing supplied that before — `prompt/assemble.ts` read an
	// `input.promptFormat` no port, slot or spec ever set — so every prompt
	// rendered as Vicuna whatever the connection said, while `dispatch.ts`
	// stamped the receipt with the connection's real format.
	//
	// A slot declaration is content, so the hash moved and the registry row is
	// a stale snapshot of code that no longer exists;
	// `drizzle/0095_prompt_format_reprojection.sql` deletes it so boot
	// re-projects. Every shipped spec wires the slot to the SENDING node
	// (`slot.connectionOf("generate")`), which is a shared reference and
	// therefore adds no option to the config panel — an untouched pipeline
	// gains no setting and, on a `vicuna` connection, renders identical bytes.
	//
	// Re-projected by **0113** (policy answer 3): three in-ports — `decisions`,
	// `messages` and `groups` (D-I, D-H). The first two were **supplied by every
	// shipped spec and declared by nobody**, and one of them is the input the
	// binding halts without; the third was published by
	// `core:task/rank-hybrid@1` and wired by nobody, so `allocate` ran on its
	// own `{}` while the ranker's per-band arithmetic sat one node upstream.
	// Undeclared cost more than tidiness: `validate.ts` skips its shape check
	// when either end of an edge is undeclared, so a plugin wiring the wrong
	// shape into this node got no finding at all.
	//
	// Not a retune. `allocate` copies `groups` onto `AllocatedContext.groups`
	// and reads it nowhere else, so every byte `render` walks is unchanged —
	// the parity corpus is identical across the change. What fills in is the
	// receipt's `sources`, empty on every run until now.
	//
	// Moved again 2026-09-10 by the blocks-parameters lane, and this is the
	// **first entry recorded under content addressing** — so it is the worked
	// example of what a moved hash costs now. There is no migration beside it
	// and there is no version bump: the slug's pointer moves to the new
	// declaration at the next boot, the declaration it moved off stays in
	// `pipeline_type_declarations`, and a receipt naming the old hash still
	// resolves. All that is required is this line, changed in the same commit
	// as the edit, which is what keeps the move visible in review.
	//
	// Moved again 2026-09-10: the template slot declares a SET of engines
	// (`engines: [handlebars, liquid]`) where it declared one, so Liquid is
	// selectable for the story string. Handlebars stays first, which is what
	// a new template here is still written in — the parity corpus is
	// byte-identical and no shipped row changes pool.
	"core:task/assemble@2": "1d97d036a0a3e4",
	// Tool calling's pure halves (20 §9), added 2026-08-26. New types — a
	// row inserts and conflicts with nothing.
	"core:task/advertise-tools@1": "b3b15a945f7e2",
	"core:task/parse-tool-call@1": "213e18d434bbb",
	// The three the tool loop needed beside them (20 §9, 01 §4a), added
	// 2026-09-10. All new types — a row inserts and conflicts with nothing, so
	// no migration. `run-tool` is the impure middle the two pure halves sit
	// either side of; `available-tools` is what the advertisement is built
	// from, a Query because which extensions are enabled is not a property of
	// a spec; `join-text` is the reduce a repeated block has always needed —
	// `map` and `loop` publish a list and every write takes a scalar.
	"core:query/available-tools@1": "426517ae42329",
	"core:provider/run-tool@1": "cc2a5c5df7d10",
	"core:task/join-text@1": "1d3d05a12133fa",
	// The native door (20 §9). `core:provider/generate-text@1` is published and
	// frozen, so a `tools` in-port and a `toolCall` out-port are a NEW pin
	// rather than two more lines on that one — which would move its hash and
	// need a re-projection on every install, for a capability most connections
	// do not have. One binding serves both.
	// Gained `params.streaming` with the other three providers.
	"core:provider/generate-with-tools@1": "b8e60704bfb8e",
	// The structured door, on the same terms as the tools one above and for the
	// same reason: `generate-text@1` is published and frozen, and this node does
	// not make the same request anyway. It asks a question rather than taking a
	// turn, so it declares no speaker and no attachments, takes a `schema`, and
	// publishes the parsed document instead of prose.
	// Gained `params.streaming` with the other three providers.
	"core:provider/generate-json@1": "7bac9bd9068a5",
	// Re-projected by **0102** (policy answer 3): a `sampling` slot, so the cut
	// can be clamped to the window the batch is actually sent against — the
	// binding read no sampling config at all, and there is no truncation on
	// this path to catch an overflow (`compilePrompt` returns early on an
	// injected prompt). Same shape and same argument as
	// `core:task/context-budget@1`. `batchTokens` also moves from 2048 to 2560
	// — a default is content, and the old number meant 548 tokens of chat once
	// the binding subtracted its reserve from it.
	"core:task/batch-messages@1": "3936f5e8dc834",
	// The narrator's half of the split (migration 0114). It shares this one's
	// implementation and ports; what makes it a separate type is that it
	// declares a different configurable surface — `narratorName`, and no
	// example-dialogue or relationship layouts. Adding a type needs no
	// re-projection: it inserts a row and conflicts with nothing.
	"core:task/build-narrator-context@1": "131936fee7832b",
	// The third context surface (ruling 2026-09-07), and a NEW type for the
	// same reason the narrator's was one: it declares a different configurable
	// surface. What separates it from the narrator's is a `speaker` IN-PORT —
	// a side character's name is data the trigger carried, different every
	// turn, where `narratorName` is a setting stored once. Putting it in a
	// prompts slot would mean editing a prompt config to speak as somebody
	// else, and every turn rendering with whichever name was stored last.
	//
	// ⚠ It also does NOT carry `currentCharacterId`, which the other two
	// context builders inherit from the shared shape. Character-lore
	// visibility is decided by the host read, which keys on the run's scope —
	// so a speaker id arriving on this node's port could change whose voice
	// the prompt is in without changing whose lore it was handed. `speaker`
	// carries the name and the card; the id stays where the host can act on
	// it. (Its absence is also what keeps it out of `UNFILLED_IN_PORTS` —
	// there is no port to excuse.)
	// ⚠ MOVED: two declared in-ports, `state` and `plan`, both unwired on the
	// pipeline that had this node first (`core:spec/narrate-character`), so
	// nothing it does changes. A voice built with no place in front of it
	// answered from whatever the transcript suggested.
	"core:task/build-side-character-context@1": "4db3df67c3a47",
	// Gained the `variables` slot in 0.6-preview (migration 0107), a
	// `speakerRelationships` layout when the graph query was wired in
	// (migration 0111), and lost `narratorName` from its `prompts` slot when
	// the narrator got its own type (migration 0114). Answer 3 above each
	// time, and the only reason it is legitimate is that no third party has
	// pinned this version yet.
	// Both context builders gained `currentCharacterId` with the provider
	// above (migration 0134, shared `contextPorts`): the prompt's voice
	// follows the same recorded speaker decision.
	// Re-projected by **0113** (policy answer 3): four in-ports (D-I).
	// `relationshipsPerspectives` and `relationshipsKnown` are wired by
	// `respond` and named by this type's own `variables` renders, so every part
	// of the round trip was written down except the ports. `speakerName` and
	// `speakerCharacter` are supplied by `bindings.ts`'s side-character
	// wrapper, which calls THIS type's handler with the name and the card
	// spread on — a supplier that is a sibling binding rather than a document,
	// which is exactly why the declaration is the only record that the input
	// surface is wider than the edges.
	//
	// ⚠ `build-narrator-context@1` is **not** re-projected. The four are
	// declared on this type rather than in the shared `contextPorts`: the
	// narrator has no speaker's perspective to build graph context from, so
	// widening the shared map would give it ports it must leave empty forever.
	// Moved by the `state` in-port: templates read `state.world.weather` off
	// the resolved session state, which nothing could supply before.
	"core:task/build-template-context@1": "6b960498d9527",
	/**
	 * The Adventure genre's three agent surfaces onto that same builder.
	 *
	 * New types, not edits — nothing above moves for them. They exist because a
	 * shipped prompt is resolved per (node type, slot) per spec: four agents
	 * sharing one context type would ship four agents one set of instructions,
	 * so four surfaces is four pools is four editable prompts. `build-scene-
	 * context@1` is the one with a `plan` port and `build-keeper-context@1` the
	 * one with `reply` and the `afterWrite` ordering edge.
	 */
	"core:task/build-planner-context@1": "8c4e2af04a8e5",
	"core:task/build-scene-context@1": "126ff7b99d32ac",
	"core:task/build-keeper-context@1": "46cff3ca4db9a",
	"core:task/chunk-text@1": "5cef916d3eef",
	/**
	 * A model's JSON answer, read back as data — the other half of asking for
	 * structure. `optional`, so a reply nobody can read subtracts the structure
	 * and not the turn.
	 */
	"core:task/parse-json@1": "626dd0656d27b",
	"core:task/set-state@1": "9628110ba5c34",
	/**
	 * The names a model used, resolved against this session's cast. A Query
	 * because resolving a name is a read; the same `ownerFor`/`slotFor` the
	 * three state tools use, reached from a JSON block instead of a tool call.
	 */
	// ⚠ MOVED: one declared in-port, `plan`, carrying the planner's world hints
	// — a required part of the plan's schema that no node read, so a turn that
	// planned a location left the world strip empty.
	"core:query/resolve-state-changes@1": "16e758af287e3d",
	"core:task/context-budget@1": "efdd9a915c681",
	"core:task/first-json@1": "13093e6bda129",
	// Re-projected by 0191 (policy answer 3). Two changes, one hash move: the
	// dead `strategy` and `dedup` parameters are gone — the binding read
	// neither, `strategy` was 0.5's engine choice that wiring replaced, and
	// `dedup` described what rank fusion does unconditionally — and the node
	// gained a `diagnostics` out-port, which is where it now says so when its
	// input orderings turn out to be disjoint.
	"core:task/merge-candidates@1": "1e44f4e71225d6",
	// The node the three lore gather branches wanted all along: concatenation, stamping
	// no score, so `rank-hybrid` still has signals to score and share bands to
	// budget between. A **new** type — a row inserts and conflicts with
	// nothing, so it needs no re-projection of its own.
	//
	// Identical hash to the merge above, and legitimately: the content hash
	// strips display text, and what is left (ports, timeout, no slots) is the
	// same declaration. The same coincidence the three lore gather branches and the four
	// turn strategies already have.
	"core:task/concat-candidates@1": "1e44f4e71225d6",
	// Re-projected by **0106** (policy answer 3). It gained a
	// `continuationPrefill` IN-port — and the seam it feeds is older than the
	// port: `prompt/messages.ts` has put `input.continuationPrefill` on the seed
	// line (the `-2` placeholder the model continues from) since it was written,
	// and `runtime/bindings.ts` has passed it through, with NOTHING able to
	// supply a value because the declaration had no port for one. So a continue
	// sent an empty seed, got a fresh reply, and the socket glued the partial on
	// afterwards. The declaration is what was missing (ruling 2026-09-08, D-2).
	"core:task/process-messages@1": "1078354c939461",
	// The same conversation for a step that READS it: no seed line, and no JSON
	// blocks left by an earlier turn for the next model to imitate. Both are
	// properties of the transcript rather than of the request, which is why they
	// are a node and not a flag on a provider: by the time a completion prompt is
	// rendered the seed is an open block inside one string.
	"core:task/prose-transcript@1": "1fce15d9ff8c59",
	"core:task/query-windows@1": "184fdf6f3a0762",
	// Re-projected by **0201**, and it is the one type in that migration nobody
	// set out to touch. Ruling R6 removes per-source floors — *"lore competes on
	// score alone"* — which narrows `minEntries` from the five bands to
	// `messages` only; that field lives on the shared `rankSlots`, so this type
	// re-hashes with `rank-hybrid` below. Noted rather than worked around: the
	// alternative is a second copy of the whole rank slot declaration, and 0195
	// records why `lorebook-triggers` keeping its own duplicate is tolerable
	// only because the two overlap in a single field name.
	"core:task/rank-by-recency@1": "aae1563fa43a3",
	// Both re-projected by migration 0146. rank-hybrid gained the nine
	// signal-weight fields — the tuning matrix `weights.ts` always held but
	// nothing declared; rank-semantic gained `sourceBudget` and
	// `defaultSourceBudget`, its last two undeclared constants. Every default
	// reproduces the shipped constants exactly, so an untouched spec selects
	// identically — `nodeParams.test.ts` and the parity corpus are the checks.
	//
	// Re-projected again by **0196** (policy answer 3): `scoreLedAllocation`,
	// the declared switch between the two allocation precedences (design §7).
	// `SelectOptions.scoreLedAllocation` was built and tested with no runtime
	// caller at all — this node is the only runtime `select()` there is — so
	// the inversion was reachable only from a unit test. It ships **false**,
	// the `admitThreshold` convention: an upgraded install selects exactly what
	// it selected before, and the parity corpus keeps measuring the shipped
	// path. The hash still moves, because a declared field is contract whatever
	// its default. `rank-by-recency` above is untouched — the field is spread
	// onto this type alone, like the signal matrix and for the same reason.
	//
	// Re-projected again by **0199**: a tenth signal weight, `signalProximity`
	// — how tightly an entry's matched keys clustered in the window, which
	// `signalKeyword` cannot see because it counts *how many* keys matched and
	// never *where*. The number is computed on every scan whatever this weight
	// is (it falls out of the key walk that was already happening), so the
	// weight is the only thing that decides whether it counts — and it is **0
	// in every band**. `rank-by-recency` is untouched again, and for the same
	// reason.
	//
	// Re-projected again by **0201** (policy answer 3), three changes and one
	// hash:
	//
	//   * `mechanismWeights` — the grouped keyword / semantic / name strengths
	//     (retrieval plan phase 3). The nine weights above are the right data at
	//     the wrong altitude, and this is the altitude a reader starts at. All
	//     three default to **1, which is neutral rather than maximum**: a
	//     multiplication by one is what already happened, so an untouched
	//     install scores exactly what it scored before. A new control *type*
	//     (`strengths`) rather than a `share`, because raising one takes nothing
	//     from the others and drawing them alike would teach the wrong
	//     arithmetic.
	//   * `signalSemantic` — an eleventh signal weight, for the cosine the
	//     semantic mechanism attaches. **Not zero**, unlike `signalProximity`, and
	//     deliberately: the *mechanism* ships off, so nothing carries the signal until
	//     somebody turns the mechanism on, and zeroing both would make raising the cap
	//     do nothing.
	//   * `minEntries` narrowed to `messages` (R6), shared with
	//     `rank-by-recency` above.
	//
	// Re-projected **again** by **0202** (retrieval plan phase 4), for one
	// field: `signalEntityVector`, a twelfth signal weight carrying the
	// mention→name link. 0.2 in the three lore bands, sized **strictly below**
	// `signalNameMatch`'s 0.25 as a rule rather than a preference — exact and
	// trigram matching own invented names, entity vectors own descriptive
	// references, and a similarity cannot exceed 1, so the link can never
	// outrank an entry whose title literally occurred.
	//
	// ⚠ `rank-by-recency` is **not** re-projected this time, unlike in 0201.
	// `SIGNAL_WEIGHT_FIELDS` is spread onto this type alone; only `rankSlots`
	// is shared, and it did not move.
	//
	// Re-projected by **0099**: `signalRecency` and `signalSceneAffinity` are
	// **culled**. Nothing has ever written `signals.recency` or
	// `signals.sceneAffinity` on any path in any release, so both weights
	// multiplied a permanent zero while being declared, transposed, scored,
	// persisted and rendered. `signalDensity` survives the same audit because it
	// now has a producer — the scan writes `density` on every candidate, as it
	// already wrote `proximity`. `runtime/signalWiring.int.test.ts` is what
	// makes that pair of facts a CI failure rather than a second audit.
	//
	// ⚠ `rank-by-recency` is again **not** re-projected: `SIGNAL_WEIGHT_FIELDS`
	// is spread onto this type alone.
	// Re-projected by **0113** (policy answer 3): a `groups` OUT-port (D-H).
	// `select()` has always returned what each band was allotted, spent and
	// filled, and the binding has always published it on this key — with
	// nothing declared, nothing downstream could learn it existed.
	//
	// ⚠ `rank-by-recency` and the `rank-recall` example are again **not**
	// re-projected: the port is spread onto this type alone, like
	// `SIGNAL_WEIGHT_FIELDS` and the `scripts` hook. Neither computes per-band
	// usage, and a port they cannot fill would be a promise neither keeps.
	"core:task/rank-hybrid@1": "a4ba08bbc5618",
	"core:task/rank-semantic@1": "d3849f48f8442",
	"core:task/render-entries@1": "7541eb6256ba5",
	// The four next-speaker strategies (19 §5, U-C4) — one implementation,
	// four ids, and one hash: the content hash strips display text, and what
	// remains (ports, timeout) is identical across the family, exactly like
	// the three lore gather branches above.
	"core:task/turn-round-robin@1": "cadef103232f2",
	"core:task/turn-random@1": "cadef103232f2",
	"core:task/turn-manual@1": "cadef103232f2",
	"core:task/turn-none@1": "cadef103232f2",
	"core:task/to-candidates@1": "174b5c86bb414b",
	// The `test:` fixtures are published by the same module as everything else,
	// so a running instance has rows for them and they freeze on exactly the same
	// terms. Editing one to suit an SDK test would stop pipelines on every
	// upgraded install — which is worth knowing before it happens, not after.
	"test:query/network@1": "c1601e776f664",
	"test:task/bad-toggleable@1": "594a2f094b17a",
	"test:task/gate@1": "cf73634860fe1",
	// ── Scripts (18) ────────────────────────────────────────────────────
	//
	// Published into the same registry under the same freeze rule. The seven
	// core contracts of 18 §3, one content scope per group.
	"core:script:text/transform@1": "14b3b24125511d",
	"core:script:text/stop@1": "1657b41ed5a2be",
	"core:script:messages/inject@1": "10feba4829eab3",
	"core:script:messages/transform@1": "48e7776bf623f",
	"core:script:candidates/filter@1": "5921c6940b28f",
	"core:script:candidates/rescore@1": "5921c6940b28f",
	"core:script:context/transform@1": "1a74f953c2e773",
	// The cast scope (2026-08-26): scripts over what extract-cast publishes.
	// A new type — inserts a row, conflicts with nothing, needs no migration.
	"core:script:cast/transform@1": "16b4355ec1eb01",
	// Local image generation: the modality twin of generate-text, same node kind,
	// its shape naming which one. A new type — inserts a row, needs no migration.
	// Gained a `params` slot, holding `streaming` alone — the node had none, so
	// the slot moves with the parameter. `off` means one request with no
	// progress polling and no previews.
	"core:provider/generate-image@1": "13b10d1a1ac974",
	// ── Entry types (Part 1) ────────────────────────────────────────────
	//
	// A lorebook row's kind, declared and versioned instead of being the table
	// it sat in. New types — a row inserts and conflicts with nothing, so no
	// re-projection migration is involved. What *is* worth knowing is what
	// moves these hashes: roles, render, source kind, export key, the anchor
	// policy and the declared `fields` schema are all contract, so changing any
	// of them is `@2` and not an edit here.
	"core:entry/world-lore@1": "1a6bd578150efc",
	"core:entry/character-lore@1": "7592f16899263",
	"core:entry/history@1": "4ea53ec3a9700",
	"test:task/passthrough@1": "cf73634860fe1",
	"test:task/sloppy-stream@1": "13093e6bda129",
	"test:task/slow@1": "cf73634860fe1"
}

/**
 * `release` is not hashed, so its value here is arbitrary.
 *
 * Script types are included, and have to be: they are published into the same
 * registry under the same freeze rule (18 §2), so a guard that only walked
 * `allTypes()` would let a script contract move without anyone noticing —
 * which is the one thing this file exists to prevent.
 */
const current = (): Record<string, string> => {
	const out: Record<string, string> = {}
	for (const entry of snapshotRegistry([...allTypes(), ...allScriptTypes()], {
		release: "test"
	}))
		out[`${entry.id}@${entry.version}`] = typeContentHash(entry)
	return out
}

const WHAT_TO_DO =
	"\n\nA pin now means something different from what it meant at this commit. " +
	"That is shippable — the slug's pointer moves at the next boot and no " +
	"migration is involved — but it must be deliberate: either bump the version " +
	"(the honest answer when the change breaks the specs pinning it), or record " +
	"the new hash here in the same commit as the edit. " +
	"Read the comment above PUBLISHED_HASHES before editing it."

describe("published type content hashes", () => {
	const now = current()

	it("resolves every recorded pin to the hash recorded for it", () => {
		const drifted = Object.entries(PUBLISHED_HASHES)
			.filter(([pin, hash]) => pin in now && now[pin] !== hash)
			.map(([pin, hash]) => `${pin}: recorded ${hash}, code ${now[pin]}`)

		expect(drifted, drifted.length ? WHAT_TO_DO : undefined).toEqual([])
	})

	it("records every type this build publishes", () => {
		// A new type is safe to add — this only keeps the file complete, so the
		// drift check above stays meaningful as the registry grows.
		const unrecorded = Object.keys(now).filter(
			(pin) => !(pin in PUBLISHED_HASHES)
		)
		expect(
			unrecorded,
			unrecorded.length
				? "\n\nNew type(s). Adding a type needs no migration — add the pin and " +
						"its hash to PUBLISHED_HASHES."
				: undefined
		).toEqual([])
	})

	it("still publishes every type it has published before", () => {
		// Deleting a published version orphans every spec that pinned it, which
		// fails at load rather than at boot. Deliberate removals update this file.
		const missing = Object.keys(PUBLISHED_HASHES).filter(
			(pin) => !(pin in now)
		)
		expect(
			missing,
			missing.length
				? "\n\nType(s) no longer published. Any stored spec pinning one of " +
						"these can no longer be loaded."
				: undefined
		).toEqual([])
	})

	it("ignores display text, which is the promise that lets labels change", () => {
		// The guard is only trustworthy if its exclusions actually hold: if
		// `i18n`/`description` leaked into the hash, every copyedit would read as
		// a contract change and the three tests above would cry wolf until someone
		// stopped reading them.
		const [entry] = snapshotRegistry(allTypes(), { release: "test" })
		const before = typeContentHash(entry)
		const after = typeContentHash({
			...entry,
			i18n: { name: { en: "Something else entirely" } },
			description: "and a different explanation"
		} as any)
		expect(after).toBe(before)
	})

	/**
	 * The same promise, two levels down, and against the SDK's answer.
	 *
	 * ⚠ The test above injects display text at the TOP of the entry, which is
	 * the only level `stripI18n` was ever exercised at — and that is how core
	 * and the SDK came to disagree without anything failing. A parameter's
	 * display text is **not** spelled `i18n`: settings.ts calls `label` the
	 * canonical key for a field or a member band and `i18n` its deprecated
	 * alias, and those sit inside `slots[].schema`. The SDK's descriptor
	 * registry has stripped `label` since `refuseUnlessIdentical` was written
	 * (`DESCRIPTOR_DISPLAY_KEYS`); core hashed it. So re-declaring a descriptor
	 * with a renamed parameter was a no-op in the SDK and, here, a
	 * `TypeRegistryConflictError` that `bootstrapPipelines` caught by returning
	 * early — silently stopping every pipeline on the install. The stop is gone
	 * (the slug's pointer moves instead), and the strips must still agree: two
	 * answers to *is this the same declaration?* would now silently move a
	 * pointer for a translated label.
	 *
	 * ⚠ **No shipped type carries a `label` today**, which is why the
	 * disagreement was latent and why closing it moved no recorded hash above.
	 * That is also why this test injects one: without it, nothing in the suite
	 * can tell the corrected strip from the old one, and a green suite would be
	 * evidence of nothing.
	 *
	 * The control is the half that makes it a test rather than a tautology.
	 * `max` is a range, and a range decides which stored values are still legal
	 * — so both sides must call it material, or "strips display text" would only
	 * mean "answers the same for everything".
	 */
	it("strips a parameter's display text at every level, and agrees with the SDK about which words those are", () => {
		const withParams = allTypes().find(
			(t: any) =>
				t.slots?.params?.schema &&
				Object.keys(t.slots.params.schema).length > 0
		) as any
		expect(
			withParams,
			"no shipped type declares a parameters schema, so there is nothing " +
				"to inject a label into and this guard is testing nothing"
		).toBeTruthy()

		const field = Object.keys(withParams.slots.params.schema)[0]!
		/** The descriptor with one extra key on one parameter, deep-copied. */
		const withKey = (key: string, value: unknown) => {
			const copy = JSON.parse(JSON.stringify(withParams))
			copy.slots.params.schema[field][key] = value
			return copy
		}
		const coreHash = (d: unknown) =>
			typeContentHash(
				snapshotRegistry([d as any], { release: "test" })[0]!
			)
		const sdkHash = (d: unknown) =>
			declarationHash(d, DESCRIPTOR_DISPLAY_KEYS)

		const base = withKey("__unused", undefined)
		for (const word of [
			"i18n",
			"description",
			...(DESCRIPTOR_DISPLAY_KEYS.display ?? [])
		]) {
			const renamed = withKey(word, { en: "Höchste K" })
			expect(
				coreHash(renamed),
				`core hashed a parameter's \`${word}\`, so translating it is a ` +
					`frozen-type conflict on every upgrading install`
			).toBe(coreHash(base))
			expect(
				sdkHash(renamed),
				`the SDK hashed a parameter's \`${word}\` — the two strips have ` +
					`come apart again`
			).toBe(sdkHash(base))
		}

		// The control: a range is contract on both sides.
		const widened = withKey("max", 999_999)
		expect(coreHash(widened)).not.toBe(coreHash(base))
		expect(sdkHash(widened)).not.toBe(sdkHash(base))
	})
})
