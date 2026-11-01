/**
 * One sound at a time (owner requirement, 2026-10-29): when any `audio` or
 * `video` in the document starts, every other one that is playing is paused,
 * and its own `pause` event arrives so whoever follows it stays honest.
 *
 * One capture listener on the document (`play` does not bubble), installed
 * once per document. Covers every widget box and the page's own players
 * (the voice try-out clip) alike.
 */
const installed = new WeakSet<Document>()

export function ensureOneSoundAtATime(doc: Document = document): void {
	if (installed.has(doc)) return
	installed.add(doc)
	doc.addEventListener(
		"play",
		(e) => {
			const from = e.target
			if (!(from instanceof HTMLMediaElement)) return
			doc.querySelectorAll("audio, video").forEach((m) => {
				if (m !== from && m instanceof HTMLMediaElement && !m.paused) m.pause()
			})
		},
		true
	)
}
