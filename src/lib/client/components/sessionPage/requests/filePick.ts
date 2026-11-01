import type { WidgetRequests } from "@serene-pub/sdk"
import { invokePluginAction } from "$lib/client/components/frames/pluginActions"

/** 🚧 (M2a) The longest `target` a frame may give a file request. */
export const FILE_TARGET_MAX = 512

/** The sentence a bad `target` is refused with, or null when it is fine. */
export function fileTargetRefusal(target: unknown): string | null {
	if (target === undefined) return null
	if (typeof target !== "string") return "The extension's file request gave a target that is not text."
	if (target.length > FILE_TARGET_MAX)
		return `The extension's file request gave a target of ${target.length} characters; the most is ${FILE_TARGET_MAX}.`
	return null
}

/**
 * 🚧 `file-pick` (M0, SHAPES L12 Seams): the person chooses a file; the
 * bytes go to the extension's named action and never to the asking frame.
 */
export async function answerFilePick(
	params: WidgetRequests["file-pick"]["params"],
	from: { owner: string }
): Promise<void> {
	if (from.owner === "core") throw new Error("Only an extension's own frames choose files for it.")
	const refusal = fileTargetRefusal(params.target)
	if (refusal) throw new Error(refusal)
	if (navigator.userActivation && !navigator.userActivation.isActive)
		throw new Error("Choosing a file needs a click inside the extension first.")
	const input = document.createElement("input")
	input.type = "file"
	input.accept = params.accept.join(",")
	input.style.display = "none"
	document.body.appendChild(input)
	try {
		const file = await new Promise<File | null>((resolve) => {
			input.addEventListener("cancel", () => resolve(null), { once: true })
			input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true })
			input.click()
		})
		if (!file) return
		const bytes = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onerror = () => reject(new Error("That file could not be read."))
			reader.onload = () => {
				const url = String(reader.result ?? "")
				resolve(url.slice(url.indexOf(",") + 1))
			}
			reader.readAsDataURL(file)
		})
		await invokePluginAction(from.owner, params.action, {
			name: file.name,
			mime: file.type || "application/octet-stream",
			bytes,
			...(params.target !== undefined ? { target: params.target } : {})
		})
	} finally {
		input.remove()
	}
}
