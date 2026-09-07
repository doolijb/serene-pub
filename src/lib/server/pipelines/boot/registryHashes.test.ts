/**
 * The frozen-type guard, as a checked-in fact.
 *
 * `syncTypeRegistry` refuses to republish a type version whose content changed,
 * which is the right rule — a spec that pinned `@1` would otherwise keep
 * compiling and start behaving differently. But look at what the refusal *does*
 * on a running instance: `bootstrapPipelines` catches `TypeRegistryConflictError`,
 * puts the message in `report.conflict`, and **returns early**
 * (`bootstrap.ts:90-96`). Specs are never seeded, the legacy migration never
 * runs, and pipelines quietly stop working. Nothing in the test suite notices,
 * because a fresh test database has no prior rows to conflict with — the
 * conflict only exists on databases that booted the *previous* build.
 *
 * So the failure mode is: add a parameter to a descriptor, all tests pass, ship
 * it, and every existing install loses pipelines on the next restart with a
 * message only the diagnostics screen shows.
 *
 * This file is the thing that notices. It records what each published type
 * hashes to today. Editing a descriptor changes its hash, this test fails on a
 * clean database, and the failure message says which of the three legitimate
 * answers applies. It is a snapshot on purpose: the whole point is that it can
 * only be updated deliberately.
 */

import { describe, it, expect } from "vitest"
import { allTypes, allScriptTypes, snapshotRegistry } from "@serene-pub/sdk"
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
 * `pin -> contentHash`, for every type this build publishes.
 *
 * **Do not update a line here to make a test pass.** A changed hash means the
 * contract of an already-published type version moved, and there are exactly
 * three correct responses:
 *
 * 1. **Bump the version.** Publish `@2` and leave `@1` in place for the specs
 *    pinning it. This is the default answer for a real contract change — a port,
 *    a parameter's default, a range, an enum's options.
 * 2. **You changed only display text.** Labels (`i18n`) and `description` are
 *    stripped before hashing precisely so they can change freely. If the hash
 *    moved, you changed something else too — find it.
 * 3. **You wrote a re-projection migration.** Migrations 0099 and 0106 delete
 *    the affected registry rows so the next boot re-projects them. That is
 *    deliberately narrow, only safe pre-1.0 while the versions in question have
 *    no third-party pins, and must not become the habit. If that is what you
 *    did, update the hash here in the same commit as the migration.
 *
 * Adding a *new* type is safe and needs no migration — just add its line.
 *
 * ## Migration 0176 — answer 3, fourteen entries at once
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
	"core:input/user-message@1": "1a716679673b88",
	"core:input/session-created@1": "18daad12cc8870",
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
	"core:provider/generate-text@1": "1afa3a513d82c1",
	"core:provider/graph-node-description@1": "175a464ce58684",
	"core:provider/graph-node-resolution@1": "15e22620687cf1",
	"core:provider/graph-perspective@1": "200c0141d4ebf",
	"core:provider/graph-pre-filter@1": "f017bf224984f",
	"core:provider/graph-state-detection@1": "16d24f04ed08c0",
	// Re-pinned when 14 was built out (the draft stub's hash never reached an
	// install — 0141's core wipe re-projects every row at boot).
	"core:provider/mcp-tool@1": "2a4ceca243862",
	"core:provider/mcp-resource@1": "9d9890414a3d8",
	"core:provider/name-entry@1": "17558940ee8508",
	"core:provider/speak@1": "e36fdde93956d",
	"core:provider/summarize-batch@1": "1432666fe0b3dd",
	"core:provider/summarize-synth@1": "eca4138224b4b",
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
	"core:query/world-lore@1": "39d8ee8377bf2",
	"core:query/character-lore@1": "39d8ee8377bf2",
	// Gained the `channel` param in 0.6-preview (migration 0149, 20 §7);
	// default 'main' reproduces the legacy read byte-for-byte.
	"core:query/session-history@1": "2272f3cfb8f4b",
	// ⚠ `core:query/graph-context@1` was here, and is gone rather than frozen.
	// It split into the two below, because one node emitting both directions of
	// the graph gave them one heading, one layout and one switch. Removing a
	// published pin is what the third test in this file exists to catch, and it
	// is allowed here only because 0.6 has not shipped: every stored spec
	// pinning it is a preview document, and `0124` deletes its registry rows
	// along with the specs that named it.
	"core:query/relationships-perspectives@1": "133fb1aab4e288",
	"core:query/relationships-known@1": "1a709dd0599745",
	"core:query/graph-scenes@1": "93cf67e05eb1",
	// The third gather branch, added in 0.6 after its absence was found: the
	// split into world and character lore left `history` with no node, so those
	// candidates were read, scored and dropped for two spec versions. A *new*
	// type needs no re-projection — nothing has published it before.
	// Re-projected by 0186, again by 0192, again by 0199 and again by 0203 with
	// the other two gather branches; see the note there.
	"core:query/history-entries@1": "39d8ee8377bf2",
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
	"core:query/lorebook-triggers@1": "1f435541958a17",
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
	"core:query/vector-search@1": "872e4ebb8f739",
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
	"core:task/assemble@2": "17af4eb13b2c67",
	// Tool calling's pure halves (20 §9), added 2026-08-26. New types — a
	// row inserts and conflicts with nothing.
	"core:task/advertise-tools@1": "b3b15a945f7e2",
	"core:task/parse-tool-call@1": "213e18d434bbb",
	"core:task/batch-messages@1": "1666e1b5864572",
	// The narrator's half of the split (migration 0114). It shares this one's
	// implementation and ports; what makes it a separate type is that it
	// declares a different configurable surface — `narratorName`, and no
	// example-dialogue or relationship layouts. Adding a type needs no
	// re-projection: it inserts a row and conflicts with nothing.
	"core:task/build-narrator-context@1": "131936fee7832b",
	// Gained the `variables` slot in 0.6-preview (migration 0107), a
	// `speakerRelationships` layout when the graph query was wired in
	// (migration 0111), and lost `narratorName` from its `prompts` slot when
	// the narrator got its own type (migration 0114). Answer 3 above each
	// time, and the only reason it is legitimate is that no third party has
	// pinned this version yet.
	// Both context builders gained `currentCharacterId` with the provider
	// above (migration 0134, shared `contextPorts`): the prompt's voice
	// follows the same recorded speaker decision.
	"core:task/build-template-context@1": "2ea90523e3006",
	"core:task/chunk-text@1": "5cef916d3eef",
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
	"core:task/process-messages@1": "8d63ae74798bb",
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
	"core:task/rank-hybrid@1": "7f9ce940b4c9e",
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
	"core:provider/generate-image@1": "1982c58b43b9ea",
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
	"\n\nA published type version is frozen. Bump the version, or ship a registry " +
	"re-projection migration (see 0099/0106) and update the hash in the same commit. " +
	"Read the comment above PUBLISHED_HASHES before editing it."

describe("published type content hashes", () => {
	const now = current()

	it("has not changed under any already-published pin", () => {
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
})
