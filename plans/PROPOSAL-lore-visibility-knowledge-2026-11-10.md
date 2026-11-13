# PROPOSAL — Cast lore visibility and what cast members know — 2026-11-10

Status: **RESEARCH ONLY.** Not a plan and not a go. It came from the owner's note while ruling the Dungeon Crawler cairns.

## Owner (2026-11-10, verbatim)

"Cast/character lore, ad a visibility setting I.e. private, public/known, legendary. Worth taking another look into lore affinity/exposure after all these sprints so cast members can build a knowledge base over time with exposure"

## What exists

- **Character lore** (`core-catalog/src/registry/entries.ts:143-182`) is anchored by `anchorBindingId` under `core:policy/binding-visibility@1`. **No lore entry has a visibility field.**
- **Who reads it** (`pipelines/prompt/characterLore.ts:124-177`):
  - unanchored: the narrator only;
  - a seated member: its own voice;
  - a member voiced by a player seat: every prompt;
  - a background member: the narrator only (★4, 2026-11-08).
- **Cast member visibility** `normal | legendary | hidden` (`schema.ts:37`) acts on the relationship graph only. A legendary member is always among "figures everyone knows of" (`graphContextFormatter.ts:627-650`); a hidden member is left out of others' graphs. **It never affects lore.**
- **Relationship visibility** `secret | acknowledged | public` (`schema.ts:38`): "Only I know / We both know / Everyone knows". Secrets are never passed on cast-wide (2026-09-29).
- **§14 Knowledge (designed, not built)** (NOMENCLATURE:910-923) already names the owner's idea:
  - **visibility grade**: how widely known a fact is;
  - **firsthand**, **known**, **unfamiliar**, **universal**;
  - the rule "two clocks: when a fact became true and when someone learned it".
- **Inputs that exist for "learning":** scene participants and mentions (`scene_characters`), lore mentions in messages (`message_annotations.ref_entry_id`), cast presences, the story clock and line scoping.
- **Words taken (R1):** "exposure" is the value cascade's setting reach (NOMENCLATURE:262-272). "Affinity" survives only in a retired ranking weight.

## The gap

1. **Per-entry visibility.** The owner's three levels read as a §14 *visibility grade* on a cast-lore entry:
   - **private** = today's rule;
   - **known** = every prompt in the session reads it (today that's only possible by unanchoring, which loses whom it's about);
   - **legendary** = always in context. That overlaps the entry's `constant` flag, and "legendary" already means "always known" for members.
   - Lore is per book; "beyond this book" would be new plumbing.
2. **Knowledge over time.** Nothing records that a member *learned* something. That needs:
   - a dated, line-scoped "member M knows entry E since T (firsthand | told)" record with one owning module (P2);
   - the lore gate reading it as eligibility, never as a score;
   - a writer that's off in core and opted into by a genre (P1), with each learning showing its cause and undo.

## Recommendation

**Now:** no new field. The cairn pass ships as ruled, with three fixes inside the history build:
- **(1)** A fallen player's epitaph already reaches every prompt.
- **(2)** A fallen AI companion stays seated, so its epitaph would be read by nobody. ★ Should "a member whose version in force is `deceased` reads as background" apply, so the narrator reads it?
- **(3)** Dungeon Crawler's "people the party may meet" listing (`respond.ts:84`) must leave cairns out.

**Later (blockers only, nothing named yet):**
- a P6 charter settling cast-lore grade against relationship visibility, member visibility, `constant` and §14;
- a knowledge record (table, migration, line scope, retake-safe);
- the gate taking "knows" as eligibility, which means `binding-visibility@1` → a later @2, so don't bake today's four-branch rule into SDK 1.0 types;
- a writer opted into by a genre.

This should follow the S5 rename and the retrieval harness.

## Questions for later (not asked yet)

- **One vocabulary for entry grades and relationship visibility** (R1): private / known / legendary, or secret / acknowledged / public plus legendary?
- **"Legendary" lore:** known plus always in context (replacing `constant` on cast lore), or known across books?
- **Member `hidden`:** does it cap that member's entries at private?
- **Avoid "exposure"** (taken): use §14's **known**?

## Noticed, not done

- A departed player seat's lore still reaches every prompt. The player-seat clause (`characterLore.ts:155-162`) ignores `removedAt`, and `host.ts:4475` loads every `session_personas` row. That contradicts "a departed seat's member is background again" (NOMENCLATURE:353, ★s4-seat-4).
