# Rules

The **Rules** a session plays by say how its characters are played: what their sheet tracks, what can go wrong for them and how it's decided, what they carry or suffer, how an outcome reads, and how time wears on them. Every session has rules, and so does every lorebook. Most play **Freeform**, which keeps no numbers and decides nothing itself: what people carry, what ails them and the ways out of a place are all kept in words.

Rules don't depend on the genre. The genre decides how play runs (a story, a dungeon you run, a dungeon crawl). The rules decide how things are judged inside it.

Rules don't have to mean dice. Some roll a die, some count a handful of dice or draw cards, some weigh one value against another, some have you spend from a pool, and some leave it to whoever runs the game. Serene Pub comes with three:

| Rules | How a risky moment is decided | What a character carries |
| --- | --- | --- |
| **Freeform** (the usual) | In words: the story says how it goes. | Things, conditions and the ways out of places, all in words. |
| **Vis Itineris** | A d20 plus a modifier against a difficulty, read as four degrees from a big miss to a great hit. | Abilities, health, level and class; weapons, armour, gear, spells and conditions. |
| **Wherewithal** | No dice: a risk is carried by spending from a pool, a contest weighs one person's mettle against another's, and anything else is judged. | Three pools to spend, bonds with other people, troubles and boons. |

## Plays best with

A genre doesn't track anything itself: a session's stats are its rules' alone (see [Stats and states](./stats-and-states.md)). Instead, a genre says what it **plays best with**, by what each thing is (its tag): Story plays best with a health-like number, a mood word, what ails someone and somewhere to keep what they carry; the Dungeon Crawler with a health and a level to count, and the kinds of kit a hero carries. The start form's **Rules** card lists them as **Plays best with …**, rates each set of rules against them (**Perfect**, **Great**, **Good**, **Ok**, **Poor**), and, for the rules you pick, says what it will tell in words instead, and why. Nothing is locked: rules that lack something play that part in words, and rules of your own that don't follow core's conventions are always playable. An attribute or kind of entry is found by its tags (or its own id), so tag yours (`health`, `mood`, `level`, `condition`) to match.

Rules that declare no attributes, such as **Freeform**, keep no stats at all: the sheet and the session's **Attributes** settings say _This session's rules declare no attributes_.

## Which rules a new session plays

- **With a lorebook:** the session plays the lorebook's rules. A lorebook's rules are picked under **Rules** when you make it (**New**, in Lorebooks), and changed in its **Book settings › Rules**; a new lorebook plays **Freeform** unless you pick others. A lorebook on Freeform brings no rules of its own, so the session's rules are yours to pick, as with no lorebook. A genre that only works with certain rules refuses a lorebook that uses others, and says which ones it plays: at the start, and when you read that lorebook into a session later. A lorebook read in before the story is underway gives the session its rules (if it has its own), just as choosing it at the start does.
- **Without one:** the rules you pick, or else the genre's own choice (Dungeon Crawler plays **Vis Itineris**; the Lair plays **Freeform** unless you pick others or its **The rules decide** preset, which plays Vis Itineris), or else **Freeform**.
- **Afterwards:** a session keeps the rules it started with. Changing a lorebook's rules changes them for the sessions you start on it from then on, not for the ones already reading it.
- **How strict** starts at the genre's default: **Words only** for Story, **Rules** for Lair, **The rules decide** for Dungeon Crawler.

Some rules come with options, such as how spells are paid for. A session picks them under **Rules options** in its settings, one at a time or with a preset that picks several at once; only the session's owner can change them, and a change applies from the next turn.

## How strict

**How strict** a session plays its rules is one of three levels. Each level includes the ones before it.

| How strict | What the model is told | What is worked out for it |
| --- | --- | --- |
| **Words only** (the default) | A short note on how play runs, each character's sheet in words, the things that matter this turn. No numbers. | Nothing. Changes the model asks for are recorded as it said them: an item picked up, a condition gained. Nothing is decided by the rules. |
| **Rules** | The same, with numbers, how many actions a turn holds where the rules count them, and how anything the rules decided came out. | Risky moments are decided the rules' way (see [below](#how-a-risky-moment-is-decided)), bonuses are added up, changes are checked against the rules before they're saved, and the rules' own scripts run. |
| **The rules decide** | Shorter sheets, plus the outcomes. | Everything **Rules** does. Some genres do more here: the Lair's **Decide checks at once** works only at this level. |

Rules that decide nothing themselves, such as **Freeform**, play only **Words only**: the start form doesn't ask. A session with no reckoning routine (**Note what changed**), like **Chat** or a **Minimal** Story, can only play **Words only** too: it has no step that suggests what a moment should trigger, so nothing gets decided.

### What the model sees, and what it doesn't

At **Rules** and above, the model gets outcomes, not formulas. Something like "Ann swings her longsword: Hit" goes into the prompt. How it was decided doesn't.

The rules only add what matters this turn. That means the things a character uses or names in their action, what they have equipped, and the relationships between the characters in the scene. When the prompt runs out of room, each block gets shorter before anything is left out. A full sheet becomes a summary, then a single line.

A secret stat, or an item only its holder knows about, only shows up when that character is the one speaking.

## How a risky moment is decided

A moment that could go either way is a **check**: picking a lock, swaying a judge, holding a door. Each set of rules says how its checks are decided, in one of six ways, and may use different ways for different checks:

- **One die against a target.** Roll a die, add a modifier, and meet or beat a target. How far over or under says how well it went. Vis Itineris rolls a d20.
- **A pool of dice.** Roll as many dice as a stat says and count the ones that come up high enough. More successes, a better outcome.
- **Draw cards.** Draw from a shuffled deck and add a modifier against a target. The deck remembers what has been drawn, and is shuffled again each scene (or only when it runs out).
- **Compare, no chance.** One value against another's, or against a target. The higher wins; nothing is rolled.
- **Spend to succeed.** Spend from a pool: what is spent buys the outcome. Nobody spends what they don't have. When the model proposes a spend without saying how much, the rules spend the least that succeeds.
- **The game master decides.** Nothing is rolled or spent: whoever runs the game, or the model, judges how it goes, in the rules' own words.

### Difficulty

A way that is made against a target says how hard a check can be, as a short scale of **difficulties**, each with the number to reach. Vis Itineris has six: **Very easy** (5), **Easy** (10), **Medium** (15, the usual), **Hard** (20), **Very hard** (25) and **Nearly impossible** (30). Wherewithal's contests have four: **Slight** (1), **Even** (3, the usual), **Steep** (5) and **Towering** (7). A pool, a spend or a judgement has none: what is counted, spent or judged decides. Freeform decides nothing, so it has none.

The Lair's roll forms offer exactly this scale: when the Oracle asks you to call a roll, you pick the check and its difficulty, or **No check**. See [Rolls](./genre-lair.md#rolls).

### How outcomes read

Every set of rules names its own outcomes ("It holds, at a cost", "Critical success") and places each one on a scale every set of rules shares, from a disaster to a triumph. That is why a story told in words still reads "it works, at a cost" or "it goes badly wrong", and why a genre can tint an outcome green, amber or red whatever the rules. Rules that name no outcomes of their own read **Failure** or **Success**.

### How it was decided

When the rules decide something, they keep a short **outcome line**: what was checked, what it came to, against what, and how it came out. Under it is how the number was reached:

```
d20 11 + 3 (Strength) + 2 (Longsword) + 1 (Longsword) = 17 vs 15
```

A die reads as a sum, from left to right: the die and what it showed; each bonus, with where it came from in brackets (the stat, then each item or effect); the total; the target. Dice whose faces are shown aren't counted a second time: damage reads `1d8 (5) + 3 (Dexterity modifier) = 8`. When a die is rolled twice and one roll is kept, both rolls are shown, like `d20 (4, 13, edge) 13`.

The other ways read their own way:

- a pool: `pool 3 — 3d6 (6, 4, 5): 2 successes at 5+`;
- cards: the cards drawn, then the sum, like a die's;
- a comparison: the value, and whose it was set against (_4 against Teo's Mettle (3)_);
- a spend: what was spent (_spent 2_);
- a judgement: only the outcome's words.

This line is for you, not the model. The story never includes it, and the model is never shown it. The genre decides where it appears, usually in a log beside the messages, linked to the message it belongs to. When the same moment moved a tie the lorebook shows (a bond warming), the outcome says so under it, in amber: _Lorebook: Wren's side of the tie with Mara now reads close_ · _follows the tie_. Nothing there to keep or undo of its own: the relationship follows the side it reads.

## Wherewithal: rules without dice

Wherewithal is Serene Pub's own rules for stories where choices and the people around you matter more than luck. Nothing is rolled.

- **Three pools.** Every character has **Nerve** (spent to push through danger, fear or pain), **Favour** (to persuade, call in help or smooth a way) and **Provisions** (to have the right thing, pay a way or endure hardship), from 0 to 6, starting at 3. To carry a risk, they spend from one: nothing spent and **It falls short**; 1 and **It holds, at a cost**; 2 and **It carries**; 3 and **It carries clean**. What is spent stays spent until a boon or the story gives it back, and nobody spends what they don't have.
- **Contests.** When two people are set against each other, their **Mettle** is weighed: the best of their pools, steadied by one for each steady bond (at most two), worked out for you and shown on the sheet. Against a situation instead, mettle meets a difficulty, **Even** unless you say otherwise. Losing by three or more, **It comes apart**.
- **Bonds.** The people someone is bound to (kin, friend, rival, mentor, flame or a debt), each **Steady**, **Strained** or **Broken**. A steady bond stands with them, a strained one helps at a price, a broken one may hinder.
- **Troubles.** What weighs on someone (shaken, hurt, disgraced, worn out, hunted, heartsick), light or heavy. A heavy trouble weighs on every contest, and two or more wear a person thin.
- **Boons.** Help on hand (strong drink, a letter of introduction, travel rations, a lucky token, a safe-house key): using one restores a pool or lifts a trouble, and one carried ready steadies its holder in a contest.
- **Everything else** is judged: the model, or whoever runs the game, says how it goes, in Wherewithal's words.

Wherewithal is one of the rules the Story genre recommends, and it plays at every level of **How strict**: it decides by spending and weighing, not by chance.

## When the model asks for a change

The model can ask to change a stat or an item. Under **Rules**, every request is checked first:

- **Lowering or raising by an amount** ("health −5") is applied when it fits.
- **Setting a number outright** ("health is 14") is held for you to review. The rules work their numbers out, so they won't let the model overwrite one. The review card says why it was held. You can accept it or reject it.
- **Something that doesn't exist** (a stat the session doesn't track, an item nobody has) is refused and named. It never shows up as something you could accept.
- **Spending more than someone has** is refused.

Changes to the lorebook still follow your [lorebook writes setting](./stats-and-states.md). Under **Review changes**, they wait for you as usual.

### Replies that carry changes

In a [Story](./genre-story.md) session the reply can carry its changes itself. Turn on **Replies carry changes** in the session's settings (the session's owner; off until you do). The model then answers with its words and, beside them, what the scene changed: a value up or down, something gained or lost, or how one person now feels about another (a field on their side of a tie, such as Mara's affection for Wren; a standing worked out from it follows by itself, and so does the relationship on the lorebook). The words land as the reply; the changes go through the rules like any request above, applied straight away (the switch is the reply's own); while it is on, **Note what changed** leaves **Keep the sheets** and **Track conditions** to the reply, so nothing is counted twice. Only what the rules track can change. Anything else is refused and named, never guessed.

Some rules also have **actions** of their own: _Draw_ in the card game, _Rest_, _Buy_. They sit on the composer beside the genre's actions, and a press puts the rule through with whatever its form asks.

## Classes

What a character can be comes from the rules, never from the genre. Vis Itineris brings six classes, each with its hit die, its key abilities and skills, its starting kit and its features. [Dungeon Crawler](./genre-dungeon-crawler.md) offers them when you make your character, and the kit you start with is the class's. Rules with no classes offer none, and a character is described in words.

## Time

Some things wear off or come due as time passes: poison every hour, a curse at midnight. When a genre passes time (a rest, a journey, a scene break), the rules apply whatever falls due. Something set for a specific date needs the session to keep a story clock. Without one, the rules note "needs a clock" and skip it. They never guess.

Rules that count a turn's actions say so to the model where numbers show: _A turn holds 3 actions and a reaction._

## Making rules of your own

:::note Admins only
Rules are made and changed in **Admin › Play › Rulesets**. Everyone else meets them under **Rules**.
:::

**Admin › Play › Rulesets** lists every set of rules the pub knows: the ones that come with Serene Pub, any a plugin brings and the ones made here, with where each comes from, whether it is a draft, published or retired, and its version.

**New ruleset** makes one. You pick an owner slug once (`acme.lab`): every set of rules you make lives under it, and it never changes. Then a label, and the id made from it (`hollow-hearts` makes `acme.lab:ruleset/hollow-hearts@1`; it stays), and **What kind of game is it?**. None of the answers locks you in.

### Where to start

- **From scratch** comes first and is truly empty: no outcomes, no time, no ways to decide. A session on it reads exactly like a session with no rules. Add an attribute with a sentence and it is already a game.
- **An archetype** is a small working set to make your own. Each card says how play goes, what it is **Decided by**, and what it tracks:
  - **Romance**: affection kept on each person's side of a bond, its standing (cold, wary, warm, close) worked out from it, nerve you spend to be brave, a mood. A confession weighs how the other person feels against a line, and moves it: cooled −1, warmed +1, confessed +2. Nothing is rolled.
  - **Slice of life**: energy, money and the time of day. Routines run each morning, a late night costs tomorrow, and plans wait in a diary.
  - **Workplace**: a job, pay, reputation and focus; tasks with due dates piled in an inbox in a room; each person's footing with the places they work, kept on the grapevine. A pitch weighs your reputation against the ask, and a task left past its date comes due.
  - **Card game**: a deck the table shares, a hand each and a discard. Draw, play and score; a round ends when the hands are empty.
  - **Dice adventure**: roll a twenty-sided die, add a stat, meet a target. Health, weapons that harm on a hit, conditions that get in the way.
- **More starting points**, under a fold: **Dice pool** (as many six-sided dice as a stat says, counting fives and sixes), **a copy of rules you have** and **paste a document**.

A copy is everything in the original (its attributes, functions, entry types, zone types, outcomes and library) to change as you like. Serene Pub's and a plugin's rules stay as written; a copy is how you change them.

### The seven sections

The page has a rail of seven sections, each with how many it holds (or _defaults_, where Serene Pub's still stand), then a **Document**, and a note saying whether the rules are playable yet. One section shows at a time. Each is a few sentences you can read aloud. Beside it, on a wide screen, is **What the model will read**: one text, with **How strict** and how much of the prompt it costs. On **Functions**, the catalogue takes its place.

1. **Attributes.** What characters, the world and places carry: Affection, Nerve, Money. Each has a name and **a sentence the model reads about it** (this is the floor of every ruleset: nothing is added without one). Pick its kind (a number, a pool that is spent and refilled, a tally that only counts, a label of words, a list, or **free text**: a few sentences of each holder's own, such as a vow or a backstory, which the model reads as a sentence of its own), its bounds, who carries it, who sees it (just the holder, the game master, or everyone) and who may change it (the rules, the game master, the holder, or anyone). **Tags** are words functions look for (relationship, condition, resource): a function bound by tag picks up every attribute that carries it. In a session, a holder can switch an attribute off for themselves (the game master can for anyone; see [Who carries what](./stats-and-states.md#who-carries-what)); tick **Required** where every holder must carry it.
2. **Functions.** How things work, said as sentences with pickers inside them: _When someone confesses, weigh their Affection against the line._ A function is a small piece of core (or of a plugin, or of your own rules) that you reference by name. You tie it to your attributes, entry types and zone types (where it reads a number, an entry type's number field too: **Rungs** over _Affection on a bond_, its words kept in _Standing_; **An outcome moves a number** moves the side a confession was aimed at), set its options and use **Try this function** before you rely on it. Each picker offers only what its part can take: a sum takes a number, a pool or a tally, so a free-text attribute such as Mood is not offered there, and the picker says what it left out and why. **Try this function** puts a way to decide or a check through the rules for the first of the party, and you see how it came out. The **catalogue** drawer lists the functions that come with Serene Pub, those packages bring, and those in your other rulesets. Using one **references** it and pins its version; **Change how it works** forks it into your ruleset and keeps where it came from. Functions only ever work out what should change, and return it; the pipeline saves it, under the session's review setting.
3. **Entry types.** The kinds of thing people hold, suffer or share: Bonds, Keepsakes, Cards. Each is a lorebook entry type with a sentence for the model, who holds it and who sees it. Instances are entries; what someone holds is a copy of the entry, so the original in the lorebook never changes. Its **Tags** are words functions look for (relationship, condition, class): a function bound by tag picks up every type that carries it. **Lives in** says which zone type holds it; one that no zone type holds lives with what someone carries. A new one takes its id from its name as you type, as a new ruleset does.

   A kind that is **between two people** (a bond, a rivalry) says what **its other end may be**: a person, a place, or any entry. Its **sides** follow from that: a person to a person has two, and each person holds their own side, with their own numbers (Romance keeps affection there); anything else has one side, held by the world, so the rules need a zone type the world owns that holds it (Workplace's **Grapevine** holds each person's **Footing** with a place). Without one the rules say so, and how to add it. A function adding a side to someone's ties gives the other person theirs too, whether or not they are in the scene. **On the lorebook graph** says which of its fields the relationship shows: the relationship's type from one words field (_standing_: _warm_), its name from another. The held side owns the truth and the lorebook keeps the words: drawing a relationship between two people makes their sides, a function that adds a side makes the relationship, and taking the relationship off the lorebook lets its sides go (never the other way round). For a kind people hold, **Copied onto its own entry** names the fields its entry in the lorebook follows. **Shared with the model** says, field by field, whether the model is told its words (on unless you untick them) and its number (off unless you tick it). When the session may not write the lorebook (it reads someone else's, or yours on Review changes or Off), what the rules feed onto it is kept in the session's own notes instead and read there: a relationship's words, a held thing's field, a cast member's state. The lorebook itself stays as it was.
4. **Zone types.** Where entries sit: a hand, a deck, an inbox, a pocket. Each says whom it belongs to (each character, the world, a place), which entry types it holds, how many at most, whether its order matters, and who sees what is in it. Moving an entry between zones is what reveals it: a card leaves your hand and lands on the table. Only your own zone types are listed, with those the functions you use bring under **From the catalogue**. Every session also has what someone carries, which is where an entry type no zone type holds lives; it isn't a zone type of yours and isn't listed.
5. **Outcomes and time.** The outcomes in the author's own words (_cooled_, _awkward_, _warmed_, _confessed_), each placed on the shared scale from a disaster to a triumph so a story told in words still reads true. Time is optional: the unit the story's clock keeps, turns, and rests.
6. **The library.** Ready-made rows for each entry type, with where they come from and their licence.
7. **Options.** The ways a table may play it: settings with who may change them, presets that set several at once, and conversions from other rules.

Every change waits for **Save**, and a draft always saves. What it still lacks is said on the row it's about after a Save, or at once when you remove something (a row you've only just added says nothing until you type in it), and the rail's note turns into **N problems before publish**. A publish waits until they're fixed. Leaving with unsaved changes (another section, Back, Escape, closing Admin) asks first: **Save**, **Discard** or **Stay**.

Removing something takes it out everywhere it was named. Remove an entry type and the zone types that held it stop holding it (one left holding nothing says **Holds nothing yet**); if it has library rows, you're asked whether to remove them too. A function tied to it, or to one of its fields, loses that tie, and its row says what to pick instead. Removing an attribute or a zone type does the same for the functions and zone limits that named it. Remove a function and the options that named it (a check's way, the check an outcome moves on) are emptied, their rows saying so; if it was the first way to decide, the one a moment uses when it names none, the next way takes over and the list says which (or that none is left, so the table judges in words); a saved test that used it keeps its party and loses what happened.

The **Document** holds the whole draft as JSON for what no step covers, or for pasting a ruleset someone shared.

### Playtest a scene

A small party (one to four, with attributes and held entries), the situation in a sentence, and what happens: a function, a change to an attribute, an entry gained or lost, or nothing. Then **Run the scene**, **Ask a model** to narrate it, or **Run it N times** (up to 200) to see how often each outcome comes up. **Save as a test** keeps the scene with the draft; **Load** brings it back. **How it was decided** shows what was weighed, and the changes are only shown: a playtest saves nothing but the tests you keep. In play, a function only works out what should change, and anything it sets off happens after the turn.

### The handbook

**Handbook** is a page players read, built from your own sentences: how to play, what people carry, how things are decided, the things people keep, how outcomes read and time. Add pages of your own beside it (**Add a page**) or edit a built page, which then becomes yours. **Open as players see it** shows the result. Genres have a handbook too.

### Publishing

**Retire** takes rules out of **Rules**: the sessions and lorebooks that play them keep playing them, and nobody new can pick them. Retired rules read as they are until you **Unretire** them. **Delete** removes rules made here for good, and only when nothing plays them; rules that a session or lorebook plays can be retired instead. The attributes they made stay, as attributes of their own.

Rules Serene Pub or a plugin ships stay as written. **Copy…** on their page starts a copy you can change. To write rules in code, see the SDK guide [Write your own rules](./sdk/guides/rulesets.md).
