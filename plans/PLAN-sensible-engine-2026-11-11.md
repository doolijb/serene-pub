# PLAN — a sensible engine — 2026-11-11

**Status: GO 2026-11-11** ("Okay. Hash the rest of the plan, and get to work. Keep in mind nothing has shipped since the last pre release."). Part 5 records what that go covers and what still waits. *(Earlier line, kept for the record:)* Nothing here is a go. Rulings so far (2026-11-11): S4 (apply automatically, in book settings), S14 (who compiles what), U1 (the step line), T (context templates per genre; comprehension and fidelity first) and the round clock (§2.11) and the time since a property changed (§2.12). Planning is not go; every ★ waits on the owner; a go does not rule open ★s.

**Asked (owner, 2026-11-11):** "Draft up a plan for everything you've reviewed today that needs work. Lets consolidate
the data storage as much as possible. It needs to be sensible, reversable and colide as little as possible, with as few
storage locations as possible. It needs to be clear to modders where what kind of data belongs, and how it persists, or
doesn't persist."

**Source:** `plans/REVIEW-sensibility-2026-11-11.md` (sections A–G). Row ids below (A1, B4, G2.2 …) are that file's.
Evidence lives there; this file says what to do about it. Rows the review marked **? inferred** are re-verified by the
lane that takes them, before it changes anything.

**Shape:** Part 1 is the storage model (the design of record once ruled). Part 2 is every other workstream. Part 3 is
the rulings needed. Part 4 is order, lanes and verification.

---

## Part 1 — Storage: three story homes, one rule each

### 1.1 What is wrong today, in one paragraph

A turn can write to about fourteen separately coded places, each with its own undo (G1.1). Which lorebook a write lands
in follows three rules (G1.2). Whether Back takes it follows five (G2.1). When it becomes permanent follows nine
(G2.4). What a branch sees of it follows three (G3.1). All of that exists to make one thing safe after the fact: a
session writing **through** to a shared lorebook while it plays.

### 1.2 The model a modder sees

The owner's 2026-10-24 direction — "Three homes: **annex** = arbitrary data · **messages** = changes · **lorebook** =
lasting data" — becomes literally true, and the 2026-11-05 ruling — "All sessions have a lorebook, [own book] or
overlay. No exceptions so SDK data storage API is predictable" — becomes the only write path.

**The story has three homes. A modder picks by what the data is.**

| Home | What belongs here | A modder writes it with |
|---|---|---|
| **Messages** | What was said and what happened: lines, parts, recorded events, attachments. | `create-message` · `update-message` · `record-event` |
| **Annex** | The genre's or plugin's own working memory: a plan, a scratchpad, a counter, a toggle. Untyped; one document per owner; one key per fact. Scope `session` (this playthrough) or `lorebook` (the world's, e.g. a reputation ledger). | `set-annex-field` · `set-lorebook-annex-field` |
| **Lorebook** | Everything about the world: entries, cast and their versions, places, scenes, history, the story clock, links, and **stats** (a stat is a typed fact about the world, a person or a place). | lore outlets · state outlets · scene outlets |

**Outside the story — two more, and they never follow the story:**

| Home | What belongs here | Persistence |
|---|---|---|
| **Files** (`ctx.storage`, per plugin and per person) | Hidden state only the plugin's own code may read. | The plugin's alone. Never undone by Back, never copied to a branch, never exported with the session. The author gives it a lifetime. |
| **User annex** | A person's own preference for a plugin. | The person's. Not a story fact; no undo, no branch. |

Settings stay columns, set by people through forms (the "admitted fourth"). A modder never writes them.

That is the whole list. Core keeps none of its own story state anywhere else (§1.6).

### 1.3 How it persists — four rules

Each rule is marked **A** (reachable without changing where a session writes) or **B** (needs the one write path,
§1.4).

**Rule 1 — Reversible: a turn owns what it wrote. (A)** Every write made by play, in any story home, is anchored to
the message of the turn that made it. When that message is **replaced** (swipe, regenerate) or **leaves** (Back,
delete), everything it wrote goes with it, and Forward brings it back. Two cases, not four verbs (B4, A2, G1.5).

- Today a swipe or regenerate keeps annex writes (swipe only), clock ticks and scene boundaries; Back takes all three;
  delete takes ticks and not scenes. Under this rule a replaced turn's ticks and scene boundaries go too. A genre that
  re-tells without re-planning declares what it keeps, per annex field (`keepOnRetell`, a proposed name). The Dungeon
  Crawler declares its plan fields.
- A run a person started with a press anchors its annex writes to the newest message. Today those have no anchor and
  are permanent at once; own-book lore writes already anchor this way (`turnAnchorOf`).
- A person's own edit in a form is not a turn's write. It stands.

**Rule 2 — Permanent: only Apply. (B)** A session writes only to its own book. For a session on an overlay,
**Apply to the lorebook** — which exists today as a press, for new entries — moves changes into the parent. By the
book's setting (S4, ruled 2026-11-11) Apply happens by itself as each scene ends, or waits for the owner's press.
Either way Apply is the settle line: "Back stops at the newest line applied to the lorebook." A session whose
lorebook is its own book has no parent and nothing to apply.

**Rule 3 — Branch: the session as of one message. (B)** A branch is the messages up to the fork, the annex as of the
fork, and the own book as of the fork. Nothing the parent session does later reaches it, because the parent's later
writes are in the parent's own book (G3.2, G3.4). *Today this is not one cut:* own-book entries are copied by fork
message, but cast members **ride** the parent's through an overlay chain with a retire mark, stat rows are copied only
when the parent reads its notes alone, and attached-book rows are cut by story date. ST0 decides whether members keep
riding (two cuts, stated as such) or are copied (one).

**Rule 4 — Collisions: nobody shares a row until Apply. (B; per-key annex is A)** Two sessions on one lorebook never
write the same row. Annex changes are recorded per key, so two writers of one document do not undo each other. Apply
is the one place two sessions' changes meet, and a field the book has changed since is shown as a conflict.

**The page a modder reads** (top of the SDK storage guide, replacing "two kinds of data" and "the three storages").
Cells marked † are the target under B; ST1 first publishes the page true to *today*, exceptions named.

| | Messages | Annex (session) | Lorebook home | Files | User annex |
|---|---|---|---|---|---|
| Swipe / regenerate | replaced | taken, unless `keepOnRetell` | taken | untouched | untouched |
| Back / delete | leaves | taken | taken † | untouched | untouched |
| Forward | returns | returns | returns | — | — |
| Branch | copied to the fork | as of the fork | as of the fork † | not copied | the person's |
| Next chapter | per creation mode | per creation mode | per creation mode | not carried | the person's |
| Session deleted | deleted | deleted | own book deleted unless surfaced or a branch still reads it | **stays** — the author cleans up | stays |
| Reaches other sessions | never | never (`lorebook` scope: at Apply †) | only at **Apply** † — as scenes end, or on the owner's press | plugin's choice | same person |
| Who sees it | the channel | the field's audience | readers of the book | the plugin | the person |

### 1.4 Two stages, because one piece is missing

**The missing piece (challenger objection 1, verified).** A session's own book cannot today hold a *change to a row
that already exists in the parent book*. A lore outlet on the own-book route refuses with "entry N is not in this
session's lorebook, so it is not this session's to change" and "Both ends of a link live in one book"
(`pipelines/runtime/host.ts:1425-1429`). Apply moves new entries only (`lorebooks/ownBook.ts:1105-1110`). Only cast
members have per-row overlays (`lorebook_bindings.overlay_of`); places have the rule-fed overlay; entries, links,
history and scenes have nothing. So today's Full write-through is the only way an owner's session can amend the
owner's world while playing. Rule 2 needs that built first:

- **(a) overlay rows** — an own-book entry may be `overlay_of` a parent entry, as cast members are; or
- **(b) amendments** — the own book holds dated amendments to parent entries, reusing `entry_amendments` and the
  `asOf` resolver that lines already use.

ST0 chooses and sizes it. Until it exists, removing write-through would take an ability away from ordinary play.

**Stage A — make today's model honest.** No change to where a session writes. One undo rule; annex changes per key;
one router so Off and Review mean one thing; the hidden stat copy at scene close and session delete stopped; a
session-made line always stores a cut; "From this session" on the book; the modder page. This meets "sensible,
reversible, collide little, clear to modders" for everything except the count of locations.

**Stage B — one write path.** The missing piece, then own-book-only writes, Apply as the line, one branch cut. This
is what gets the locations down. It is gated on ST0's design and on ★S1.

### 1.5 What goes away

| Goes | Stage | Because | Review row |
|---|---|---|---|
| Four undo verbs with different flags; the swipe exception hard-coded for every genre | A | Rule 1. | B4, A2 |
| `annex_deltas` (whole-document before/after) | A | Per-key change records (§1.6). | G1.5 |
| Runtime keys and undo logs inside the `core` annex document; `TIMELESS`; the pipeline-read strip | A | The annex holds declared fields only. | G1.3, G1.4 |
| `recordToTimeline` at scene close and on session delete | A | A hidden second persistence; the delete path has no ownership check. Only stats scoped across sessions belong on the book. | G2.2 |
| Off and Review refusing scenes and summaries on one path and rerouting on another | A | One router: what the mode forbids lands in the own book; the mode never applies to the own book. | G2.3 |
| A session-made line with no fork date | A | It always stores a cut. | G3.2 |
| The in-memory review gate; six places held work waits | A/B | One durable held-changes list per session. | G2.5 |
| Write-through to an attached book (`loreWriteRoute` "book", `keepsValuesInOwnBook`, three routing rules) | B | One write path. | G1.2 |
| Lore write mode Full / Review / Off, at three levels | B | Nothing writes a real book except Apply. One fact per book replaces it: whether Apply happens by itself as scenes end, or waits for the owner (S4). | G2.3, B9 |
| Routine mode Review | B | A routine is Off or On. | G2.5 |
| Session-made lorebook lines: fork on first write, riding, compile forking another session's line | B | A session no longer writes the parent. Lines stay the author's tool. | G3.3, G3.5 |
| The "kept" imprint and Revert/Keep on a real book's entry | B | Un-applied writes are always the own book's. | G2.1 |
| Settle by self-reported `sources`; `history.settle: 'on-write'` | B | The line is the Apply press. `sources` stays as provenance. | G2.4, G2.7 |
| Stat values as a session layer beside the book's layers | B, design first | Today `session`, `seated_member`, `player_seat` and `session_location` values are session rows keyed by `session_id`, whose owner id is the *parent's* member or entry; `attribute_values` has no book column. Whether they can become own-book values, and how far the nine owner kinds can drop, is ST0's question, not a decided fact. | B5 |

### 1.6 One change record

Two physical shapes cover every story write, under Rule 1:

- **Rows a turn made** carry the turn: `(session, message)` on the row — messages, own-book entries, scenes, scene
  notes, stat value versions, clock moves, proposals.
- **Fields a turn changed** get one record each: subject, key, before, after, anchored to the turn.

`lore_imprints` is the second shape for lorebook rows today: per field, with splicing when a later run wrote the same
field. It cannot simply absorb the rest: `lorebook_id` is NOT NULL, its subject kinds are a CHECK, and its charter is
"a change to a lorebook row". Session annex keys, seat bench moves and ruleset conversions change session rows. So
this is either a widened table or a sibling with the same shape and the same retraction rule; either way the name goes
through NOMENCLATURE §24 and §25 (★S6). What matters is **one retraction rule**, the imprints' own.

Core's runtime state (turn order, turn tally, lane read marks, ruleset decks) leaves the annex for columns, where
settings and bookkeeping already live.

### 1.7 Storage lanes

Each lane ships with a generated migration or boot pass where it touches stored data, and a test that a second boot
changes nothing. The next migration index must exceed 0153.

| Lane | Stage | What | Depends on | Size |
|---|---|---|---|---|
| **ST1** | A | **The modder page**, true to today, exceptions named. `docs/sessions.md`, `lorebooks.md`, `stats-and-states.md` agree with it and with each other (A11, G2.1's two contradicting sentences). | — | S |
| **ST2** | A | **One undo rule.** Two cases; ticks and scene boundaries go with a replaced turn; `keepOnRetell`; press-started annex writes anchor. Fixes A2, B4. | ★S2 | M |
| **ST3** | A | **Annex per key; `core` annex holds declared fields only.** Seat bench and ruleset conversion records join the change record; runtime keys to columns; `annex_deltas` and `TIMELESS` retire. Session data panel shows declared fields, Clear per owner (G1.6). | ST2, ★S6 | M–L, boot pass |
| **ST4** | A | **One router, no hidden copy.** One function decides the book for every write kind, stated in one sentence. Off and Review never refuse on the own book. `recordToTimeline` limited to across-session stats; the delete path writes nothing (G2.2, G2.3). | ★S7 for the delete-path part before RC1 | M |
| **ST5** | A | **Session lines always store a cut; "From this session".** A clockless session's line cuts by message. The book lists what each session changed, with one take-back (G3.2, G2.6). Deleting the last session on a session-made line offers to delete the line (G3.3). Compile's refusal names the line (G3.5). Parent lists its branches (G3.6). | — | M, boot pass |
| **ST0** | → B | **Design pass, no code.** The missing piece (§1.4 a or b); stats in the book and the owner-kind mapping; the branch cut (members ride or copy); Apply's conflict rules; the upgrade path for sessions that already wrote through and for existing session-made lines; what `new-world` becomes; the lorebook annex under Apply. Then a `plan-challenger` round. | ★S1 direction | M |
| **ST6** | B | **Overlay of parent rows** (the missing piece), then **own-book-only writes**. | ST0, ★S1 | L, boot pass |
| **ST7** | B | **Apply is the line.** The book setting and the scene-end apply (S4); one held-changes list; conflicts shown; the settle line moves only on Apply, and the button and the automatic apply both say so; `sources` no longer settles; `on-write` removed; lore write mode retires. | ST6, ★S3, ★S4 | L, boot pass |
| **ST8** | B | **One branch cut**, per ST0. Session-made lines stop being created; existing ones folded or kept as author lines. On revision per ★S5. | ST6, ★S5 | L, boot pass |
| **ST9** | B | **Stats in the book**, per ST0. After seat-cast S5 and X-cardstats. | ST6 | L, boot pass |
| **ST10** | A | **Words.** Branch = a session. Line = the lorebook. `scope` one value set (G1.7). Stale comments and the 09-23 memory corrected. | — | S |

### 1.8 Challenger round (2026-11-11, one round)

A cold `plan-challenger` read Part 1 against the rulings and the code. Five objections; the lead verified 1, 2, 3 and
the schema claim in 5 before answering.

1. **The own book cannot hold a change to a parent row; ★S1 never said so.** *Accept.* §1.4 now names the missing
   piece, stages the work, and ★S1's trade-off carries it.
2. **Rule 3 reversed three unlisted rulings** (§30 "Fork what gets changed, when it gets changed"; §33 "retire mark
   (not kept rows) for branches; parent's never-surfaced notes outlive it while branches ride them"; ★H2 2026-11-10
   "the first-write fork carries the session's uncompiled scenes"). *Accept.* Rule 3 now says what is true today; the
   ⚖ lines are under ★S8; the "Session deleted" cell is corrected.
3. **The lorebook annex and `new-world` vanished from the model.** *Accept.* The lorebook annex is in the Annex row
   and the table; `new-world` is ★S9.
4. **"Sessions may apply changes to this book: yes / no" is a new setting that fails P3.** *Accept.* Dropped; Apply
   stays the book owner's press as built.
5. **Undecided things presented as decided** (stats "already in the own book"; `lore_imprints` "already is this";
   swipe ticks and scenes; press anchors). *Accept.* §1.3 marks targets with †, §1.5 states the stats row as a
   question, §1.6 states the schema limits, ★S2 names ticks and scenes.

### 1.9 Lessons taken from a field review (2026-11-11)

**Asked (owner, 2026-11-11):** "Grab what they do better that we can leverage." A review of how other tools in the
field handle automatic lore, session state, undo and branches was run the same day; its report and notes are kept
outside the repo. Each idea below was checked against this codebase first. Only real gains are taken, and each is
written here as a mechanism, in our own words.

**What the field confirms.** The products that get swipe, delete and branch right all do it the same way: an
automatic write is stored against the turn that caused it. The ones that get it wrong keep state where the turn cannot
reach. That is Rule 1. No tool in the field guarantees it for third-party code; a host that does is ahead.

**Taken into the plan**

| # | Lesson | What we have today | What changes | Lane | Size |
|---|---|---|---|---|---|
| F1 | **State at the fork message is a tested requirement, never state as it stands now.** The most common branch bug in the field. | A branch takes the annex as of the fork, but core's runtime keys and `annexAudiences` come across as they stand today (G1.4). | One conformance test: branch from an early message of a session that kept playing; every home must read as it did at that message. Added to the branch tests and to SDK conformance. | ST3, ST5 | S |
| F2 | **A regenerated turn never spends twice.** Anything a turn drew, rolled or counted goes back when the turn is replaced. | Ruleset decks are a runtime key that keeps "the values they hold NOW" across Back and regenerate. | Decks, draws and counters follow Rule 1 for a *replaced* turn as well as a turn that leaves. Widens ★S6. | ST3 | S |
| F3 | **Every change record says who made it.** A pipeline step, a routine, a pass a person started, or a person's own edit. | A change record carries the run id only; a person's write is a null run. | An origin on each record. It feeds "From this session" (G2.6), the cause shown beside an automatic change (P1), and the grouping in the Apply list. | ST3, ST5 | S–M, column |
| F4 | **Check for a near-duplicate in code before a lore write creates an entry.** The field's most admitted failure of automatic lore is the same person filed three times under three spellings. | `create-lore-entry` matches by exact name, a leading "the", or a key, and by a `match` the author supplies. | Before a create: compare the name against existing names and aliases on the session's reading, including a small spelling distance. A hit becomes a change to that entry, or a held "possible duplicate" for a person to settle. Never a silent second entry. Deterministic, no model call. | **ST11** (Stage A) | M |
| F5 | **Review is spent where a change can do damage.** New entries and new links are cheap; merges, replacements and deletions are not. | Apply lists new entries only, all alike. | In the Apply list: additive items go with one "Apply all". A change to something already in the book shows before and after and is confirmed on its own. A change to a character's profile always shows its diff. Shapes ST7 and ★S4. | ST7 | within ST7 |
| F6 | **Never apply blind.** A held change whose target has moved since it was drafted is flagged, and a generation whose sources changed while it ran is dropped. | `sources` are checked live at write time. Held changes are not re-checked at accept (to verify). | The held-changes list re-checks each item's target when a person accepts it and marks a stale one. | ST7 | S |
| F7 | **Editing an older message marks what was derived from it.** Nobody in the field does this. | `lore_sources` already records the stretch of messages each generated write came from. Nothing reads it when a message is edited. | When a person edits a message inside a recorded stretch, the entries and summaries written from it show "its source was edited since", with an offer to redo. A mark and an offer, never an automatic rewrite. | **ST12** (Stage A) | M |
| F8 | **Refuse or label; never guess.** When a take-back or a branch cannot be exact, say so. | Settled change records drop their `before`; upgraded 0.5 and pr-era data has rows with no anchor. | A take-back or branch that would need a missing record refuses with a sentence, or completes and is labelled approximate. Applies to ST2, ST5, ST8 and every upgrade path. | ST2, ST5, ST8 | rule |
| F9 | **Supersede, never overwrite, a fact about the world.** A change keeps what was true before, with its date. | Amendments and cast versions already work this way for authors. A session's `update-lore-entry` overwrites the field and keeps `before` only in the change record. | Decides §1.4's open choice toward **(b) amendments**: a session's change to an existing world entry is a dated change on top of it, held in the own book, visible as history after Apply. Recommendation to ST0, not yet a ruling. | ST0 → ST6 | — |
| F10 | **Tell a plugin that keeps its own files what happened.** Files never follow the story, so the plugin needs the facts to follow it itself. | `session-branched` names the new session and the fork message. `message-deleted` and `message-swiped` exist. Whether Back and Forward announce the turns taken is to verify. | `session-branched` also carries the map from old to new message ids. One announced event for turns taken back and restored, with the cause. Additive to published payloads. | **ST13** (Stage A) | S, SDK |
| F11 | **The modder page discourages the unanchored home.** | The storage guide opens with files first. | The page leads with the three story homes and says of files: for hidden state only; anything the story should take back does not belong there. | ST1 | — |
| F12 | **A derived index is a function of the live messages.** | Not verified in this review: whether search and embedding rows go when a message is deleted or replaced, and what a branch reads. | Verify first. If rows outlive their message, the index joins Rule 1. | ST5 (verify) | S–M |
| F13 | **A person's edit survives a rebuild.** An automatic re-summarise or recompile must not overwrite what a person typed. | Rule 1 already says a person's edit stands. Compile "always merges via the model"; whether a hand-edited day keeps its edits is to verify. | Verify, and state it on the modder page and in the lorebook docs as a guarantee. | ST1, ST4 (verify) | S |

**Already here, nothing to take.** Routines leave the newest lines alone until play has moved past them (`minAge`).
Summaries are drafted and confirmed before they land. A replacement starts from the state before the replaced turn.
The own book is copied to a branch inside the branch's own transaction. A sentence that applied changes are not taken
back is already Rule 2's.

**Considered, not taken.** A session that reads its lorebook frozen as of its start instead of live (nobody asked;
the "pinned to a moment" ruling of 2026-09-23 is still open). Merging one branch into another (no tool in the field
has it either). Storing messages as a tree with state folded over the active path (a different model from sessions
and branches as built).

**Where this would put the engine.** No tool in the field combines lore scoped to the branch with review scaled to
damage; each exists alone, and both arrived within the last two months. Stage B has both, plus F7, which none has.

### 1.10 Who compiles what (RULED 2026-11-11)

**Owner, 2026-11-11:** "In book settings, also have automatic graph compile and history entry compile on date
advancement settings as well. One less thing for most users to manage. The pipelines will live where the source
material is, i.e. where the shape is known. Sessions own scene compilation. Books own history entry compilation and
graphs."

**The charter (P2, P6).** A pipeline is registered at the scope that owns its input.

| Work | Input | Owner | Where it runs | Where the result lands |
|---|---|---|---|---|
| **Scene compilation** — a scene's summary and notes (*summarize* in the interface and code) | the session's messages | **the session** | a session routine, under the session's genre | the session's own book, anchored to the turn; reaches the lorebook at Apply |
| **History entry compilation** — a day's entry from its scenes | the lorebook's scenes for that day | **the lorebook** | a book-scoped pipeline | the lorebook's history entry for that date |
| **Graph** — relationships between entries | the lorebook's entries and scenes | **the lorebook** | a book-scoped pipeline | the lorebook's graph |

**Book settings — three automatic behaviours, in one place, set by the book's owner:**

1. **Apply as scenes end** (S4).
2. **Compile a day's history when the date advances.**
3. **Build the graph automatically.**

"One less thing for most users to manage" is read as: all three **on by default**, each switched off in book settings.
That supports the reading taken for S4.

**How the three chain.** A session closes a scene and compiles it (session). Apply moves the scene into the lorebook
(S4). When the lorebook's date moves past a day that has uncompiled scenes, the lorebook compiles that day's entry
(book). The graph follows what the lorebook now holds (book). Each step's input is owned by the scope that runs it.

**Where the code starts from.**

- History compile already runs without a session and says so: "Book-scoped: the history compile has no session to
  resolve through — book-scoped registrations come after pr-6 (A12, ruled 2026-10-24)" (`sockets/scenes.ts:1204`).
  It resolves its model by the text capability default, not through a registration. Book-scoped registrations are
  ruled and unbuilt; this ruling is what they are for.
- `core:spec/graph-build` is declared in the Story genre's catalogue file and a shared file, and is dispatched from
  the graph socket and the scenes socket. The Story sweep proposes graph ties from inside a session. Under the
  charter the build is the lorebook's; a session may still write a tie as lore into its own book.
- Compile today is a press that "shows you the changes before anything is saved" (`docs/lorebook-time.md:25`), and
  it forks any branch session riding the line first (G3.5). With scenes arriving by Apply, a book compiles only
  scenes it holds, so that fork goes.

**What this settles in the review.** G3.5 (a Compile press moving another session onto a new line). The compile half
of G2.5 (who approves what, and where). B10's "an undated pipeline write uses story-now": a session stops writing
history at all; it writes scenes.

**Lane**

| Lane | Stage | What | Depends on | Size |
|---|---|---|---|---|
| **ST14** | A, then B | **Book-scoped pipelines and the three book settings.** A registration scope for the lorebook (A12). History compile and graph build move onto it. The two new settings, with their triggers. Every automatic run names its cause and can be taken back or switched off (P1). The Compile press stays for a book with the setting off. Under Stage A the book compiles the scenes it already holds by write-through; under Stage B, the scenes Apply delivers. | ★S14a–d | L, migration (settings columns), SDK |

---

## Part 2 — Everything else from the review

Grouped by who can build it without waiting.

### 2.1 Truth fixes — small, no ruling beyond a go

Each removes a place where the screen and the engine disagree.

| Lane | Rows | What |
|---|---|---|
| **T-turns** | A1 | The turn pool filters with `inPlay`, characters and player seats alike. A stored `characters: "all"` reads as active. |
| **T-layouts** | A3, A4, A5 | "Where this differs" block on the variable page; "Remove this pick"; one reason word per real cause in the inspector; the stale "Fix it in the pipeline's settings" message. |
| **T-models** | A6, C5 | The server fills Reply when the first model arrives, dialog open or not. Managed KoboldCpp: port only, URL computed. |
| **T-sdk** | C1, C7, C8, A9 | `assemble` and model-call oracles default their slots; the validator's warning becomes unnecessary. Script failures at an interior point absorb and record as port seams do. Speak and pick-sprite declare `optional: true`. "Stream speech" parameter removed. |
| **T-docs** | A11, G2.8, A12 | Lore write default in `system-settings.md` and `stats-and-states.md`; the plugin guide's two sentences; close-out's four triggers; the Genre page Events card removed or rewired (backlog R-5, already ★). |
| **T-readin** | A14 | "Read in?" names the first gate that stopped an entry; the chain switch hides while depth is 0. |
| **T-clock** | B11 | Any first clock move starts at the first story day; one default calendar for every new book. |

### 2.2 Session engine

| Lane | Rows | What | Needs |
|---|---|---|---|
| **E-bench** | A13, B6 | `benched_by` (person, genre, undo) and an optional reason on the seat; the skull, the cause label and "a person's later move wins" read it. One writer of `is_active`. Remove stops soft-removing; old rows still read. | ★E1; column |
| **E-turns** | B7 | One Turns group: Strategy absorbs "decided by" and Manual; pool params become declarations. | ★E2; mapping |
| **E-scenes** | C3 | Core default Manual with no triggers; Story and the Lair declare theirs. | ★E3 |
| **E-history** | B10 | No date means story-now; a coarser entry covers its finer dates. | ★E4 |
| **E-revision** | review §session 8 | Keep every turn shown only where a delete exists; On revision per ★S5. | ★S5 |

### 2.3 Settings and admin

| Lane | Rows | What | Needs |
|---|---|---|---|
| **P-rules** | B1 | Two named precedence rules — **nearest wins**, **limits only tighten** — declared per layered setting; scenes gain the preset layer. | ★P1 |
| **P-dead** | A10, D5, B8 | Build or delete the on-revision default and the two-factor control. Drop the dead columns. Routine caps: one pub cap, defaults ruled. | ★P2; migration |
| **P-advanced** | E | The hidden-controls line counts hidden settings that differ from default; the switch hides controls, never views or verbs. | ★P3 |
| **P-editors** | D7 | One editor each for Connections, Loadouts and Sampling: the rail view. Admin › Models links to them. | ★P4 |
| **P-env** | D8 | Behaviour switches leave env vars for Pub settings (plugins on/off is backlog R-4, already ruled). | migration |
| **P-id1** | D9 | One accessor for the single-row settings tables; no hardcoded id. | — |

### 2.4 Models

| Lane | Rows | What | Needs |
|---|---|---|---|
| **M-defaults** | A8, C9 | A transform's default is the core loadout declared `defaultFor`, claimed by the seed pass for every transform; the star exists only where core ships none. One-shot boot passes get a ledger. | ★M1; boot pass |
| **M-unfilled** | A7 | An unfilled loadout borrows the pair and keeps its own sampling, except context size. Scene prompt folds into Extraction. | ★M2 |
| **M-coload** | C4 | With a measurement: no setting, and the decision sentence on the status card. Without: one explicit choice, off by default. | ★M3 |
| **M-external** | C6 | External mode converts to a plain connection. | ★M4 |
| **M-sees** | review §models 8 | One "Sees: yes / no — because …" line per pair; read-only where the service decides. | — |

### 2.5 Pipelines, SDK and variable layouts

| Lane | Rows | What | Needs |
|---|---|---|---|
| **K-writes** | C2 | Every `shape.writes` key off unless declared; unknown keys refused at `genre()`. Stored plugin genres get the two keys filled at boot. | ★K1 |
| **K-grammar** | D4 | Registrations are the only grammar; `configs`, preset `bindings`, extra author presets refused in a sentence; stored manifests converted once. | at the squash |
| **K-ids** | C11 | One stored id form; no `.vN` suffix to type before 0.7. | ★K2 |
| **K-boot** | F | Boot refuses a registered core type with no binding or host case. Splitting the three large files is **not** in this plan. | — |
| **L-tiers** | B2, C10 | The author's per-step layout tier removed (name it in the template). A layout's `@N` is always its own; a pub's layouts get a fixed owner, no typed slug. | ★L1; boot pass |
| **L-preset** | B3 | Preset-level layouts removed; a preset differs by its context template. | ★L2; stored data |
| **L-handles** | D6 | Admin sockets address a step by node key. | ★L3 |

### 2.6 Deletions, at the RC1 squash

| Lane | Rows | What | Needs |
|---|---|---|---|
| **X-strokes** | D1 | Strokes removed from app and SDK; the column dropped. | ★X1 |
| **X-flip** | D2 | Already planned as seat-cast **S5**. Listed here so it is not planned twice. | — |
| **X-cardstats** | D3 | Backlog R-3 Part A. Removes the `card` owner kind, which ST9 wants gone first. | ★C1–C5 (backlog) |

### 2.7 Words and the canon

| Lane | Rows | What |
|---|---|---|
| **W-canon** | E | NOMENCLATURE: §25 and dated prose move to `plans/`; 🚧 stripped from built things; ⏳ only with a named expiry. |
| **W-copy** | E, review §world 6, 8 | People see **stat** and **sheet**; **cast** is the lorebook's; "Advanced" fold renamed; three idle timers in one unit. Each new or changed label goes through NOMENCLATURE §24 and §25. |

### 2.8 Staying ahead while this is built

**Owner, 2026-11-11, on a list of eight ideas:** "I'll leave it at your discression." Three are taken, because the
first two are cheap and say whether the lead is real, and the third is what a player notices. Each is still a
proposal with its own ★.

| Lane | What | Why | Needs | Size |
|---|---|---|---|---|
| **A-conform** | **"A turn owns what it wrote" as an executable requirement.** A new conformance case for the host, and a helper in the SDK's testing entry that runs a plugin's own spec through replace, take-back, restore and branch and asserts its annex, lore and stat writes follow. Includes F1 (state at the fork message). | Conformance has forty cases today and none covers undo or branch. This is the promise third-party code gets from no other host, so it should be something an author can run. | Rule 1 ruled (★S2); lands with ST2 | M, SDK |
| **A-measure** | **Measure the automatic lore-keeping.** A fixed set of transcripts run through summaries, scene processing, compile and the relationship sweep on a real model; count duplicate entries, contradictions and missed facts. A report, no code change. | The plan governs where automatic writes go, not how good they are. Other tools extract more as you play; there is no evidence yet on how ours compares. It also gives ST11 (near-duplicates) a baseline. | A model on the box; an isolated instance | S–M |
| **A-changes** | **"This reply changed" for players.** Under a reply, one quiet line of what the turn wrote — a new entry, a stat that moved, a scene that closed — each with its own undo. Reads the change record and its origin (F3). | P1 asks that every automatic action show its cause and how to undo it. The run inspector does this for admins only. | ★A1 (layout and copy; STYLE-GUIDE and NOMENCLATURE §24); after ST3 | M |

**Noted, not taken** (each wants its own proposal): keeping a branch's world by applying its own book to the parent;
per-person knowledge in a shared session (the 2026-11-10 lore visibility proposal); importing another tool's
branches, variables and chat-bound lore; a published stability policy with SDK 1.0; using the entity and embedding
connections for the near-duplicate check (a candidate inside ST11's design).

**Later, by the owner (2026-11-11: "This is probably something we can add later").** Per-character recall counts,
and gating what a character knows by exposure (participant knows · mentioned has heard of it · otherwise not known;
the scene as the unit; off until a genre opts in). Nothing in this plan builds toward it: no option, hook or column
is added for it now.

### 2.9 The scene step line: where a scene is, and where its day is (RULED 2026-11-11)

**Owner, 2026-11-11:** "In the messages widget and anywhere the session scenes are tracked, should have a 'step' line
with nodes that make it obvious what step the scene is in. Open, compiled, applied, etc. Same for dates that contain
the scene."

**Why it matters here.** §1.10 chains four pieces of work across two owners, and three of them now run by themselves.
The step line is how a person sees that chain, and it is the P1 surface for it: each node says what happened, what
caused it, and where to undo it or do it by hand.

**Names (settled by the lead, 2026-11-11, on the owner's "Use your best judgement. Proceed").**

- The thing is the **scene step line**, and for a date the **day step line**; a node is a **scene step**. Never the
  bare *step*: that word is a pipeline's (R3). ⚠ Not a pipeline step, not the first-run wizard's progress.
- A scene's second node is **Summarized**, not *Compiled*. In the interface and the code, *compile* already means
  the day's history entry ("Compile to entry", "Not yet compiled"), and a scene's own work is *summarize* ("Close
  and summarize", `summarize-scene`, `summary_status`). One word keeps one meaning (R1; §24 rule 3). The owner's
  "scene compilation" (§1.10) is this step; the charter keeps the owner's sentence and the interface keeps its word.
- **Closed** is not a node. A closed scene with no summary yet is at **Summarized**, waiting.
- The component is our own, after the first-run wizard's progress pattern, not the UI library's stepper (built for
  a wizard with a content panel per step).

**A scene's steps** (states are read from what is already stored)

```
 ●──────────●──────────●──────────○──────────○
Open    Summarized   Applied   In history   In the graph
```

| Node | Means | Read from today | Owner (§1.10) |
|---|---|---|---|
| **Open** | The scene is being played. | `opened_at_message_id` set, `closed_at_message_id` empty | session |
| **Summarized** | The scene is closed and its summary is written. | `closed_at_message_id` set; `summary_status` `none · running · review · done · failed` | session |
| **Applied** | The scene is in the lorebook. | Stage B: the Apply record. Today a scene lands in the book as it is written, so this node appears with Stage B. | Apply (S4) |
| **In history** | Its day's history entry has been compiled with it. | `history_entry_id` set | lorebook |
| **In the graph** | The graph has taken it in. | `graphed` | lorebook |

**A day's steps** — the same line for a date that holds scenes:

```
 ●──────────◐──────────○──────────○
Scenes    Applied    History     Graph
 3 of 3    2 of 3   (compiled)   (built)
```

A day's node is done when every scene of that day is past it; until then it shows the count.

**Each node has one of six looks**, never told by colour alone: done · current · running · **needs you** (a review,
a held change, a conflict) · failed · not for this scene (a session on its own book has no Applied node; a book with
no clock has no automatic History node, and shows the press).

**Each node is a control.** A done node opens what it made. A waiting node whose automatic setting is off offers
the press right there (Summarize, Apply, Compile). An automatic node names its cause ("applied when the scene ended") and its
take-back.

**Where it shows.** One component, everywhere a scene or its day is listed:

- the messages widget, on the scene's divider;
- the Chronicle widget and any core widget that lists scenes;
- session settings, scene list and scene editor;
- the lorebook's History list: each scene row, each day's row, and **Not yet compiled**;
- the summarize and compile dialogs, so a person sees which step the press is.

**One rule, one reader.** A single shared function turns a scene's stored facts into its step, and a day's scenes
into the day's step. Every surface and the SDK's scene shape read it; no surface works a step out for itself. Widgets
from plugins get the same step on the scene they are handed, so a third-party widget shows what core shows.

**Narrow widths.** Below the container width where five labels fit, the line collapses to its dots and one line of
text: "Step 3 of 5 · Applied". `aria-current="step"` on the current node.

| Lane | Stage | What | Depends on | Size |
|---|---|---|---|---|
| **U-steps** | A, then B | The shared scene-step function (a scene's, and a day's from its scenes); one scene step line component; mounted on the surfaces above; the scene shape's step for widgets; STYLE-GUIDE pattern entry; `docs/sessions.md` and `docs/lorebook-time.md`. Stage A ships the four nodes whose facts exist today; **Applied** joins with Stage B. | ST14 for the automatic causes | M, SDK (additive) |

### 2.10 Context templates: one per genre, per who the model is, per how it is asked (RULED 2026-11-11)

**Owner, 2026-11-11:** "The highest priority is model comprehension and reliable replies that are faithful to the
characters/prompt." And: "Context templates should also be split by genre/role/how they are invoked (need to come up
with a sensible divider), I don't think two genres should share templates."

**Where the code starts from.**

- A template's pool is `(node type, engine)` on the prompt-assembling node (`shared/pipelines/poolKey.ts`), so every
  pipeline of every genre draws from one pool. The docs say it outright: "Templates are **shared, not owned by one
  pipeline**" (`docs/context-templates.md`).
- Core ships six templates. One, **Default**, serves Story's reply, Story's narration, the side character and every
  Lair reply. The Dungeon Crawler had to leave it for its own two; Chat and the Guide have theirs.
- The pieces of a divider already exist, under other names: a channel's **voice** (`character · narrator · none`), a
  registration's **trigger family** (`event · action · routine`), and one context-building node type per part the
  model plays (`build-template-context`, `-narrator-`, `-side-character-`, `-planner-`, `-scene-`, `-keeper-`).

**The divider (★T1, proposed).** A context template belongs to exactly one genre, and inside it is filed by two
questions a prompt author must answer anyway. The words are working words until NOMENCLATURE §24.

| Question | Values | What it decides in the prompt |
|---|---|---|
| **Who is the model?** | **Character** (a seated or side character speaking) · **Narrator** (tells the world) · **Planner** (hidden: plans or keeps the record, answers data) · **Assistant** (talk outside the story) | The head: who you are, whom you write, whom you never write. |
| **How is it asked?** | **Reply** (answer the conversation's last line) · **Brief** (write from a direction: an action, an opening, a round's outcomes) · **Record** (read the story as material and answer data) | The tail: what the last turn is, and what the model must produce. |

Twelve combinations exist; a genre ships only the ones it uses. As a sketch from what core runs today: Story —
Character·Reply, Narrator·Brief, Character·Brief (side character); the Lair — Planner·Record, Narrator·Reply,
Character·Reply, Assistant·Reply (the Sanctum), Narrator·Brief (trap, reveal, rooms); the Dungeon Crawler —
Planner·Brief, Narrator·Brief; Chat and the Guide — Assistant·Reply, and Chat's with tools.

- **A picker offers only this genre's templates for this who and ask.** Copying one in from another genre is an
  explicit act that makes a new template.
- **A plugin genre brings its own.** Nothing of core's is offered to it by default.
- **Why this divider:** each value changes what the model has to understand, which is the owner's first priority.
  The trigger family alone does not (an action and an opening are both a brief); the node type alone does not (it
  says who, not how asked).

**What "no two genres share" costs, and one way to hold it.** About a dozen templates in place of six, several of
them near-identical today. Each genre can then be tuned for its own model comprehension without moving another's
prompt, which is the point. ★T2: whether the conversation loop and the reminder block are small shared parts a
template includes, or are written out in each. Recommendation: written out. Sharing a part is sharing a template by
another name, and these are the blocks a genre most needs to shape.

**Fidelity findings to build into the new templates** (template review, 2026-11-11; each ★ until tested):

1. **Example dialogue sits with the speaker's card, always.** Today it is placed only inside the post-history
   reminder, which is one unit held until the conversation passes 3,000 tokens (`pipelines/prompt/postHistory.ts`),
   so it is absent in the opening turns.
2. **The last turn is designed, not repaired.** Today a dispatch step (`endOnUserTurn`, ruled 2026-10-18) folds
   trailing text into the final turn in wording no template chose. Each who·ask template ends on a deliberate final
   turn: who speaks now, this turn's lore, how this character sees the others, where and when, the reminder.
3. **This turn's lore and relationships leave the middle** of the system block for that final turn.
4. **Identity and the card stay at the top**, and are restated at the end. Never traded for prompt reuse.
5. **Story summaries read oldest first.**
6. **The speaker's own card is first or marked** in a group (to verify what happens today).
7. **Prompts:** Story's default reply prompt (about 1,100 tokens, written for large hosted models) tested against a
   plainer one; the narrator's prompt rewritten. JSON cards stay (the owner's tested choice).

**Test before changing.** The JSON card format was chosen side by side; the same method here. Fixed cards and
transcripts, current template against the candidate, on the local models users run. Scored in code where code can
(spoke for the player, wrong name, missing fact, length) and by a judge for voice.

| Lane | What | Depends on | Size |
|---|---|---|---|
| **C-test** | The side-by-side harness and a first run of the current Default against a fidelity-ordered candidate. A report; no shipped change. | a model on the box | M |
| **C-split** | Templates keyed by genre, who and ask. Core's templates rewritten as each genre's own. Pickers, the library and the admin list filed the same way. Docs: `context-templates.md`, `pipelines.md`, `genres.md`. | ★T1, ★T2, ★T3 | L, migration, SDK |
| **C-fidelity** | The seven findings above, applied per genre template as C-test supports them. Leaves byte parity with 0.5 on purpose. | C-test, C-split, ★T4 | M per genre |

### 2.11 Each round moves the clock (RULED 2026-11-11)

**Owner, 2026-11-11:** "While we are at it, lets make it so every 'round' moved the clock forward 5 minutes
automatically, with a simple setting in the sessions that opt in to the clock. Simple setting in the session would
suffice. Genres like guide that use real time would be an exception."

**Where the code starts from.** Story's reply already carries a tick: a `core:task/clock-step@1` step and the
*Advance story clock* outlet behind a junction, exposed to the session as **Each reply advances the clock by** (By and
Unit; By 0, the default, is off), under **The story** below the story clock (`docs/lorebook-time.md` about 110;
core-catalog `genres/story/respond.ts` about 365). It ticks per **reply**, so a four-character group ticks four times
a round. The host already raises `round-ended` on the story's lane (`sdk/src/events.ts` about 920), and routines
wake on it.

**The shape (decided by the lead inside the asked scope; ★ where a person sees it):**

- **Code decides (P1).** No model call: one small pipeline on `round-ended` that holds a clock step (By **5**, Unit
  minutes) and the *Advance story clock* outlet, the same two parts the reply tick uses.
- **Three opt-ins, all visible.** (1) The **genre** registers it in its defaults: Story and the Lair. The Guide and
  Chat run on real time and do not. The Dungeon Crawler already tells how long each round took, so it does not
  either. (2) The **session has a story clock** — its own, or its lorebook's present. A story with no clock is not
  started by this tick, and no line is written for it: otherwise every casual session would begin stamping its
  lines "Year 1, month 1, day 1". (3) The **session setting**, one number under **The story** below the story
  clock: **Each round advances the clock by ‹5› minutes** (0 turns it off).
- **It is a clock move like any other.** It leaves the usual line under the message that closed the round and goes
  back with that message, as a reply's tick does today.
- **The per-reply tick stays as it is, off by default.** ★R1: with a per-round setting beside it, retire the
  per-reply one? Recommendation: yes, at the next pre-release; it shipped in pr-7, so removing it is the owner's call.

| Lane | What | Depends on | Size |
|---|---|---|---|
| **E-roundclock** (`sense-clk`) | The round-clock pipeline, its registration in Story's and the Lair's defaults, the "has a clock" condition, the session setting, docs (`lorebook-time.md`, `sessions.md`, `genre-story.md`, `genre-lair.md`), NOMENCLATURE §25. | after `sense-sdk` (both re-pin SDK goldens) | M, SDK |

### 2.12 A script can read how long since a property last changed (RULED 2026-11-11)

**Owner, 2026-11-11:** "Lets make sure a time delta since last save/update on a property is accessible by scripts."
"I.e. sleep could incriment down while awake, incriment up by x while asleep."

**Where the code starts from.** A ruleset function's body receives an envelope (`src/lib/server/rulesets/functionRun.ts`
about 426–452): for each attribute role, `values` and `bounds`, plus the moment's `event`, the `session` and its
`settings`. Nothing says when a value was last written. The sandbox pins `Date.now()` to 0 on purpose, so a body
cannot work it out for itself. A stat's value row carries the message that wrote it (`valid_from_message_id`), and
the docs say every line is stamped with the story clock as it stood when written. A rule can already recur each
whole hour a clock move crossed (`core:function/recurring@1`, `rulesets/clockHours.ts`).

**The shape (decided by the lead inside the asked scope):**

- **The host hands the delta in; the body never reads a clock.** Beside `values` and `bounds`, each attribute role
  gets, per attribute, the **story time since that value was last written**, in minutes. Deterministic: the same
  inputs give the same number, and it is on the run's record.
- **Story time by default; real time by opt-in** (owner, 2026-11-11: "yes on real time as well, opt in of course").
  A value on a story with no clock, or written before the story had one, reads as "not known" in story time, and
  the body decides what that means. Real elapsed time since the value was written is handed only to a function
  whose declaration asks for it. The host takes "now" once for the moment and puts it on the run's record, so the
  body still never reads a clock and a re-read of the record gives the same number.
- **Derived, not stored.** From the value's writing message and that message's clock stamp against the clock now.
  It follows Back, Forward and branches for free, and resets when the value is written, so a rule that drains by
  elapsed time cannot apply twice.
- **Every door a script reads a stat through** gets the same fact, additively.
- **What time a ruleset needs is declared, and fit measures it** (owner, 2026-11-11: "and it should be a measurable
  against ruleset compatibility"). A function says which time it counts on (story, real, or both); the real-time
  opt-in above is that same declaration. A ruleset's need is the sum of its functions'. A genre says which time it
  keeps. `rulesetFit` (the rating behind "Story: Great · Lair: Good" on the Rulesets and Lorebooks views and the
  start form's Rules card) weighs the two and says why in a sentence: rules that count story time on a genre that
  runs on real time would never move. **Genres expect, never lock:** a rating and a sentence, never a refusal.
- **The sleep example is the test.** One meter, one awake/asleep state: after a clock move the body lowers the meter
  by a rate times the minutes while awake, and raises it while asleep; run again with no time passed, it changes
  nothing.

| Lane | What | Depends on | Size |
|---|---|---|---|
| **E-since** (`sense-age`) | The fact on the function envelope and on any other script read of a stat; SDK types and the rulesets guide; `docs/rulesets.md`; NOMENCLATURE §25. | after `sense-clk` (SDK repo, one lane at a time) | M, SDK (additive) |

---

## Part 3 — Rulings needed

One line each. ★ marks the recommendation. ⚖ quotes the ruling it would reverse or narrow.

**Storage**

- **★S1 — Direction: a session writes only to its own book; the parent changes only by the owner's Apply (Stage B).**
  ★ Yes as the direction, built only after ST0 designs the missing piece (§1.4). Stage A goes ahead either way.
  ⚖ 2026-10-16 lore writes default **Full** (write-through). ⚖ ★M3b-W-1 (2026-11-05) values on the owner's book.
  ⚖ 2026-11-05 §31: "a branch's first book write makes a book-owned line" and "versions live on book lines, a session
  branch forks a line". In line with 2026-11-05 "overlays can have their parent merged in place".
  *Trade-offs:* (1) two sessions on one book see each other's changes when a scene ends, not turn by turn; (2) with
  the book's automatic apply off, a serial player presses Apply where today nothing is pressed; (3) until overlay
  rows or amendments exist in the own book, a session could not amend or link to an existing world entry at all, so
  that must be built first.
  *If no:* Stage A alone. The surprises go; three routing rules become one stated rule; the location count stays.
- **★S2 — Two undo cases.** ★ Yes. A replaced turn's clock ticks and scene boundaries go with it; a genre keeps what
  it declares (`keepOnRetell` per annex field). ⚖ 2026-10-17 "a swipe re-tells, never re-plans (Dungeon Crawler)"
  becomes that genre's declaration. Changes today's "a replacement keeps every boundary where it is".
- **★S3 — The settle line moves only on Apply.** ★ Yes (Stage B).
  ⚖ 2026-10-24 "Present = generated from the story → committed; line = max(sources)" and "`history.settle:
  'on-write'` = the ONE preset-proof lock".
- **S4 — RULED 2026-11-11: "Lets make it apply automatically in book settings."** Changes apply to the lorebook
  automatically, and the control is in the lorebook's own settings, set by its owner. No pub, user or session layer.
  - **Reading taken, to confirm (supported by S14's "one less thing for most users to manage"):** automatic is the
    **default**, and the book setting is where its owner turns it
    off (then changes wait for the Apply press). The other reading is a switch in book settings that starts off.
    Default-on keeps what an owner's session on their own book does today (the Full default, 2026-10-16), so it is
    an existing automatic behaviour audited under P1, not a new one.
  - **As recommended and not disputed (still ★):**
    - *When:* at the end of each scene and at Close out. Never every turn: each apply moves the line Back stops at.
    - *What:* additions and clean changes only. A change to something the book has altered since waits for a person
      (F5, F6).
    - *Never from a branch session.* A what-if does not write the world unasked.
    - *P1:* each automatic apply names its cause (the scene that ended) and can be taken back from the book's
      "From this session" list.
    - The start form's lorebook card shows the book's setting in one line.
  - **Open ★S4a:** a session whose genre keeps no scenes would apply only at Close out. Alternative trigger: next
    chapter. To settle in ST0.
  - A session whose lorebook is its own book has no parent, so the setting does not appear and nothing is applied.
  - Only the book's owner can apply, as built. A session on someone else's book always holds its changes.
  - Replaces the three-layer lore write mode with one fact per book. The setting's wording goes through
    NOMENCLATURE §24.
- **★S5 — On revision.** ★ Remove the setting; regenerate and delete confirmations offer "Branch first".
  ⚖ PLAN-rulesets §28 (2026-10-16).
- **★S6 — Core's runtime keys leave the annex for columns; one change record for session-row changes, named through
  NOMENCLATURE.** ★ Yes; ruleset decks follow Back, turn order and read marks do not. ⚖ 2026-10-24
  "`sessions.metadata` runtime keys → annex owner `core`"; ⚖ 2026-09-28 `retake-quietly` "is the annex's … not a
  column".
- **★S7 — What lands before RC1?** RC1 was proposed for 2026-11-16, never ruled. ★ ST1 and ST4's delete-path fix
  before RC1; the rest of Stage A as 0.6.x; Stage B as 0.7, confirmed at ST0.
- **★S8 — The branch cut (Stage B).** ★ ST0 proposes; the lead's lean is one cut by fork message with members copied.
  ⚖ 2026-11-05 §30 "Fork what gets changed, when it gets changed" (copy-on-write per member). ⚖ 2026-11-05 §33
  "retire mark (not kept rows) for branches; parent's never-surfaced notes outlive it while branches ride them".
  ⚖ 2026-11-10 ★H2 "The ancestor owns days up to and including the fork point, and the fork amends them… The
  first-write fork carries the session's uncompiled scenes." ⚖ 2026-09-23 "A fork made at NOW stores no date and
  therefore keeps following main", for session-made lines only (this part is Stage A, ST5).
- **★S9 — `new-world` and the lorebook annex under Stage B.** ★ The `new-world` copy becomes the session's own book,
  with no parent, so "this story changes its own world" stays true. A `scope: 'lorebook'` annex field lives in the
  own book and reaches the parent by Apply. Both touch published SDK promises (`guides/storage.md:411-472`, `:507`).

- **★S10 — Near-duplicate check before a lore create (F4).** ★ Yes; a hit on a name or alias becomes a change, a
  spelling-distance hit is held for a person. Changes what `create-lore-entry` does today for close names.
- **★S11 — Mark derived lore when its source message is edited (F7).** ★ Yes, as a mark and an offer to redo. New
  copy ("its source was edited since") through NOMENCLATURE §24.
- **★S12 — Plugin events (F10).** ★ Add the message id map to `session-branched` and one event for turns taken back
  and restored. Additive to published SDK payloads, so the owner's call.
- **★S13 — A session's change to an existing world entry is a dated change on top (F9).** ★ Yes as ST0's starting
  point for the missing piece in §1.4.

- **★A1 — The player-facing change line (A-changes).** ★ Yes, quiet by default, one line per reply, shown to whoever
  may see the thing that changed. Layout and copy to be proposed before build.

- **S14 — RULED 2026-11-11: sessions own scene compilation; books own history entry compilation and graphs;
  pipelines live where their source material is.** Book settings carry automatic history compile on date
  advancement and automatic graph build, beside S4. Open under it:
  - **★S14a — Defaults.** ★ All three on, read from "one less thing for most users to manage". P1: these replace
    presses a person makes today, so each automatic run must show its cause and its undo.
  - **★S14b — What "the date advances" means.** ★ The lorebook's story date moves past a day that has uncompiled
    scenes, by its clock moving or by a scene arriving dated later. One compile per day passed, oldest first. A book
    with no clock never compiles automatically; the press stays.
  - **★S14c — Does an automatic compile land at once?** ★ Yes, with the entry's previous content kept as a dated
    change so it can be taken back (F9). Today the press shows the changes first; a held review would put back the
    thing the setting removes.
  - **★S14d — When the graph builds, and which model.** ★ After a history compile and after an Apply that added or
    changed entries, once per batch. Book-scoped runs use the pub's capability default, as compile does today;
    members never see plumbing. Unattended runs count against the routine caps (B8).
  - **★S14e — The name of the book-level registration scope** and the three settings' labels: NOMENCLATURE §24, §25.
  - ⚖ Narrows 2026-11-10 "compiling forks a riding branch session first" (the fork is no longer needed once scenes
    arrive by Apply) and the Story sweep's session-side graph proposals. In line with A12 (2026-10-24).

- **U1 — RULED 2026-11-11: a step line on every scene and on the dates that hold scenes** (§2.9). The owner left
  its three open points to the lead ("Use your best judgement. Proceed", 2026-11-11); settled in §2.9:
  **scene step line** (never bare *step*); nodes Open · **Summarized** · Applied · In history · In the graph, and for
  a day Scenes · Applied · History · Graph; no Closed node; our own component. Recorded in NOMENCLATURE §25 when
  built. The owner may still prefer *Compiled* on the scene node; that would mean renaming the history use in the
  same change (§24 rule 3).

- **T — RULED 2026-11-11: context templates are split by genre, role and how they are invoked; no two genres share
  one. Model comprehension and replies faithful to the characters and the prompt come first** (§2.10). Open under it:
  - **★T1 — The divider.** ★ Genre, then *who the model is* (Character · Narrator · Planner · Assistant), then *how
    it is asked* (Reply · Brief · Record). Names through NOMENCLATURE §24: *role* and *voice* both have meanings
    already (a message's role, a scene character's role; a channel's voice).
  - **★T2 — Shared parts.** ★ None; each template is written out.
  - **★T3 — Templates people already made.** 0.6 is in users' hands and today's templates sit in one shared pool.
    ★ Each stays usable where it is in use, filed under that genre, who and ask; where one template serves two
    genres it becomes two. A boot pass with a second-boot no-op test.
  - **★T4 — Leaving byte parity with 0.5.** The Default is still held to it by a test. The owner said on 2026-08-22
    that parity is temporary: "once we get everything complete and satisfactory, we will evolve past parity."
    ★ Leave it for the reply templates when C-test supports the change; the parity corpus records each departure.
  - **★T5 — Do the instruction prompts follow?** They are pooled by node type and offered across genres too.
    ★ Yes, same divider, in the same pass.

**Engine** — ★E1 `benched_by` column and stop writing soft-removal · ★E2 one Turns group · ★E3 scenes Manual in core
(⚖ live-scenes ★1, 2026-10-13) · ★E4 coarser history entries cover finer dates (⚖ "partial dates are distinct", a
lead default).

**Settings** — ★P1 two precedence rules · ★P2 build or delete: on-revision default, two-factor control; routine cap
defaults · ★P3 hidden-controls count (⚖ ★C, 2026-11-10 "Works for me") · ★P4 one editor per model entity.

**Models** — ★M1 fixed defaults · ★M2 unfilled keeps its own sampling (changes behaviour on existing installs) · ★M3
co-load without a switch on measured machines (⚖ 2026-11-11 "manageable via the admin") · ★M4 retire External mode
(⚖ 2026-11-11 "5. keep").

**SDK and layouts** — ★K1 writes off unless declared (⚖ R-B, 2026-09-17) · ★K2 one id form · ★L1 remove the author
tier, fixed owner for a pub's layouts · ★L2 remove preset-level layouts (⚖ ★2, 2026-11-10) · ★L3 node keys on admin
sockets (⚖ SDK plan 05 §0a).

**Deletions** — ★X1 remove strokes (⚖ 2026-10-11 "we will revisit later") · ★C1–C5 card stats (backlog R-3).

---

## Part 4 — Order, lanes, verification

**Order**

1. **Now, on a go:** §2.1 truth fixes, ST1, ST10, the F1 conformance test, and ST4's delete-path fix. No rulings needed; small lanes, two
   supervisors at a time.
2. **After Part 3 is ruled:** Stage A — ST2 → ST3 → ST4, with ST5, ST11, ST12, ST13 and ST14 beside them — and ST0 (design pass + challenger) in
   parallel, read-only. Also the §2.2–§2.5 lanes whose ★ came back.
3. **At the RC1 squash:** §2.6, K-grammar, P-dead's column drops — the cheap moment for migrations.
4. **After ST0 and ★S1:** Stage B — ST6 → (ST7, ST8, ST9). ST9 waits for seat-cast S5 and X-cardstats.

**Shared files** — one lane per build each: `runtime/host.ts`, `sockets/sessions.ts`, `state/write.ts`,
`lorebooks/ownBook.ts`, `NOMENCLATURE.md`, the SDK registries. Storage lanes ST2–ST4 all touch `state/write.ts`, so
they run in sequence, never in parallel; ST5 stays out of that file.

**Lane ids** — `sense-<lane>` (e.g. `sense-ST2`, `sense-T-turns`). Briefs `plans/briefs/BRIEF-sense-*.md`; reports
`plans/REPORT-sense-*-<date>.md`.

**Every lane**

- reads the review row's cited lines first and re-verifies any **? inferred** claim before changing code;
- names nothing new without NOMENCLATURE §1, §24 and a §25 entry (`keepOnRetell`, `benched_by`, the change record's name, "Turns"
  are proposals until ruled; "Apply to the lorebook" exists);
- updates the `docs/<area>.md` it moves, in the same change;
- stored data: a generated migration or a boot pass, plus a second-boot no-op test; ids never hardcoded;
- runs only its targeted tests. One grouped verification at the end of each phase: `tsc`, `check`, `sdk:build` +
  `sdk:test` (never under a live `vite dev`), `npm test`, `build`.

**Walks owed by this plan** — on an isolated instance: Back, swipe, regenerate and delete over a turn that wrote all
three homes (ST2); a branch from mid-story on an overlay, then the parent plays on (ST5, again at ST8); two sessions on
one book, both Apply the same field (ST7); a real-data upgrade for ST3, ST5 and every Stage B lane (memory `reference_real_data_upgrade_check`).

**Not in this plan** — splitting `host.ts`, `sessions.ts` and `bindings.ts`; channel lanes, private messages, widgets,
images, the Windows and macOS process paths (not reviewed); the speech red list (unclaimed, awaiting the owner);
merging session branches; library write mode beyond naming it in B9.


---

## Part 5 — Hashed, 2026-11-11

**Owner:** "Okay. Hash the rest of the plan, and get to work. Keep in mind nothing has shipped since the last pre
release."

### 5.1 What "nothing has shipped since the last pre-release" changes

`v0.6.0-pr-7` is commit `1859099b` (2026-10-31): migrations through **0141**, speech included. Everything after it is
unshipped and uncommitted: migrations **0142–0153** and the programmes behind them (seat cast and character versions,
advanced controls, history one-per-date, variable layouts, benched seats, vision, co-load).

- **No upgrade burden for anything first stored after pr-7.** `session_presets.variable_layouts`,
  `pipeline_variable_templates.pub_default`, the bench columns, `koboldcpp_managed_co_load`, scene notes, the
  character-version tables: a lane may reshape or drop these with a generated migration and no boot pass. Only the
  owner's own dev data holds them.
- **Still required:** migrations are generated, the index exceeds the highest applied (0153), `0000`–`0093` stay
  byte-identical, and data that exists in 0.5.3 or in pr-7 keeps its forward path.
- **A conflict to surface, not settle:** 2026-10-05 "0.6 is in users' hands" (CLAUDE.md, standing) against 2026-10-19
  "0.6 pre-release builds carry no data guarantee; squash at RC1". Under the second, the ⏳ leftover-pick machinery
  (the 0151 data upgrade, the step panel's leftover lines) serves only pr-era databases. If pr-era data is disposable,
  it can be deleted outright instead of carried to 0.7. **Not done; the owner's call.**
- **Published SDK names are not freed by this.** The SDK at pr-7 is published; removing or renaming a name in it is
  still the owner's call.

### 5.2 Taken as ruled

| Item | Basis |
|---|---|
| S4, S14, U1, T | Ruled in the owner's words today (recorded in Part 3). |
| **S1 — a session writes only to its own book; the lorebook changes by Apply** | By implication: S4 ("apply automatically in book settings"), S14 (scenes reach the book, the book compiles) and U1 (an **Applied** step) all presuppose it. Built only after ST0's design pass. **Say so if this reading is wrong.** |
| T1–T5 (the template divider, no shared parts, existing templates migrate, leaving 0.5 byte parity, prompts follow) | The owner's "Okay." to the proposal as written. |
| The deferred idea (recall counts, exposure-gated knowledge) | "Probably something we can add later." Nothing is built toward it. |

### 5.3 Settled by the lead (no ruling reversed; pure recommendations)

S7 Stage A goes now, Stage B after ST0 · S9, S13, S4a go to ST0 · S10 near-duplicate check · S11 mark lore whose
source was edited · S12 the two plugin event additions (additive) · S14a–d as recommended (three book settings on by
default; "date advances" as defined; automatic compile lands at once with its previous content kept; graph after a
compile or an Apply) · S14e and every new label through NOMENCLATURE §24 when built · E1 `benched_by` on the seat ·
E2 one Turns group · P1 two precedence rules · P2 build the two-factor control · P4 one editor per model entity ·
M1 fixed transform defaults · M2 an unfilled loadout keeps its own sampling · K2 one stored id form · L1 no author
tier, a fixed owner for a pub's layouts · A1 the player-facing change line.

**Narrowed while hashing:**

- **M3 and M4 are withdrawn.** The owner ruled both on the morning of 2026-11-11 (co-load "manageable via the
  admin"; External mode "5. keep"). What stays from C4: the co-load decision sentence is shown on the status card,
  and a machine with no memory reading says so. C6 is recorded in the review and not built.
- **ST4's delete-path fix keeps the feature.** Recording stats to the book when a session is deleted is plan A22's
  behaviour. The fix is the missing ownership check, not removing the write; A22's table is otherwise kept (Review still writes the book on delete).
- **T-clock is the first half only**: a first clock move by an amount starts the clock, as a move to a time of day
  already does. One default calendar for every new lorebook changes what a new book looks like and waits.
- **F1's conformance test lands with ST3**, since it would fail today on the runtime keys ST3 moves.
- **A9 ("Stream speech") and G1.7 (`scope` values)** change published SDK names; they wait for the owner.

### 5.4 Still the owner's: each reverses or narrows a dated ruling

One line each will do. Until then the lanes that depend on them do not start.

| ★ | Decision | Ruling it touches | Blocks |
|---|---|---|---|
| S2 | Two undo cases; a replaced turn's clock ticks and scene boundaries go with it; a genre declares what it keeps | 2026-10-17 "a swipe re-tells, never re-plans" | ST2, then ST3, A-conform |
| S3 | The settle line moves only on Apply | 2026-10-24 settle by `sources`; `on-write` "the ONE preset-proof lock" | ST7 |
| S5 | Remove On revision; confirmations offer "Branch first" | PLAN-rulesets §28, 2026-10-16 | E-revision, part of ST8 |
| S6 | Core's runtime keys leave the annex for columns | 2026-10-24 runtime keys → annex `core`; 2026-09-28 `retake-quietly` | ST3 |
| S8 | The branch cut | 2026-11-05 §30, §33; 2026-11-10 ★H2; 2026-09-23 | ST8 (ST0 proposes first) |
| E3 | Scenes Manual in core; Story and the Lair declare theirs | live-scenes ★1, 2026-10-13 | E-scenes |
| E4 | A coarser history entry covers its finer dates | 2026-11-10 "partial dates distinct" | E-history |
| K1 | Every `shape.writes` key off unless declared | R-B, 2026-09-17 | K-writes |
| L2 | Remove preset-level variable layouts | ★2, 2026-11-10 | L-preset |
| L3 | Node keys on admin sockets | SDK plan 05 §0a | L-handles |
| P3 | The hidden-controls line counts changed hidden settings | ★C, 2026-11-10 | P-advanced |
| X1 | Remove strokes | 2026-10-11 "we will revisit later" | X-strokes |
| C1–C5 | Card stats removal | backlog R-3 | X-cardstats, ST9 |
| R-5 | Genre page Events card: rewire or remove | backlog | part of T-docs |
| — | Routine cap defaults (4,320 minutes, 12 runs) | never ruled | P-dead |
| — | Leftover picks: carry to 0.7 or delete now | §5.1 | — |

### 5.5 Build order from here

**Wave 1 (started 2026-11-11):** `sense-eng` — T-turns, ST4's delete path, T-clock · `sense-mod` — T-models.
**Wave 2:** `sense-lay` — T-layouts · `sense-sdk` — T-sdk without A9 · then `sense-clk` — the round clock (§2.11) · then `sense-age` — time since a property changed (§2.12) · `sense-mod2` — two leftovers from `sense-mod`.
**Wave 3:** `sense-doc` — T-docs without R-5, ST1, ST10 without `scope` · `sense-rin` — T-readin.
**Then, read-only:** ST0 (the Stage B design pass, with a challenger round) and C-test's harness design.
**Then:** the §5.3 lanes, in the order Part 4 gives, and the §5.4 lanes as each is ruled.
One grouped verification after wave 3: `tsc`, `check`, `sdk:build` + `sdk:test`, `npm test`, `build`, compared with
the red list the 2026-11-11 handover already records.

### 5.6 Stage B design: done, challenged, waiting on the owner (2026-11-11)

`plans/DESIGN-own-book-write-path-2026-11-11.md` is ST0. It solves §1.4's missing piece with changes held in the own
book, derives the held-changes list from the own book (no new table), and proposes nine stat owner kinds becoming
five. A cold challenger found five flaws and a lane collision; all are accepted and recorded at the end of that
file. **No Stage B lane starts, the "can run now" one included, until the owner answers the eight questions there.**
Two matter most: whether an applied change stays a row (so a branch can be cut off from what its original applies
later) or is folded in; and how an automatic apply is undone once the book has compiled and graphed.

### 5.7 What was built on 2026-11-11, and what each lane left open

Reports: `plans/REPORT-sense-<lane>-2026-11-11.md`. Briefs: `plans/briefs/BRIEF-sense-*.md`. Every finished lane had
a scope review; findings were fixed in follow-up lanes or by the lead, and are recorded in the reports.

| Lane | Built | Review row |
|---|---|---|
| `sense-eng`, `eng2` | The turn pool honours the bench. Deleting a session never writes to a lorebook its owner does not own. Every clock move starts the clock from one rule (`storyMoveStartOf`). | A1, G2.2, B11 |
| `sense-mod`, `mod2`, `mod3` | The server fills Reply when a managed model arrives, in one transaction that cannot overwrite a choice. Managed KoboldCpp's address follows its port. The reason a model was unloaded is on the status card. | A6, C5, C4 |
| `sense-lay` | **Where this differs** on a variable's page; **Remove this pick**; one inspector reason per real cause. | A3, A4, A5 |
| `sense-sdk` | A prompt step wires itself. A script failure at an interior point is absorbed and recorded. The turn pool's `all` says what it does. | C1 (half), C7 |
| `sense-rin`, `rin2` | "Read in?" names the first gate that stopped an entry, in the server's order, from how the session reads it. | A14 |
| `sense-clk` | `core:spec/round-tick`: each round moves the clock 5 minutes, in Story and the Lair, only on a clock that is set. | §2.11 |
| `sense-age` | A function declares which time it counts on, a genre which time it keeps, and ruleset fit measures the two. **The elapsed-time fact itself is not built** (★A below). | §2.12, part |
| `sense-doc` | The storage page for modders, true to today. Docs, comments and both ledgers brought in line. | ST1, A11, G2.1, G2.8, ST10 |

**Open for the owner, from the lanes** (beside §5.4's list and the Stage B questions in §5.6):

| ★ | Decision | Recommendation |
|---|---|---|
| **age-A** | How a script learns story time since a value was written. Deriving it gives wrong numbers (a message's clock stamp never moves; a character's change is filed under their latest line). | Stamp the story clock on each stat value at write: five nullable columns, one generated migration. Then build the envelope fact, opt-in real seconds and the sleep test. |
| **age-B** | Real-time rules on a story-clock genre also rate Poor. | Keep symmetric, or say real-time rules never lower a rating. |
| **age-C/D** | The Guide and Chat now show a fit rating for rulesets that count story time; a daily recurring rule counts as story time. | Keep. |
| **clk-3** | Two clock moves per round where Story's *Note what changed* (or the Lair's *Keep the books*) also moves the clock. | Owner's choice: accept; the round tick steps aside while that duty runs; a different default per preset. |
| **clk-1** | The setting shows on its own card as **By**, with no unit word. | Keep the derived card; add a label that says minutes. |
| **clk-5** | The tick needs a clock that is set; a lorebook whose present is only its newest dated entry gets none, and a clock with no date is refused at midnight every round. | One new declared read of "where the story stands, with a day". |
| **clk-4** | Story's Minimal preset says "nothing changes unless you change it" and the tick runs there. | Reword Minimal's description. |
| **R1** | Retire the per-reply tick. | Yes, at the next pre-release (published; the owner's call). |
| **sdk C1-oracle** | A model-call step defaults its own connection and sampling; only the speech step lacks them. | Build it when speech is assigned. |
| **sdk C8** | The sprite picker declared optional would show a second on/off switch. | Leave for now. |
| **eng-1** | The turn pool's `all` option now equals `active`. | Drop it at 0.7 (published). |
| **mod-1** | Set up chat's Done step: a **Use ‹model› in Reply** button when a model is present and Reply is empty. | Yes. |
| **mod-5** | `setManagedPort` and the binary install rewrite the address without checking the mode (pre-existing; could overwrite an External address). | Guard both by mode. |
| **rin-2** | Close the remaining "nothing reported" cases on the owner's path (one more query per read). | Yes, later. |
| **doc-1** | Next chapter is refused outright when the old session's close-out refuses for any reason but "nothing" (`sockets/sessions.ts:1532-1534`). | Looks unintended; fix. |
| **Q1** | `pipelines/registrations/write.ts` `comparable` re-writes a locked genre default every boot (key order). | Fix `comparable`; then core's `genres/defaults.ts` can use `setting()` again. |
| copy | Every new sentence in the reports' "Provisional copy" sections. | Owner's eye. |

### 5.8 Rulings of 2026-11-11, evening (owner's words quoted)

| ★ | Ruling | What it starts |
|---|---|---|
| **age-A** | "That's fine. I think we are okay just tracking stat time relative to the session." Built by `sense-age2`: migration 0154, `writtenAgo`, opt-in `realSeconds`. Lead decides its ★1 (keep the CHECKs) and ★2 (a renamed value keeps its old stamp; an added default has none). | done; ★2 is a small follow-up |
| **clk-3** | "In core genres we should have one default owner that moves the clock." Then: "Story should be round. Lair and dungeon I think need more management so maybe the routine? Maybe they can share the same session setting, sdk provides an API to grab the setting, if opted in and pipelines can act on it/choose to respect the interval". So: **one session setting** (opted in or not, and the interval); **one SDK read** of it; Story's round tick is Story's owner; the Lair's and the Dungeon Crawler's routine is theirs and may respect the interval; no second mover on by default in any core genre. | `sense-clk2` |
| **R1** | Per-reply tick: "Remove it. The setting mentioned allows pipelines to handle time arbitrarily". Published at pr-7, so stored settings get a forward boot pass. | `sense-clk2` |
| **S2** | "Yes, a turn owns what it wrote." Narrows 2026-10-17 "a swipe re-tells, never re-plans". | ST2 |
| **S3** | "Only Apply settles." Replaces 2026-10-24 settle by `sources` and `on-write`. | ST7 (Stage B) |
| **K1** | "Off unless declared." Replaces R-B, 2026-09-17. | K-writes |
| **E3** | Not as proposed. "Automatic unless off in the session or settings elsewhere. The minimal story preset is probably the only example where we will not automatically handle scenes as it's intended for as few llm calls as possible. We want to make it as seamless as possible for users and allow them to apt into more control and complexity". E-scenes is rewritten: scenes are handled automatically by default; a session can turn it off; Story's Minimal preset ships with it off. | E-scenes (needs a short design note first: what "automatic" does at each step) |
| **L2** | "Keep preset level, but sounds like we need to ship the choice with the full context template". L-preset is dropped. The per-genre templates (ruling T) carry their variable-layout picks. | folded into C-split |
| **X1** | "Remove." | X-strokes |
| **Stage B 1–2** | "Do what's best, least complex and easiest to manage without cornering us." Lead's decision: **(b) fold**, and a branch sees what its original applies; the change record keeps before, after, session and message for every fold, so a row view or a branch cut can be derived later without new data. Undo of an automatic apply: as ★ (it takes back the history compile and graph build it caused while those are newest; otherwise it says it cannot be undone). Questions 3–7 follow their ★. **Question 8 (stat owner kinds nine to five) changes published SDK names and stays the owner's.** | Stage B lanes may start after ST2 |

| **CLK2-1** | The Lair's clock: "Routine; Words only uses the round tick." Words only registers the round tick; if its routine is switched on, the routine takes over and the tick steps aside. | `sense-clk3` part A |
| **age2 ★2** | A conversion: "Renamed keeps its stamp." An added default has none. | `sense-clk3` part B |

| **E3, again** | What automatic scenes do: "These will be genre/preset responsibilities, not magic core behavior. I think scenes should be closed/created after several messages once the contextual/time/location/presence boundaries are clear. Not right on the latest round of messages. Compile scenes after several replies, not immediately, that gives time for changes to be made and helps make sure compilations are available by the time the messages are most likely to exit the context window." So: core does nothing by itself; a genre or preset declares it. A boundary is acted on only once it is several messages old and clear; a closed scene is summarized several replies later, and in any case before its messages are likely to leave the context window. | E-scenes, rewritten; a short design note first |
| **S5** | "Remove it." On revision goes; confirmations offer "Branch first". | E-revision |
| **S8** | "One cut at the fork message." Replaces 2026-11-05 §30 copy-on-change. | ST5, ST8 |
| **E4** | "Coarser covers finer." Replaces 2026-11-10 "partial dates distinct". | E-history |
| **S6** | "Move to columns." Core's runtime keys leave the annex; decks follow Back, turn order and read marks do not. | ST3 |
| **Stage B 8** | Stat owner kinds nine to five: "With Stage B, boot pass included"; old names accepted on read until 0.7. | Stage B |
| **C1–C5** | "Take the plan's recommendations": the lead lists them back before the lane starts, for a veto. | X-cardstats |
| **S7** | "Everything before RC1." RC1 waits for Stage B; 2026-11-16 no longer holds. | order |
| **age2 ★1** | Lead's decision: the four CHECKs stay (the same shape every other clock-stamped table carries). | — |

`replyRoad.int.test.ts` (2026-11-11): diagnosed as a 1 s test wait on a path that takes most of a second, plus a
stream hold that leaked into later cases after a failure. Test-only fix by the lead (20 s first-chunk waits, an
`afterEach` that releases the hold and settles session events): 20/20 twice. Open: whether the reply path's time to
first chunk has regressed (not measured).

**Later the same night (owner's choices, verbatim):** the Lair's clock — "Round tick in every Lair preset"
(replaces "the routine owns the Lair's clock" and the Words only special case; the keeper's round-worth branch and
the tick's step-aside gate go). A swipe of a round-closing reply — "Keep the round's move on a swipe" (★ST2-1 closed:
the one exception to the undo rule stays, documented). The Dungeon Crawler's reveal — "Follow the rule, change the
copy". `sense-st2` built the undo rule; its scope review found a scene boundary could be taken from under later
lines (high) and a failed re-tell could lose annex values (medium). Lane `sense-st2b` fixes both and applies these
three rulings. Lead's decisions on `sense-st2`: draws fold into ST3; a failed fresh Dungeon Crawler turn keeping its
plan is left; the name `keepOnRetell` stays.

### 5.9 The work queue, in priority order (lead, 2026-11-11 night; owner: "prioritizing your workload properly. Do so.")

The point of this programme is the storage consolidation. Until it lands, **no new feature starts**, and nothing is
added to a lane in flight. Order is by dependency, then by how much later work it unblocks.

| # | Lane | What | Gate to the next |
|---|---|---|---|
| 0 | `sense-clk4` (in flight) | Close the clock work: empty branches survive the store; Words only. Nothing more is added to the clock. | reports green |
| 1 | **ST2** `sense-st2` | One undo rule (S2): a replaced turn takes back what it wrote; `keepOnRetell`; press-started annex writes anchor. | scope review |
| 2 | **ST3** | Annex per key; runtime keys to columns (S6); `annex_deltas` retires. Boot pass. | scope review |
| 3 | **ST4 rest + ST5** | One router; session lines always store a cut; "From this session". | **Wave gate A:** full verification (`tsc`, `check`, `sdk:test`, `npm test`, `build`) and one walk on an isolated instance |
| 4 | **Stage B slice** | One thin path end to end before anything fans out: a session's change to one parent entry is held in the own book, applied (fold + change record), taken back, and seen correctly from a branch cut at a message. | works in the running app |
| 5 | **ST6 → ST7 → ST8 → ST9** | The rest of Stage B, in that order (owner kinds nine to five rides ST9). | **Wave gate B:** full verification, walk, real-data upgrade check |
| 6 | **K-writes, X-cardstats with strokes, E-revision, E-history** | Ruled removals and defaults. K-writes and X-cardstats change published SDK names; they go after Stage B so stored data is reshaped once. | scope review each |
| 7 | **E-scenes (design note first), C-split with layout picks, U-steps** | Genre-owned scene handling; per-genre templates; the scene step line. | **Wave gate C** |
| 8 | Everything else in §5.3 and the small open items of §5.7 | | RC1 |

**Step 3 is cut down (lead, 2026-11-11, after its inventory).** With Stage B before RC1 (S7), nearly all of ST4 and
ST5 would be built and then deleted: `plans/DESIGN-own-book-write-path-2026-11-11.md` D4 retires the router, its
three readers, `attachedOrOwnBookOf`, `ensureSessionLine` and the lore write mode; D12 stops sessions creating
lines; D8 is "From this session". So none of that is built in Stage A. What survives moves into the Stage B lanes:
the Off refusals on the own book (gone with the mode, ST7); the delete path (writes nothing once a session never
writes the parent, ST7; today it can still fork a line that outlives the session, `state/durable.ts:306-310`); an
origin on each change record (F3, B1/ST7); a parent session listing its branches (G3.6, a UI proposal, with ST8).
F12 is verified, no change: a rewound row is `is_hidden` and retrieval filters on that
(`embedding/ragContext.ts:462-469`, `db/schema.ts:3140-3150`); a deleted row takes its vector; a branch reads its
own copies. F13 is verified: compile overwrites a hand-edited day only when a person saves the review. Step 3 is
therefore **wave gate A itself**, then step 4.

**The change record is two tables, one rule (lead, 2026-11-11).** ST0's Q6 ★ was "widen `lore_imprints`"; ST3's
challenger round chose a sibling `session_imprints` 🚧 with the retraction rule in one shared pure function
(`retractionAct`). The sibling stands: session rows are never lorebook changes and never appear in "From this
session", and `lore_imprints.lorebook_id` stays NOT NULL. Stage B's ST3b lane is done by `sense-st3`.

**Wave gate A — passed, 2026-11-11 (lead).** `tsc` clean; `svelte-check` 0 errors (needs
`NODE_OPTIONS=--max-old-space-size=12288`; it aborts at the default heap); build green; app tests 24,499 of 24,540
pass, SDK 4,660 of 4,669. Reds caused by this programme are fixed (the round worth in five field-default
expectations and three SDK tests, the reply tick's SDK tests, `0155` in the attic list, two ratchet comments). Reds
left are other sessions' or on the known list: speech (`core:oracle/speak@1` unwired, `speak-message`, the speech
fields and `ownerSheetLatitude` in field-default expectations, `shared/speakMessage.ts` typing), `importBoundary`,
`paramsSlotWiring`, `coreRow`, `presetFallback`, `guideGrounding`, `scoreLedAllocation`, `narrateDraft.dom`,
`sessions.forms` (`askedRunId`), nine comment-ratchet files, untagged exports, `your-first-plugin.md` vocabulary,
three ruled-string counts. **Real-data check:** the production build on a scratch copy of the owner's data ran
0149–0155 cleanly ("moved the runtime keys of 4 session(s) (8 column value(s)); filed 0 seat-bench, 0
ruleset-conversion and 11 annex session imprint(s)"); a second boot ran none. **Walk on that copy:** a real Story
turn, the round tick's "Time passes: 5 minutes", a swipe (the round's move kept, once), Back and Forward; no server
or console error. Found: Back pressed about a minute after the reply was refused with "Wait for the reply to
finish." while nothing showed as running; it worked later (joins the `sessionGenerating` leftover in §5.7).

**Stage B so far, and a reorder (lead, 2026-11-12).** Built, reviewed and verified: `sense-b1` (a pipeline's change
to a lorebook entry is a held amendment; `0156_nappy_paladin`), `sense-b2` (Apply records everything, settles, runs
by itself at scene close unless that scene's summary waits, and can be taken back; owner 2026-11-12: "At scene
close, unless a summary waits"), `sense-b3` (the own-book route is whole for entries, places, history days and
links; Full's writes unchanged). Reports: `plans/REPORT-sense-b{1,2,3}-*.md`. Each brief went through a cold
challenger first, and each round changed the design; keep doing it.

**E-scenes moves ahead of the flip.** Automatic Apply needs scenes to close, and the default scene mode is
Suggested (a person accepts each boundary), so in default play held changes wait for a person. The owner's E3
ruling (genres close scenes by themselves, several messages after a clear boundary) is what makes Stage B seamless.
Order from here: **E-scenes** (design note, challenger, the owner's picks, lane) → **`sense-b4`**, the flip (Full
writes new entries, places, history days and links to the own book; the route's readers for these kinds retired;
an Apply from a session with `line_on_first_write` forks its line first; the `sources` settle goes for these
kinds; the pinned Full tests listed in the b3 report are rewritten) → cast members and ties → stats and owner kinds
→ the branch cut → the write mode retired for one lorebook switch → wave gate B.

Rules for the lead from here: one lane per domain, larger, each beginning with an inventory of the code it will
change; a brief is written only after the lead has read the cited lines; at most one lane at a time rebuilds the SDK
dist; hash pins are re-pinned once per wave, not per lane, when no other session is editing the catalogue.

`sense-clk2` built the clock rulings (report saved; the lead placed the `roundWorth` field in Story's and the Lair's
declarations and re-pinned). Still the owner's from §5.4: S5, S6, S8, E4, L3, P3, C1–C5, R-5, routine cap defaults,
leftover picks. Also open: age2 ★1 (keep the four CHECKs in 0154; recommended), Stage B question 8.
