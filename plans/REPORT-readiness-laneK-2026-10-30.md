# REPORT: readiness lane K (B4, ★F2), 2026-10-30

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write).

## Built

**SDK, `/home/jody/github/serene-pub-sdk`:**
- NEW `core-catalog/src/primers/ninth-mile.ts`: `NINTH_MILE_PRIMER_ID` and `NINTH_MILE_PRIMER` (🚧 @experimental).
  Freeform ruleset, `compendiumMode: 'referenced'`. The place: *The Ninth Mile* (a coaching inn). World-lore
  entries: *The crossroads*, *The old east road*, *The tale ledger*, *The household*. The lead: *The night the
  roads close*. No cast, relationships, calendar or clock (so making a lorebook from it never writes a second Nell).
- EDIT `core-catalog/src/registry/primers.ts`: `ninthMilePrimer` between Blank and Vis Itineris;
  `CORE_PRIMERS = [freeform, ninthMile, visItineris]`. `shippedKits()` keeps registration order, so it lists first.
- EDIT `core-catalog/src/index.ts`: primers export block only.
- EDIT `sdk-tests/primers.test.ts`: three ids, registration order, Ninth Mile shape, no-URL check for both worlds.

**App, `/home/jody/github/serene-pub`:**
- NEW `src/lib/shared/characters/starterCharacter.ts`: `STARTER_CHARACTER` (Nell Haverly: name, summary,
  description, personality, two-paragraph first message, no avatar), `starterCharacterCreate()`,
  `isStarterCharacterRow()` (own, unshared, non-persona, name and description exactly as shipped). + test.
- EDIT `src/lib/client/wizard/wizardPicks.ts` (+test): `CharacterStepOffer`, `ownStarterCharacter`,
  `characterStepOffers` → order starter, choose, create, library, import.
- EDIT `src/routes/+page.svelte`: the starter card under the step heading (default avatar, name, summary,
  **Comes with Serene Pub** chip, **Pick**). Pressing it emits `characters:create`; card shows **Adding…**
  (`role="status"`); the reply is matched with `isStarterCharacterRow` and picked; the card disappears and she
  shows in the Choose row with Change. A refusal reaches a named `useInterest("characters:create:error")`
  handler and shows inline (`role="alert"`), no toast. "Or add one" also shows when only the starter card is above.

## Verified
- SDK primer test: 9/9. App: `starterCharacter.test.ts`, `wizardPicks.test.ts` 26 tests pass.
- core-catalog `tsc --noEmit -p tsconfig.build.json` clean; app tsc filtered to lane files clean.
- Prettier: new files clean; `registry/primers.ts`, `primers.test.ts`, `+page.svelte` failed `--check` before too.

**For the lead:** `npm run sdk:build`, then svelte-check on `+page.svelte`; `starterKits.int.test.ts`; SDK suite;
real-app wizard click-through.

## New terms (lane W, §25)
- **starter character** 🚧 — shipped text offered first on **Pick a character**, created only when picked.
  ⚠ Not a **starter lorebook**; ⚠ not the §8 sense of "a card is a starter" (R3 qualifier).
- `STARTER_CHARACTER`, `starterCharacterCreate`, `isStarterCharacterRow`, `CharacterStepOffer`,
  `characterStepOffers`, `ownStarterCharacter`; `NINTH_MILE_PRIMER(_ID)`, `ninthMilePrimer`,
  `core:primer/ninth-mile@1` 🚧 (UI says **Starter lorebook**, never primer).
- UI strings: **Pick**, **Adding…**, *Couldn't add this character. Try again.*
- Content names: Nell Haverly, Tobin, Pip, Hollin Wood, Callow, the tale ledger (none previously in use).

## Docs hand-off (lane W / follow-up docs pass)
- `docs/getting-started.md` §4: Nell first, *Comes with Serene Pub*, no internet; pressing creates and picks her,
  then **Change**; the card hides while an unchanged copy exists and returns if renamed/edited; the "easiest
  start" line moves from the Library to Nell.
- `docs/lorebooks.md`: core ships two starter lorebooks, **The Ninth Mile** (Freeform, first: one inn, four lore
  entries, the lead *The night the roads close*, no cast) and **Brackenvale**; Nell comes from the wizard, so
  pairing her with the book gives one Nell.

## Left open
- Duplicate check is name + description; an edited Nell brings the card back (intended).
- `characters:create:error` carries no request id; a concurrent creator-modal failure could show under her card.
- The wizard's session does not attach the Ninth Mile; wiring `starterKit` into `sessions:create` is a product decision.
- Optional: integration case in `starterKits.int.test.ts` (clone `primer:core:primer/ninth-mile@1` → 1 location,
  4 world-lore + 1 lead, 0 characters).
