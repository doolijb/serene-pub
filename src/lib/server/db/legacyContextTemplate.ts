/**
 * The context template 0.5 shipped, frozen.
 *
 * In its own module, free of any database import, for the same reason
 * `contextTemplateDefaults.ts` is: `defaults.ts` opens a connection at import,
 * so anything that only wants this string used to have to read the file off
 * disk and parse the literal out of it (`contextTemplateWrappers.test.ts` still
 * documents that trick). A parity fixture importing it for the constant alone
 * pulled the whole seeder in, and once the legacy prompt builder was deleted
 * from the module graph that became a genuine initialisation cycle —
 * `defaults.ts` importing `db`, `db/index.ts` calling `sync()` back into it
 * before its body had finished.
 *
 * This is **archived data**, not a live template: `context_configs` is frozen at
 * 0.5 and nothing in 0.6 renders from it. What 0.6 renders is
 * `SHIPPED_CONTEXT_TEMPLATE`.
 */
/**
 * The context template every install starts with.
 *
 * Extracted from the seed array below so it can be *referenced*. A template that
 * exists only as a string literal inside an array cannot be tested against — and
 * the parity corpus was comparing prompts rendered by a template written for the
 * corpus, which missed a whole class of difference: this one renders the
 * post-history reminder *inside* the message loop, and a flat template cannot
 * express a position at all.
 *
 * The seed below uses this constant, so the two cannot drift.
 */
export const DEFAULT_CONTEXT_TEMPLATE = `{{#systemBlock}}
{{#if currentDate}}
The current date in the story is {{{currentDate}}}.
{{/if}}

{{#if instructions}}
Instructions:
"""
{{{instructions}}}
"""
{{/if}}

{{#if characters}}
Assistant Characters (AI-controlled):
\`\`\`json
{{{characters}}}
\`\`\`
{{/if}}

{{#if personas}}
User Characters (player-controlled):
\`\`\`json
{{{personas}}}
\`\`\`
{{/if}}

{{#if scenario}}
Scenario:
"""
{{{scenario}}}
"""
{{/if}}

{{#if worldLore}}
World lore: 
\`\`\`json
{{{worldLore}}}
\`\`\`
{{/if}}

{{#if history}}
Story history:
\`\`\`json
{{{history}}}
\`\`\`
{{/if}}

{{#if speakerRelationships}}
Your relationships:
\`\`\`json
{{{speakerRelationships}}}
\`\`\`
{{/if}}

{{/systemBlock}}

{{#each sessionMessages as |sessionMessage msgIndex|}}
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
