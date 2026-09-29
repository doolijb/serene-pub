/**
 * The Liquid halves of the parity corpus: hand ports of templates core ships.
 *
 * ⚠ **Fixtures, not seeds.** Nothing here reaches the database — the shipped
 * rows stay Handlebars, and the ruling that added Liquid left the column
 * default alone. These exist so `liquidParity.test.ts` can assert that a
 * template ported between core's two engines produces the same bytes, and so
 * `templateValidation.test.ts` can check the port against the same contract the
 * original is checked against.
 *
 * A separate module rather than exports off the test file: importing a
 * `.test.ts` for its constants re-registers every suite in it inside the
 * importer, which is a duplicate run reported as extra passing tests.
 */

/**
 * `SHIPPED_CONTEXT_TEMPLATE`, in Liquid.
 *
 * Three mechanical rules produce this from the Handlebars original, and they
 * are the whole of the "syntax delta" table in `docs/context-templates.md`:
 *
 * 1. A block tag standing alone on its line becomes `{%- tag -%}`. Handlebars
 *    silently removes such a line; Liquid needs to be told, and `greedy: false`
 *    makes the trim line-bounded so it removes exactly that much.
 * 2. `{{#each xs as |x i|}}` becomes `{% for x in xs %}` plus an `assign` of
 *    `forloop.index0`, because the inner injections loop shadows `forloop`.
 * 3. `{{#with ../postHistory}}` has no Liquid equivalent and does not need one:
 *    the fields are read through their full path instead.
 *
 * `{% assistantBlock id: … %}` is the one place a name appears that Handlebars
 * did not need: `{{#assistantBlock}}` reads the message off the block's
 * implicit `this`, and Liquid has no implicit `this`. It is load-bearing — the
 * seed line's `id === -2` is what omits the closing delimiter.
 */
export const SHIPPED_CONTEXT_TEMPLATE_LIQUID = `{%- systemBlock -%}
{%- if currentDate -%}
{{ currentDate }}
{%- endif -%}

{%- if instructions -%}
{{ instructions }}
{%- endif -%}

{%- if characters -%}
{{ characters }}
{%- endif -%}

{%- if personas -%}
{{ personas }}
{%- endif -%}

{%- if scenario -%}
{{ scenario }}
{%- endif -%}

{%- if worldLore -%}
{{ worldLore }}
{%- endif -%}

{%- if history -%}
{{ history }}
{%- endif -%}

{%- if relationshipsPerspectives -%}
{{ relationshipsPerspectives }}
{%- endif -%}
{%- if relationshipsKnown -%}
{{ relationshipsKnown }}
{%- endif -%}

{%- endsystemBlock -%}

{%- for sessionMessage in sessionMessages -%}
{%- assign msgIndex = forloop.index0 -%}
{%- for injection in injectionsByIndex[msgIndex] -%}
{%- if injection.role == "assistant" -%}
{%- assistantBlock -%}
{{ injection.content }}
{%- endassistantBlock -%}
{%- elsif injection.role == "user" -%}
{%- userBlock -%}
{{ injection.content }}
{%- enduserBlock -%}
{%- else -%}
{%- systemBlock -%}
{{ injection.content }}
{%- endsystemBlock -%}
{%- endif -%}
{%- endfor -%}
{%- if msgIndex == postHistory.targetIndex and postHistory.hasContent -%}
{%- systemBlock -%}
{%- if postHistory.instructions -%}
Response reminder:
\`\`\`text
{{ postHistory.instructions }}
\`\`\`
{%- endif -%}
{%- if postHistory.charInstructions -%}
Character reminder:
\`\`\`text
{{ postHistory.charInstructions }}
\`\`\`
{%- endif -%}
{%- if postHistory.exampleDialogue -%}
Example dialogue:
\`\`\`text
{{ postHistory.exampleDialogue }}
\`\`\`
{%- endif -%}
{%- endsystemBlock -%}
{%- endif -%}
{%- if sessionMessage.role == "assistant" -%}
{%- assistantBlock id: sessionMessage.id -%}
{{ sessionMessage.name }}: {{ sessionMessage.message }}
{%- endassistantBlock -%}
{%- endif -%}
{%- if sessionMessage.role == "user" -%}
{%- userBlock -%}
{{ sessionMessage.name }}: {{ sessionMessage.message }}
{%- enduserBlock -%}
{%- endif -%}
{%- endfor -%}`

/** The frozen 0.5 template (`context_configs`' seed), in Liquid. */
export const LEGACY_CONTEXT_TEMPLATE_LIQUID = `{%- systemBlock -%}
{%- if currentDate -%}
The current date in the story is {{ currentDate }}.
{%- endif -%}

{%- if instructions -%}
Instructions:
"""
{{ instructions }}
"""
{%- endif -%}

{%- if characters -%}
Assistant Characters (AI-controlled):
\`\`\`json
{{ characters }}
\`\`\`
{%- endif -%}

{%- if personas -%}
User Characters (player-controlled):
\`\`\`json
{{ personas }}
\`\`\`
{%- endif -%}

{%- if scenario -%}
Scenario:
"""
{{ scenario }}
"""
{%- endif -%}

{%- if worldLore -%}
World lore: 
\`\`\`json
{{ worldLore }}
\`\`\`
{%- endif -%}

{%- if history -%}
Story history:
\`\`\`json
{{ history }}
\`\`\`
{%- endif -%}

{%- if speakerRelationships -%}
Your relationships:
\`\`\`json
{{ speakerRelationships }}
\`\`\`
{%- endif -%}

{%- endsystemBlock -%}

{%- for sessionMessage in sessionMessages -%}
{%- assign msgIndex = forloop.index0 -%}
{%- if msgIndex == postHistory.targetIndex and postHistory.hasContent -%}
{%- systemBlock -%}
{%- if postHistory.instructions -%}
Response reminder:
\`\`\`text
{{ postHistory.instructions }}
\`\`\`
{%- endif -%}
{%- if postHistory.charInstructions -%}
Character reminder:
\`\`\`text
{{ postHistory.charInstructions }}
\`\`\`
{%- endif -%}
{%- if postHistory.exampleDialogue -%}
Example dialogue:
\`\`\`text
{{ postHistory.exampleDialogue }}
\`\`\`
{%- endif -%}
{%- endsystemBlock -%}
{%- endif -%}
{%- if sessionMessage.role == "assistant" -%}
{%- assistantBlock id: sessionMessage.id -%}
{{ sessionMessage.name }}: {{ sessionMessage.message }}
{%- endassistantBlock -%}
{%- endif -%}
{%- if sessionMessage.role == "user" -%}
{%- userBlock -%}
{{ sessionMessage.name }}: {{ sessionMessage.message }}
{%- enduserBlock -%}
{%- endif -%}
{%- endfor -%}`

/**
 * The shipped variable layouts, in Liquid — keyed `<variable>/<variant>`.
 *
 * These are where the helper set is actually exercised: `json`, `jsonValue` and
 * `pad` all live here rather than in the context template. Five generator
 * shapes produce all fourteen shipped rows (`variableLayouts.ts`), and every
 * one of them is represented below.
 */
export const LIQUID_LAYOUTS: Record<string, string> = {
	"instructions/content": "{{ instructions }}",
	"instructions/wrapped": 'Instructions:\n"""\n{{ instructions }}\n"""',

	// `objectList`: a fixed field list, first key always present, the rest
	// guarded. `!= nil` is Liquid's `(ne x undefined)` — see the delta note in
	// the docs: it also catches an explicit null, which Handlebars does not.
	"characters/content":
		'{% if characters.size %}[\n{% for character in characters %}  {\n    "name": {{ character.name | jsonValue }}' +
		'{% if character.nickname != nil %},\n    "nickname": {{ character.nickname | jsonValue }}{% endif %}' +
		'{% if character.description != nil %},\n    "description": {{ character.description | jsonValue }}{% endif %}' +
		'{% if character.personality != nil %},\n    "personality": {{ character.personality | jsonValue }}{% endif %}' +
		'{% if character["extra lore"] != nil %},\n    "extra lore": {{ character["extra lore"] | jsonValue: 4 }}{% endif %}' +
		"\n  }{% unless forloop.last %},{% endunless %}\n{% endfor %}]{% else %}[]{% endif %}",

	"personas/content":
		'{% if personas.size %}[\n{% for persona in personas %}  {\n    "name": {{ persona.name | jsonValue }}' +
		'{% if persona.description != nil %},\n    "description": {{ persona.description | jsonValue }}{% endif %}' +
		"\n  }{% unless forloop.last %},{% endunless %}\n{% endfor %}]{% else %}[]{% endif %}",

	// `recordEntries`: keys come from the data. `{%- for` eats the space that
	// separates the literal brace from the tag, and `endfor -%}` eats the one
	// before the closing brace — the same job `{{~#each` and `{{/each~}}` do.
	"worldLore/content":
		"{% if worldLore %}{ {%- for pair in worldLore %}{{ pair[0] | jsonValue: indent: 0 }}:" +
		"{{ pair[1] | jsonValue: indent: 0 }}{% unless forloop.last %},{% endunless %}" +
		"{% endfor -%} }{% else %}{}{% endif %}",

	"worldLore/wrapped":
		"World lore: \n```json\n" +
		"{% if worldLore %}{ {%- for pair in worldLore %}{{ pair[0] | jsonValue: indent: 0 }}:" +
		"{{ pair[1] | jsonValue: indent: 0 }}{% unless forloop.last %},{% endunless %}" +
		"{% endfor -%} }{% else %}{}{% endif %}" +
		"\n```",

	"relationshipsPerspectives/content":
		"{{ relationshipsPerspectives | json: 1 }}",

	// `optionalSections`: every section optional, each emitting a trailing
	// comma when something after it is present.
	"relationshipsKnown/content":
		"{% if relationshipsKnown %}" +
		"{% if relationshipsKnown.howOthersRegardYou or relationshipsKnown.legendaryFigures %}" +
		"{ {%- if relationshipsKnown.howOthersRegardYou %}\n " +
		'"howOthersRegardYou": {{ relationshipsKnown.howOthersRegardYou | jsonValue: indent: 1, offset: 1 }}' +
		"{% if relationshipsKnown.legendaryFigures %},{% endif %}{% endif %}" +
		"{% if relationshipsKnown.legendaryFigures %}\n " +
		'"legendaryFigures": {{ relationshipsKnown.legendaryFigures | jsonValue: indent: 1, offset: 1 }}{% endif %}' +
		"\n}{% else %}{}{% endif %}{% endif %}",

	// `pad` and presence-not-truthiness: a story with a zeroth month is a thing
	// somebody will build, so `!= nil` rather than a truth test.
	"currentDate/content":
		"{% if currentDate.label %}{{ currentDate.label }}{% else %}" +
		"{{ currentDate.year }}" +
		"{% if currentDate.month != nil %}-{{ currentDate.month | pad: 2 }}{% endif %}" +
		"{% if currentDate.day != nil %}-{{ currentDate.day | pad: 2 }}{% endif %}" +
		"{% if currentDate.hour != nil %} {{ currentDate.hour | pad: 2 }}:{{ currentDate.minute | pad: 2 }}{% endif %}" +
		"{% endif %}",

	"currentDate/wrapped":
		"The current date in the story is " +
		"{% if currentDate.label %}{{ currentDate.label }}{% else %}" +
		"{{ currentDate.year }}" +
		"{% if currentDate.month != nil %}-{{ currentDate.month | pad: 2 }}{% endif %}" +
		"{% if currentDate.day != nil %}-{{ currentDate.day | pad: 2 }}{% endif %}" +
		"{% if currentDate.hour != nil %} {{ currentDate.hour | pad: 2 }}:{{ currentDate.minute | pad: 2 }}{% endif %}" +
		"{% endif %}."
}
