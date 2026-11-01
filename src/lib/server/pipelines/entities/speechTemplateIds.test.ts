import { describe, expect, it } from "vitest"
import {
	SHIPPED_SPEECH_VARIABLE_LAYOUTS,
	SHIPPED_SPOKEN_LINE_TEMPLATES,
	SPOKEN_LINE_TEMPLATE_IDS
} from "@serene-pub/core-catalog"
import { coreTemplateIdFor } from "./templateIds"

describe("coreTemplateIdFor — the five shipped speech rows", () => {
	const rows = [
		...SHIPPED_SPOKEN_LINE_TEMPLATES.map((t) => ({ name: t.name, seedKey: t.seedKey, templateId: t.templateId })),
		...SHIPPED_SPEECH_VARIABLE_LAYOUTS.map((l) => ({ name: l.name, seedKey: l.seedKey, templateId: l.templateId }))
	]
	it("there are five rows (3 line templates + 2 layouts)", () => {
		expect(rows).toHaveLength(5)
		expect(new Set(rows.map((r) => r.templateId)).size).toBe(5)
	})
	it.each(rows.map((r) => [r.name, r] as const))("%s: the catalogue's id is the app's derivation of its seed key", (_n, r) => {
		expect(coreTemplateIdFor(r.seedKey)).toBe(r.templateId)
	})
	it("SPOKEN_LINE_TEMPLATE_IDS are the line templates' derived ids", () => {
		expect(SPOKEN_LINE_TEMPLATE_IDS.whole).toBe(coreTemplateIdFor("pipeline-context-template:core:spoken-line-whole"))
		expect(SPOKEN_LINE_TEMPLATE_IDS.dialogue).toBe(coreTemplateIdFor("pipeline-context-template:core:spoken-line-dialogue"))
		expect(SPOKEN_LINE_TEMPLATE_IDS.narration).toBe(coreTemplateIdFor("pipeline-context-template:core:spoken-line-narration"))
	})
})
