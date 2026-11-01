import type { WidgetRequests } from "@serene-pub/sdk"
import { invokePluginAction } from "$lib/client/components/frames/pluginActions"
import { fileTargetRefusal } from "./filePick"

const NAME_MAX = 200

/** The file name part of an answered name: no folders, at most 200 characters, or the fallback. */
function baseName(answered: unknown, fallback: string): string {
	if (typeof answered !== "string") return fallback
	const base = (answered.split(/[\\/]/).pop() ?? "").trim().slice(0, NAME_MAX)
	return base && base !== "." && base !== ".." ? base : fallback
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * 🚧 `file-save` (M0, SHAPES L12 Seams): a download whose bytes come
 * from the extension's served storage or from one of its actions.
 */
export async function answerFileSave(
	params: WidgetRequests["file-save"]["params"],
	from: { owner: string }
): Promise<void> {
	if (from.owner === "core") throw new Error("Only an extension's own frames save files for it.")
	const refusal = fileTargetRefusal(params.target)
	if (refusal) throw new Error(refusal)
	let part: BlobPart
	let name = params.name
	let mime = params.mime
	if (params.source.startsWith("storage:")) {
		const path = params.source.slice("storage:".length)
		const res = await fetch(`/plugin-data/${from.owner}/${path}`)
		if (!res.ok) throw new Error("That file is not one this extension shares.")
		part = await res.arrayBuffer()
	} else if (params.source.startsWith("handler:")) {
		const result = await invokePluginAction(from.owner, params.source.slice("handler:".length), {
			name: params.name,
			mime: params.mime,
			...(params.target !== undefined ? { target: params.target } : {})
		})
		if (typeof result === "string") part = new TextEncoder().encode(result)
		else if (
			result &&
			typeof result === "object" &&
			typeof (result as { bytes?: unknown }).bytes === "string"
		) {
			const answer = result as { bytes: string; name?: unknown; mime?: unknown }
			part = fromBase64(answer.bytes)
			name = baseName(answer.name, params.name)
			if (typeof answer.mime === "string" && answer.mime.trim()) mime = answer.mime.trim()
		} else throw new Error("The extension gave nothing to save.")
	} else throw new Error("The extension gave nothing to save.")
	const url = URL.createObjectURL(new Blob([part], { type: mime }))
	const a = document.createElement("a")
	a.href = url
	a.download = name
	a.style.display = "none"
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
