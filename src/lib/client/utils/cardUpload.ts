import { cardFileTooLarge } from "$lib/shared/imports/fileCaps"

/**
 * A card file the person chose, as the base64 `characters:importCard` takes —
 * or the server's own sentence refusing it, said BEFORE a byte is read or
 * uploaded (lorebooks plan S4). The one door every card upload on the page
 * goes through: the first-run wizard once uploaded any size, and a file past
 * Socket.IO's transport limit (about 75 MB, once base64) disconnected with no
 * sentence at all.
 */
export async function cardFileForUpload(
	file: Blob
): Promise<{ base64: string } | { refused: string }> {
	const tooLarge = cardFileTooLarge(file.size)
	if (tooLarge) return { refused: tooLarge }
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result ?? ""))
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(file)
	})
	const base64 = dataUrl.split(",")[1] ?? ""
	return base64
		? { base64 }
		: { refused: "This file is empty, so there is no card to import." }
}
