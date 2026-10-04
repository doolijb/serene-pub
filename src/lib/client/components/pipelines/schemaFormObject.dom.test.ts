/**
 * An `object` field in the one schema renderer (AN1: the author's note in
 * Edit Session › Settings): its members drawn under its label, a member group
 * as a fold, and every edit writing the object WHOLE — so a value is complete
 * from its first edit, and a number typed as text is stored as a number.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import SchemaForm from "./SchemaForm.svelte"

const schema = {
	authorsNote: {
		type: "object" as const,
		label: { en: "Author's note" },
		fields: {
			text: { type: "text" as const, label: { en: "Note" }, default: "" },
			depth: { type: "integer" as const, label: { en: "Messages from the end" }, default: 4 },
			interval: { type: "integer" as const, label: { en: "Every how many replies" }, default: 1 },
			role: {
				type: "enum" as const,
				label: { en: "Sent as" },
				of: ["system", "user", "assistant"],
				default: "system",
				group: "Advanced"
			}
		},
		default: { text: "", depth: 4, interval: 1, role: "system" }
	}
}

describe("SchemaForm — an object field", () => {
	let app: ReturnType<typeof mount> | null = null
	afterEach(() => {
		if (app) unmount(app)
		app = null
	})

	function render(values: Record<string, unknown>) {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(SchemaForm, { target: host, props: { schema: schema as never, values } })
		flushSync()
		return host
	}

	test("draws its members under its label, the grouped one in a fold, defaults shown", () => {
		const host = render({})
		expect(host.querySelector("legend")?.textContent).toContain("Author's note")
		expect((host.querySelector("#sf-authorsNote-depth") as HTMLInputElement).value).toBe("4")
		const fold = host.querySelector("details")
		expect(fold?.querySelector("summary")?.textContent).toContain("Advanced")
		expect(fold?.textContent).toContain("Sent as")
	})

	test("an edit writes the whole object, the number as a number", () => {
		const values: Record<string, unknown> = {}
		const host = render(values)
		const depth = host.querySelector("#sf-authorsNote-depth") as HTMLInputElement
		depth.value = "2"
		depth.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(values.authorsNote).toEqual({ text: "", depth: 2, interval: 1, role: "system" })

		const text = host.querySelector("#sf-authorsNote-text") as HTMLTextAreaElement
		text.value = "It is raining."
		text.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(values.authorsNote).toEqual({ text: "It is raining.", depth: 2, interval: 1, role: "system" })
	})
})
