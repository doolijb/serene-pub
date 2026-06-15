/**
 * Parses XML-style tagged fields from LLM plain text output.
 * Designed to be forgiving — always returns raw output as fallback.
 */

export interface ParsedSummary {
	name?: string
	date?: string
	content?: string
	raw: string
}

function extractTag(raw: string, tag: string): string | undefined {
	const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i")
	const match = raw.match(regex)
	if (!match) return undefined
	const trimmed = match[1].trim()
	return trimmed.length > 0 ? trimmed : undefined
}

/** Ensure each bullet line ends with a sentence-terminating punctuation mark. */
function normalizeBulletPunctuation(content: string): string {
	return content
		.split("\n")
		.map((line) => {
			const trimmed = line.trim()
			if (!trimmed.startsWith("•")) return trimmed
			return /[.!?]$/.test(trimmed) ? trimmed : trimmed + "."
		})
		.join("\n")
}

export function parseSummaryOutput(raw: string): ParsedSummary {
	const trimmed = raw.trim()
	const rawContent = extractTag(trimmed, "content")
	return {
		name: extractTag(trimmed, "name"),
		date: extractTag(trimmed, "date"),
		content: rawContent !== undefined ? normalizeBulletPunctuation(rawContent) : undefined,
		raw: trimmed
	}
}

/**
 * Parse a date string like "Year 412, Month 3, Day 7" into numeric parts.
 * Returns nulls for any part that can't be parsed.
 */
export function parseDateString(dateStr: string): {
	year: number | null
	month: number | null
	day: number | null
} {
	const yearMatch = dateStr.match(/year\s+(\d+)/i)
	const monthMatch = dateStr.match(/month\s+(\d+)/i)
	const dayMatch = dateStr.match(/day\s+(\d+)/i)

	return {
		year: yearMatch ? parseInt(yearMatch[1], 10) : null,
		month: monthMatch ? parseInt(monthMatch[1], 10) : null,
		day: dayMatch ? parseInt(dayMatch[1], 10) : null
	}
}
