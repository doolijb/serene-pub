# CHARTER (lead's draft, 🚧, for the owner) — the one time model of a lorebook (2026-11-15)

To be folded into `NOMENCLATURE.md` as one row group before lane T6 is built. It adds no storage and changes no
code: it states the one idea the screens already show, and how each stored mechanism maps to it, so later work
does not drift further apart. Every line marked ⚠ is a place where the mapping is not clean today.

## The one idea

**A thing in a lorebook has versions over story time, on a line. A reading is a line and a moment; it sees, of
each thing, the version in force there.**

- A **thing** is an entry, a cast member, a tie between two things, or a stat value.
- A **version** says what the thing is from a date on. The first version has no date (*From the beginning*) or
  the thing's **Beginning**.
- A **line** is main or a branch. A branch reads its ancestors' versions up to its fork, and its own after.
- A **reading** is what a session or the workspace uses: one line, one moment (or none: "as it stands now").
- The **Timeline switch** turns moments off for a lorebook: every reading is "as it stands now". Lines stay.
- An **edit** is not a version: it changes what a version says and is kept in the **edit history**, which is
  never part of a reading and never travels.
- A **turn's write** is a version (or a change to one) that its turn can still take back, until the story
  settles.

## How each stored mechanism maps to it

| Thing | A version is stored as | The first version | "In force" is decided by | Owner of the rule |
|---|---|---|---|---|
| **Entry** | a row of `entry_amendments` holding only the fields that differ (a *dated change*) | the entry's own row; its **Beginning** is the entry's own date parts | `amendmentsOnLine`: main, then each ancestor up to its fork, then the line's own; nearer line wins; then by date | `shared/lorebooks/lineReading.ts`; one writer `lorebooks/entryVersions.ts` |
| **Cast member** | a whole profile row of `character_versions` at (line, date, life point) | the member's base version | `versionInForce`: by date, then the higher life point, then write order | `characters/versions.ts` (the only writer) |
| **Tie** (relationship, way, knowledge) | a row of `narrative_relationships`, dated by the history entry or scene it is filed under | an undated row | `rowsOnReading` / `inForce`: latest story date, then nearer line | `state/reading.ts`, `state/resolve.ts` |
| **Stat value** | a row of `attribute_values` stamped with the story clock, plus the session's own ledger until it settles | the undated value | `inForce` over the stamps; the ledger for the session's own unsettled writes | the stats module; `sessions/settle.ts` compacts the ledger |
| **History entry** | not versioned: it *is* a date (one per date per line) | — | the line rule on its own date | `scenes/historyEntryOfDate.ts` |
| **Scene** | not versioned: it happened once; it may be filed under a history entry | — | its line; its stamps | the session |

## Where the mapping is not clean today (⚠)

1. **Two fold orders.** An entry's versions fold "nearer line first, then date"; a cast member's fold "date
   first". On a fork the workspace's client reader for cast (`castAsOf` over `amendmentsOnLine`) and the
   server's `versionInForce` can disagree; the cast rail follows the server, the roster and lists still use the
   client fold. One of the two orders should be named the rule for all four things.
2. **Sparse and whole.** An entry's version stores what differs; a cast version stores everything. The form
   hides this (it shows a whole version either way), but "what did this version change" is a stored fact for
   entries and a computed one for cast.
3. **Ties are dated by reference.** A tie has no date of its own: it borrows the date of the history entry or
   scene it is filed under. With the Timeline off, or a scene never filed, a tie has no place in time.
4. **Stats have a second, per-session store.** A stat's newest values live in the session's ledger until the
   story settles; nothing else does. A reading "as of a message" works only until the ledger is compacted.
5. **A life point is a second axis** only cast members have (a mind at another point of its own life). Nothing
   else in a lorebook has it.
6. **One version per (thing, line, date)** is enforced for a person's write of an entry and of a cast member,
   and for a dated session's direct write of an entry; **Apply** can still make a second row at a taken date
   (open for the owner).
7. **A turn's write is undoable for entries, entry versions, cast versions, ties and stats by four different
   records** (`lore_imprints` subjects, version take-back in `state/write.ts`, the stat ledger). The rule is one
   ("a turn owns what it wrote until the story settles"); the mechanisms are not.

## What this charter asks of later lanes

- A new time feature names which **thing** it applies to and uses that thing's row above; it adds no fifth
  mechanism. If it needs one, that is a decision for the owner before code.
- A reader takes a **reading** (line and moment) and never dates or lines on its own.
- Words: *version* always qualified (*entry version*, *cast version*, *card version*: a card's numbered
  versions are not on a timeline); *dated change* is the stored row of an entry version; *moment* is a reading's
  date; *line* never *branch* in copy where the lorebook is meant.

## Not proposed

Unifying the four stores into one. It would be a structural rewrite of data in users' hands for a gain the
screens already give.
