# Rulesets

A **ruleset** is the set of rules a session's characters are played by: what they can carry, what can ail them, how a risky moment is decided and how time wears on them. Every session has one. Most play **Story**, which keeps no numbers and rolls no dice: what people carry, what ails them and the ways out of a place are all kept in words.

A ruleset doesn't depend on the genre. The genre decides how play runs (a chat, an adventure, a dungeon crawl). The ruleset decides how things are judged inside it.

:::note Early
Rulesets are new and still being built. A session plays its ruleset's default settings for now. Choosing settings per session comes later.
:::

## Which ruleset a new session plays

- **With a lorebook:** the session plays the lorebook's ruleset. A genre that only works with certain rulesets refuses a lorebook that uses another, and says which ones it plays.
- **Without one:** the ruleset you pick, or else the genre's own choice (Dungeon Crawler and Lair suggest **Vis Itineris**), or else **Story**.
- **How strict** starts at the genre's default: **Words only** for Story, **Rules** for Lair, **Rules and dice** for Dungeon Crawler.

## How strict

**How strict** a session plays its ruleset is one of three levels. Each level includes the ones before it.

| How strict | What the model is told | What is worked out for it |
| --- | --- | --- |
| **Words only** (the default) | A short note on how play runs, each character's sheet in words, the things that matter this turn. No numbers. | Nothing. Changes the model asks for are recorded as it said them: an item picked up, a condition gained. Nothing is rolled. |
| **Rules** | The same, with numbers, and the results of anything rolled. | Checks are rolled, bonuses are added up, and changes are checked against the rules before they're saved. |

:::note The names
**Rules** already rolls checks: the difference between **Rules** and **Rules and dice** is not dice but the ruleset's own scripts, which only **Rules and dice** runs.
:::
| **Rules and dice** | Shorter sheets, plus the results. | Everything **Rules** does. The ruleset's own scripts run here once they're available. |

A genre with no after-turn reckoning, like **Chat** or a **Minimal** Story, can only play **Words only**: it has no step that suggests what a moment should trigger, so nothing gets rolled.

### What the model sees, and what it doesn't

At **Rules** and above, the model gets results, not formulas. Something like "Ann swings her longsword: Hit" goes into the prompt. The roll behind it doesn't.

The ruleset only adds what matters this turn. That means the things a character uses or names in their action, what they have equipped, and the relationships between the characters in the scene. When the prompt runs out of room, each block gets shorter before anything is left out. A full sheet becomes a summary, then a single line.

A secret stat, or an item only its holder knows about, only shows up when that character is the one speaking.

## When the model asks for a change

The model can ask to change a stat or an item. Under **Rules**, every request is checked first:

- **Lowering or raising by an amount** ("health −5") is applied when it fits.
- **Setting a number outright** ("health is 14") is held for you to review. The ruleset works its numbers out, so it won't let the model overwrite one. The review card says why it was held. You can accept it or reject it.
- **Something that doesn't exist** (a stat the session doesn't track, an item nobody has) is refused and named. It never shows up as something you could accept.
- **Spending more than someone has** is refused.

Changes to the lorebook still follow your [lorebook writes setting](./stats-and-states.md). Under **Review changes**, they wait for you as usual.

## The dice line

When something is rolled, the ruleset keeps a short record of how it got the number:

```
d20 11 + 3 (Strength) + 2 (Longsword) + 1 (Longsword) = 17 vs 15
```

It reads as a sum, from left to right:

- the die and what it showed;
- each bonus, with where it came from in brackets (the stat, then each item or effect);
- the total;
- the target it was rolled against.

Dice whose faces are shown aren't counted a second time: damage reads `1d8 (5) + 3 (Dexterity modifier) = 8`. When a die is rolled twice and one roll is kept, both rolls are shown, like `d20 (4, 13, edge) 13`.

This line is for you, not the model. The story never includes it, and the model is never shown it. The genre decides where it appears, usually in a log beside the messages, linked to the message it belongs to.

How a total turns into a result depends on the ruleset. Most compare it with the target. Some also count how far over or under it landed, and some treat a natural 20 or a natural 1 as special. Every ruleset gives each result a plain word too, so a story told in words still reads "it works, at a cost" or "it goes badly wrong".

## Time

Some things wear off or come due as time passes: poison every hour, a curse at midnight. When a genre passes time (a rest, a journey, a scene break), the ruleset applies whatever falls due. Something set for a specific date needs the session to keep a story clock. Without one, the ruleset notes "needs a clock" and skips it. It never guesses.
