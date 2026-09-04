/**
 * The context template Serene Pub ships, and the identity of its row.
 *
 * Deliberately free of any database import — the parity harness and the docs
 * guard both read this, and `defaults.ts` opens a connection at import. The
 * seeding half lives in `seedContextTemplates.ts`.
 *
 * ## Not the same string `context_configs` holds
 *
 * That table still carries the 0.5 template, headings and fences included, and
 * is frozen: it is data now, kept so a template somebody wrote survives the
 * upgrade, and nothing in 0.6 renders from it. This is the 0.6 one, and the
 * difference between them is exactly the wrappers — they moved into the
 * variable layouts (`variableLayouts.ts`), one row per variable, so a template
 * is structure and a layout is presentation.
 *
 * The prompt is unchanged. `contextTemplateWrappers.test.ts` rebuilds the 0.5
 * string from this one plus the layouts' wrappers and asserts they match
 * character for character, so "the headings moved" cannot quietly become "the
 * headings changed".
 *
 * `speakerRelationships` carried its wrapper here for one release, because
 * nothing supplied the variable on the pipeline path and it had no layout to
 * move the heading into. Spec 1.4.0 wired the graph query in, so the heading
 * moved with the rest and this template is structure throughout.
 *
 * ⚠ Spec 1.9.0 then split that block in two — `relationshipsPerspectives` and
 * `relationshipsKnown`, one heading each. That is a real change to the prompt
 * and the only one in the release: `contextTemplateWrappers.test.ts` can no
 * longer reconstruct 0.5's template from this one for that block, and records
 * the exception rather than being weakened to accept anything.
 *
 * The two sit with **no blank line between them**, unlike every other pair of
 * blocks here, and that is deliberate. Handlebars emits the newline after a
 * `{{/if}}` whether or not the block rendered, so a blank separator would put
 * one extra empty line into every prompt on every install that has never
 * opened the narrative graph — which is most of them. The parity corpus caught
 * exactly that. Both blocks carry their own heading and fence, so nothing is
 * lost visually when they do both render.
 */

/**
 * A node type id with its version stripped.
 *
 * `core:task/assemble@2` and `core:task/assemble@3` are the same pool. Which
 * variables a version supplies is the lint's business; fragmenting the pool on
 * a version bump would strand every template a user wrote against the old one,
 * with no way to move it across.
 *
 * Lives here rather than beside the rest of the entity because `config.ts`
 * needs it and `contextTemplates.ts` imports `config.ts` — a cycle this module,
 * which imports nothing, cannot be part of.
 */
export { poolKeyFor, contextPoolKeyFor } from "$lib/shared/pipelines/poolKey"

// `contextPoolKeyFor` is re-exported above — it lives in $lib/shared/pipelines/
// poolKey.ts beside its INVERSE, which the client needs and cannot import from
// $lib/server. One home for the pair.


/** The node type whose context this renders. Unversioned — see the schema. */
export const CONTEXT_TEMPLATE_NODE_TYPE = "core:task/assemble"

/** Stable identity for core's row, so seeding stays insert-only. */
export const CONTEXT_TEMPLATE_SEED_KEY =
	"pipeline-context-template:core:default"

export const SHIPPED_CONTEXT_TEMPLATE_NAME = "Default"

export const SHIPPED_CONTEXT_TEMPLATE = `{{#systemBlock}}
{{#if currentDate}}
{{{currentDate}}}
{{/if}}

{{#if instructions}}
{{{instructions}}}
{{/if}}

{{#if characters}}
{{{characters}}}
{{/if}}

{{#if personas}}
{{{personas}}}
{{/if}}

{{#if scenario}}
{{{scenario}}}
{{/if}}

{{#if worldLore}}
{{{worldLore}}}
{{/if}}

{{#if history}}
{{{history}}}
{{/if}}

{{#if relationshipsPerspectives}}
{{{relationshipsPerspectives}}}
{{/if}}
{{#if relationshipsKnown}}
{{{relationshipsKnown}}}
{{/if}}

{{/systemBlock}}

{{#each sessionMessages as |sessionMessage msgIndex|}}
{{#each (lookup ../injectionsByIndex msgIndex)}}
{{#if (eq this.role "assistant")}}
{{#assistantBlock}}
{{{this.content}}}
{{/assistantBlock}}
{{else if (eq this.role "user")}}
{{#userBlock}}
{{{this.content}}}
{{/userBlock}}
{{else}}
{{#systemBlock}}
{{{this.content}}}
{{/systemBlock}}
{{/if}}
{{/each}}
{{#with ../postHistory}}
{{#if (and (eq msgIndex targetIndex) hasContent)}}
{{#systemBlock}}
{{#if instructions}}
Response reminder:
\`\`\`text
{{{instructions}}}
\`\`\`
{{/if}}
{{#if charInstructions}}
Character reminder:
\`\`\`text
{{{charInstructions}}}
\`\`\`
{{/if}}
{{#if exampleDialogue}}
Example dialogue:
\`\`\`text
{{{exampleDialogue}}}
\`\`\`
{{/if}}
{{/systemBlock}}
{{/if}}
{{/with}}
{{#if (eq role "assistant")}}
{{#assistantBlock}}
{{{name}}}: {{{message}}}
{{/assistantBlock}}
{{/if}}
{{#if (eq role "user")}}
{{#userBlock}}
{{{name}}}: {{{message}}}
{{/userBlock}}
{{/if}}
{{/each}}`
