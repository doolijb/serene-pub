/**
 * Graph-build system prompts, in one place.
 *
 * Deliberately a standalone module with NO imports. Two very different callers
 * need these strings:
 *
 *   - graphBuilder.ts, at build time, as the fallback when no graphBuildConfigs
 *     row resolves;
 *   - db/defaults.ts, at boot, to seed and re-sync the immutable "Default Graph
 *     Build" config row.
 *
 * defaults.ts runs on the boot path, so it must not pull in graphBuilder's
 * adapter/LLM machinery just to read a string — hence the separate file rather
 * than exporting from graphBuilder. Keeping one definition is what stops the
 * seeded default and the code fallback drifting apart, which is exactly what
 * had happened before: the seeded row held a one-line stub bearing no
 * resemblance to the prompt actually being sent.
 */

/**
 * Perspective extraction — the prompt that produces relationships.
 *
 * Rewritten after a measured 79% loss rate (6 kept, 22 discarded) against a
 * roleplay-finetuned local model. The dominant failure was not parsing: 45% of
 * responses came back as narrative prose, one in first person ("I leaned
 * against the edge of a sterile metal table…"). Asked to be "an expert
 * cataloger mapping `Amara Lin`'s perspective", the model became Amara Lin.
 *
 * Six changes, each aimed at one observed cause. Cheap to undo, but each has a
 * failure behind it:
 *
 *  1. The output contract is the FIRST thing, not the last — it previously
 *     arrived ~115 lines in, after nineteen type examples.
 *  2. The character's name never appears in the model's identity sentence. It
 *     is a FIELD the model reads (`subject.name`), never a role it assumes.
 *     This is the single biggest anti-roleplay lever.
 *  3. An explicit "you are not any of the characters" negation.
 *  4. `from` is requested, and pinned. It was dropped for a while — asking for
 *     it had produced symmetric `person_1`/`person_2` pairs and reversed
 *     labels, and the parser did not need it since the source comes from the
 *     caller. But dropping it only made a reversal INVISIBLE rather than rare:
 *     with no source to check, an entry describing the other character's
 *     stance was recorded as the subject's, and `wrongSource` sat at zero
 *     because nothing was measurable, not because nothing was wrong.
 *
 *     It is now pinned at the decoder instead — buildPerspectiveSchema
 *     constrains `from` to the subject's literal name, so a reversed pair is
 *     unemittable on any provider that honours the schema, and is discarded
 *     rather than swapped where it is not. Asking for it in the prompt is what
 *     makes the constraint legible to a model reading only the prompt.
 *  5. The prompt ENDS on a populated example. It used to end on
 *     `{"relationships": []}`, the most recency-weighted position available,
 *     and empty results were correspondingly common.
 *  6. ~40 lines instead of ~115.
 *
 * This prompt is now the SECOND line of defence, not the only one. Graph calls
 * set `adapter.responseFormat = "json"` and hand the perspective call a
 * per-subject `responseSchema`, and each adapter translates both into its
 * provider's own constraint (a GBNF grammar for KoboldCPP and llama.cpp,
 * `format` for Ollama, `response_format` for OpenAI-compatible). An earlier
 * version of this comment claimed constrained decoding was unavailable in this
 * app — it was merely unwired.
 *
 * The prompt and the schema are two halves of one contract: keep the field list
 * below in step with buildPerspectiveSchema, or a model reading only the prompt
 * will be asked for a shape the decoder then refuses.
 *
 * Later addition, and deliberately not counted among the six above because it
 * fixes no measured defect: the `visibility` line carries a tiebreak. The three
 * values were defined but no rule said which to pick when the text settles
 * nothing, and `public` is the cheapest of them to justify — `secret` demands
 * that the subject told no one, `acknowledged` demands that both parties know,
 * while "widely known" can be asserted about almost anything. A run was read as
 * skewing public on that reasoning, but checking the labels found roughly half
 * public with most of those defensible (a station-wide threat, a command
 * relationship). So this closes a gap in the definitions rather than correcting
 * an observed bias — if a future run does show one, this line is the lever.
 *
 * Two things that follow, and that must survive future edits:
 *
 *  - **Do not reintroduce a "think step by step first" instruction.** Under a
 *    JSON-object grammar a reasoning model cannot emit a `<think>` preamble;
 *    the grammar forbids the first token of it. Suppressing that is intended
 *    for extraction, but a prompt asking for it would fight the decoder and
 *    produce nothing.
 *  - **The word "JSON" must appear in this prompt.** Several
 *    OpenAI-compatible backends reject `response_format: json_object` unless
 *    the prompt mentions it. The first line satisfies that; keep it that way.
 */
export const DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT = `Output one JSON object and nothing else. No prose, no narration, no markdown fences.

{"relationships":[{"from":"…","to":"…","type":"…","reason":"…","description":"…","status":"…","visibility":"…"}]}

Return {"relationships": []} if nothing qualifies.

# Task
You are a data extractor. You are NOT any of the characters and must never write in their
voice, in first person, or as a scene. Read \`scene.summary\` and list the relational
dynamics that the subject — the character named in \`subject.name\` — holds toward other
characters, which this scene establishes or changes.

# Fields
- \`from\` — the subject's name, copied exactly from \`subject.name\`. Always this one character, on every entry.
- \`to\` — the other character's name, copied exactly as it appears in \`otherCharacters\`. Never the subject.
- \`type\` — a short noun phrase: ally, rival, mentor, family, romantic, grudge, fear, debt, ward, contract, or a more precise one of your own.
- \`reason\` — the specific action, line, or narrated thought in the summary that proves it. If you cannot point to one, omit the entry.
- \`description\` — one sentence, third person, describing the subject's stance toward that character.
- \`status\` — active | resolved | broken | evolved
- \`visibility\` — secret (the subject has told no one) | acknowledged (both characters know) | public (widely known).
  Decide from the text, not from what seems likely: a private thought, feeling or recollection is \`secret\`; a dynamic
  that arose from a direct interaction between the two is \`acknowledged\`; \`public\` requires the summary to show that
  others already know. If the summary settles none of these, use \`secret\` for an internal state and \`acknowledged\`
  otherwise — do not reach for \`public\`.

# Include an entry when the summary shows
- a direct interaction that establishes or changes a dynamic
- a thought, recollection, or feeling the subject has about someone
- a change to a dynamic already listed in that character's \`existingRelationships\`

# Do not include
- two characters merely sharing a scene with no interaction between them
- anything you inferred rather than read
- a dynamic already in \`existingRelationships\` that this scene did not change
- the subject's relationship with themselves

One entry per distinct dynamic: a pair can hold several at once, each with its own entry.

# Example
{"relationships":[{"from":"Mira","to":"Caen","type":"grudge","reason":"Caen publicly denied any involvement with Mira at the council table.","description":"Mira will not forgive being humiliated in front of the people whose trust she needs most.","status":"active","visibility":"secret"}]}`

/**
 * Second attempt after a response containing no JSON.
 *
 * Stripped of every trace of character framing — no subject, no roles, no type
 * examples, nothing resembling a scene brief. The first prompt already failed to
 * hold the model on task; repeating a softer version of it is not a retry, it is
 * the same request again.
 */
export const GRAPH_PERSPECTIVE_RETRY_SYSTEM_PROMPT = `Return one JSON object. Nothing else — no prose, no narration, no explanation, no markdown fences.

{"relationships":[{"from":"<the subject's name>","to":"<other character's name>","type":"<short noun phrase>","reason":"<what in the text proves it>","description":"<one sentence, third person>","status":"active","visibility":"acknowledged"}]}

If the text supports no entries, return exactly: {"relationships": []}`

/**
 * Pre-filter — screens a summary for characters worth tracking.
 *
 * Same anti-roleplay shape as the perspective prompt: contract first, explicit
 * "not a character" negation, no name in the identity sentence.
 */
export const DEFAULT_GRAPH_PRE_FILTER_SYSTEM_PROMPT = `Output one JSON object and nothing else. No prose, no narration, no markdown fences.

{"keep":["<name>"],"drop":["<name>"]}

# Task
You are a data extractor. You are NOT any of the characters. Given a scene summary and a
list of names found in it, decide which name recurring characters worth tracking in a
narrative graph, and which are incidental.

Keep a name when the summary shows it acting, speaking, deciding, or being reacted to.
Drop a name that is scenery: a place, a vessel, an organisation, an object, a crowd, or a
person mentioned only in passing with no bearing on anyone's relationships.

When uncertain, keep — a spurious character can be merged later, a dropped one is lost.`

/**
 * Node resolution — same entity, or a new one?
 *
 * Errs toward "new": a wrongly-merged pair silently fuses two identities and is
 * hard to notice, whereas a duplicate is visible in the review list and can be
 * merged in one action.
 */
export const DEFAULT_GRAPH_NODE_RESOLUTION_SYSTEM_PROMPT = `Output one JSON object and nothing else. No prose, no narration, no markdown fences.

{"match": "<existing name>"}  or  {"match": null}

# Task
You are a data extractor. You are NOT any of the characters. Decide whether the incoming
name refers to someone already in the known list, or to a new character.

Treat as the same person: a nickname, a surname alone, a title plus surname, an obvious
misspelling, or a name that differs only in honorific ("Commander Thorne" and "Maren
Thorne").

Treat as different people: two characters who merely share one name element, unless the
context makes the identity explicit.

Return {"match": null} unless you are confident. A duplicate can be merged afterwards; a
wrong merge silently destroys a character's identity.`

/**
 * Node description — the two-sentence introduction written for a newly
 * discovered character.
 *
 * PROSE, not JSON, and the only graph call that is. Constraining it to a JSON
 * object made the model wrap its answer to satisfy the decoder and the wrapper
 * was persisted verbatim as the node summary — see the responseFormat note in
 * graphBuilder.runLLM.
 */
export const DEFAULT_GRAPH_NODE_DESCRIPTION_SYSTEM_PROMPT = `You write brief character introductions from roleplay excerpts. Given a character name and messages from the scene where they first appear, write exactly two sentences in present tense describing who this character is — their role, nature, or defining traits — based only on what the provided text shows. No invention, no embellishment.`

/**
 * State detection — did any present character reach a new lifecycle state?
 *
 * Biased hard toward omission: "a missed change can be caught later; a wrong
 * change corrupts the record."
 */
export const DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT = `You detect when characters reach a new lifecycle state during a story scene.

The four states and when to apply them:

ACTIVE — the character is alive and present in the ongoing story. Only output this if their current state is deceased, missing, or departed and the scene shows them returning or being confirmed alive.

DECEASED — the character died during this scene. Apply when the scene directly depicts or confirms their death:
  • Killed in combat or by another character's action
  • Died from wounds, poison, illness, or other explicitly shown causes
  • Executed, sacrificed, or destroyed
  • Death confirmed by witnesses in the scene
  Do NOT apply for: deaths mentioned in passing that happened before this scene (those would already be reflected in their current state), near-death experiences that end in survival, or ambiguous fates.

MISSING — the character's whereabouts became unknown during this scene. Apply when:
  • They disappeared without explanation
  • They were kidnapped, taken, or seized and their fate is unclear
  • They vanished and no one in the scene can account for them
  Do NOT apply if their death is clearly confirmed, or if they voluntarily left.

DEPARTED — the character voluntarily left the story during this scene. Apply when:
  • They chose to leave the group or location, implying permanence
  • They were exiled or banished (even involuntarily — the key is they are now gone)
  • They retired, withdrew, or set off on a separate path apart from the main narrative
  Do NOT apply for temporary absences where the character is expected to return.

Rules:
- Only output an entry when the state change is clear and definitive — not implied, not ambiguous.
- Only flag a change if the new state differs from the character's current state listed in the prompt.
- When in doubt, omit. A missed change can be caught later; a wrong change corrupts the record.
- Output ONLY a raw JSON object. No prose, no markdown fences.`
