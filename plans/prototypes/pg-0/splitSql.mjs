// Split a pg_dump plain-text script into statements. Handles '...' (with backslash
// escapes while standard_conforming_strings is off, tracked from SET statements),
// E'...', "...", $tag$...$tag$, -- and /* */ comments. Comment-only chunks are dropped.
export function splitSql(text) {
	const out = []
	let scs = true
	let i = 0, start = 0
	const n = text.length
	const push = (end) => {
		const stmt = text.slice(start, end).trim()
		start = end
		const bare = stmt.replace(/--[^\n]*\n?/g, "").trim()
		if (!bare) return
		out.push(stmt)
		const m = /^SET\s+standard_conforming_strings\s*=\s*'?(on|off)'?/i.exec(bare)
		if (m) scs = m[1].toLowerCase() === "on"
	}
	while (i < n) {
		const c = text[i]
		if (c === "-" && text[i + 1] === "-") {
			const e = text.indexOf("\n", i)
			i = e < 0 ? n : e + 1
		} else if (c === "/" && text[i + 1] === "*") {
			let depth = 1
			i += 2
			while (i < n && depth) {
				if (text[i] === "/" && text[i + 1] === "*") { depth++; i += 2 }
				else if (text[i] === "*" && text[i + 1] === "/") { depth--; i += 2 }
				else i++
			}
		} else if (c === "'") {
			const esc = !scs || /[eE]/.test(text[i - 1] || "") && !/[A-Za-z0-9_]/.test(text[i - 2] || "")
			i++
			while (i < n) {
				if (esc && text[i] === "\\") { i += 2; continue }
				if (text[i] === "'") {
					if (text[i + 1] === "'") { i += 2; continue }
					i++
					break
				}
				i++
			}
		} else if (c === '"') {
			i++
			while (i < n) {
				if (text[i] === '"') { if (text[i + 1] === '"') { i += 2; continue } i++; break }
				i++
			}
		} else if (c === "$") {
			const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64))
			if (m && !/[A-Za-z0-9_]/.test(text[i - 1] || "")) {
				const tag = m[0]
				const e = text.indexOf(tag, i + tag.length)
				i = e < 0 ? n : e + tag.length
			} else i++
		} else if (c === ";") {
			i++
			push(i)
		} else i++
	}
	push(n)
	return out
}
