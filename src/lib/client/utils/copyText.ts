/**
 * Copies text to the clipboard. `navigator.clipboard` exists only in a secure
 * context and a LAN address over http is not one, so this falls back to a
 * selection copy. Resolves true when the text reached the clipboard; never throws.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text)
			return true
		}
	} catch {
		// Fall through to the selection copy.
	}
	let area: HTMLTextAreaElement | null = null
	try {
		area = document.createElement("textarea")
		area.value = text
		area.setAttribute("readonly", "")
		area.style.position = "fixed"
		area.style.opacity = "0"
		document.body.appendChild(area)
		area.select()
		return document.execCommand("copy") === true
	} catch {
		return false
	} finally {
		if (area?.parentNode) area.parentNode.removeChild(area)
	}
}
