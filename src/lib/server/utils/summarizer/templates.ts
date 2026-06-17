/**
 * Summarizer prompt templates.
 *
 * Two-phase architecture:
 *   Phase 1 — Batch drafting: each batch of messages is drafted independently.
 *             Messages are passed as a JSON array. Output is a single <content> tag.
 *   Phase 2 — Synthesis: all drafts are passed as a JSON array and merged into
 *             one final entry. Output is a single <content> tag.
 *
 * Output format: bullet points. No titles, headers, or section labels.
 */

export interface SummaryPrompt {
	systemPrompt: string
	userPrompt: string
}

export interface JsonMessage {
	speaker: string
	text: string
}

export interface JsonDraft {
	part: number
	draft: string
}

/** Format messages as a JSON array for batch prompts. */
export function formatMessagesAsJson(
	messages: { senderName: string; content: string }[]
): string {
	const json: JsonMessage[] = messages.map((m) => ({
		speaker: m.senderName,
		text: m.content.trim()
	}))
	return JSON.stringify(json, null, 2)
}

// ── Phase 1: Batch draft prompts ─────────────────────────────────────────────

export function buildBatchPrompt(opts: {
	jsonMessages: string
	loreType: "world" | "history" | "character" | "scene"
	topic?: string
}): SummaryPrompt {
	const { jsonMessages, loreType, topic } = opts
	const topicLine = topic?.trim()
		? `Focus specifically on: "${topic.trim()}"\n\n`
		: ""

	if (loreType === "character") {
		return {
			systemPrompt:
				"You are a character archivist recording facts about a specific character from a roleplay exchange. Your records are concise bullet points that capture who the character is, what they did, and how they relate to others. You write only what is directly shown — no invention, no embellishment.",
			userPrompt: `The following JSON array contains a portion of a roleplay exchange. Extract character lore as bullet points.
${topicLine}Rules:
- One bullet point per meaningful fact, ability, relationship, or event involving the character.
- Focus on character-specific details: personality traits revealed, abilities demonstrated, relationships formed or changed, past revealed, decisions made.
- Write in past tense.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the messages.

Messages:
${jsonMessages}

Output ONLY in this exact format — no other text before or after:
<content>
• [Character fact, ability, relationship, or event]
• [Character fact, ability, relationship, or event]
</content>`
		}
	}

	if (loreType === "history") {
		return {
			systemPrompt:
				"You are a chronicler recording key events from a roleplay exchange. Your records are concise bullet points that capture what changed, why it matters, and how it affected the people involved. You write only what is directly shown — no invention, no embellishment.",
			userPrompt: `The following JSON array contains a portion of a roleplay exchange. Record the key events as bullet points.
${topicLine}Rules:
- One bullet point per meaningful event, action, or change.
- Each bullet must convey: what happened, who was involved, and why it matters or what changed.
- Include emotions and reactions when they are significant.
- Write in past tense.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the messages.

Messages:
${jsonMessages}

Output ONLY in this exact format — no other text before or after:
<content>
• [Key event or change]
• [Key event or change]
</content>`
		}
	}

	if (loreType === "scene") {
		return {
			systemPrompt:
				"You are a scene archivist capturing what happened in a discrete story moment from a roleplay exchange. You write a tight narrative summary — past tense, plain prose — that captures the key beats, actions, and emotional turning points. No invention, no embellishment.",
			userPrompt: `The following JSON array contains a portion of a roleplay exchange. Write a scene summary.
${topicLine}Rules:
- Write in past tense, plain prose (not bullet points).
- Capture the key events, actions, character moments, and turning points.
- Keep it concise — aim for 2–4 short paragraphs.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the messages.

Messages:
${jsonMessages}

Output ONLY in this exact format — no other text before or after:
<content>
[Scene summary paragraph(s)]
</content>`
		}
	}

	return {
		systemPrompt:
			"You are an archivist recording world-building facts from a roleplay exchange. Your records are concise bullet points that capture facts, changes, and discoveries about the setting. You write only what is directly shown — no invention, no embellishment.",
		userPrompt: `The following JSON array contains a portion of a roleplay exchange. Extract world lore as bullet points.
${topicLine}Rules:
- One bullet point per meaningful fact, discovery, or change about the world, factions, locations, or events.
- Focus on details that matter going forward — what changed, what was revealed, what has consequences.
- Write in past tense.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the messages.

Messages:
${jsonMessages}

Output ONLY in this exact format — no other text before or after:
<content>
• [World lore fact or change]
• [World lore fact or change]
</content>`
	}
}

// ── Name generation prompt ───────────────────────────────────────────────────

export function buildNamePrompt(opts: {
	content: string
	loreType: "world" | "history" | "character" | "scene"
}): SummaryPrompt {
	const instruction =
		opts.loreType === "history"
			? "You generate short titles for historical chronicle entries. The title should capture the key event or turning point."
			: opts.loreType === "character"
				? "You generate short titles for character lore entries. The title should describe the subject matter of the entry (e.g. an ability, relationship, or past event)."
				: opts.loreType === "scene"
					? "You generate short titles for scene summaries. The title should capture the key moment or action of the scene."
					: "You generate short titles for world lore entries. The title should describe the subject of the entry."

	return {
		systemPrompt: instruction,
		userPrompt: `Generate a short title (3–7 words) for the following entry. Output ONLY the title — no punctuation at the end, no quotes, no other text.

${opts.content.slice(0, 800)}

Title:`
	}
}

// ── Phase 2: Synthesis prompt ────────────────────────────────────────────────

export function buildSynthesisPrompt(opts: {
	jsonDrafts: string
	loreType: "world" | "history" | "character" | "scene"
	topic?: string
}): SummaryPrompt {
	const { jsonDrafts, loreType, topic } = opts
	const topicLine = topic?.trim()
		? `Focus specifically on: "${topic.trim()}"\n\n`
		: ""

	if (loreType === "character") {
		return {
			systemPrompt:
				"You are a master character archivist. Given draft bullet points about a character from a roleplay exchange, you merge them into a single clean character lore entry. You write only what the drafts contain — no invention, no embellishment.",
			userPrompt: `The following JSON array contains draft character lore bullet points from a roleplay exchange. Merge them into one clean, organized bullet-point entry.
${topicLine}Rules:
- If multiple bullets describe the same trait, ability, or relationship, merge them into one bullet that captures all the detail.
- If a bullet from a later part restates something already covered, drop the repeat and keep only the richer version.
- Preserve the most specific and meaningful character details.
- Write in past tense.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the drafts.

Drafts:
${jsonDrafts}

Output ONLY in this exact format — no other text before or after:
<content>
• [Character fact, ability, relationship, or event]
• [Character fact, ability, relationship, or event]
</content>`
		}
	}

	if (loreType === "history") {
		return {
			systemPrompt:
				"You are a master chronicler. Given draft bullet points covering a roleplay exchange in chronological order, you merge them into a single clean bullet-point record. You write only what the drafts contain — no invention, no embellishment.",
			userPrompt: `The following JSON array contains draft bullet-point records covering a roleplay exchange in order. Merge them into one clean, chronological bullet-point list.
${topicLine}Rules:
- Preserve chronological order.
- If multiple bullets describe the same event or moment, merge them into one bullet that captures all the detail.
- If a bullet from a later part restates something already covered, drop the repeat and keep only the richer version.
- Each bullet must convey what happened, who was involved, and why it matters or what changed.
- Include significant emotions and reactions.
- Write in past tense.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the drafts.

Drafts:
${jsonDrafts}

Output ONLY in this exact format — no other text before or after:
<content>
• [Key event or change]
• [Key event or change]
</content>`
		}
	}

	if (loreType === "scene") {
		return {
			systemPrompt:
				"You are a master scene editor. Given draft scene summaries covering a roleplay exchange in chronological order, you merge them into a single coherent scene narrative. You write only what the drafts contain — no invention, no embellishment.",
			userPrompt: `The following JSON array contains draft scene summaries in chronological order. Merge them into one coherent scene narrative.
${topicLine}Rules:
- Preserve chronological order.
- Write in past tense, plain prose (not bullet points).
- Merge overlapping or duplicate descriptions into a single, richer version.
- Keep it concise — aim for 3–6 short paragraphs.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the drafts.

Drafts:
${jsonDrafts}

Output ONLY in this exact format — no other text before or after:
<content>
[Scene narrative paragraph(s)]
</content>`
		}
	}

	return {
		systemPrompt:
			"You are a master archivist. Given draft bullet points covering a roleplay exchange, you merge them into a single clean world lore entry. You write only what the drafts contain — no invention, no embellishment.",
		userPrompt: `The following JSON array contains draft world lore bullet points from a roleplay exchange. Merge them into one clean, organized bullet-point entry.
${topicLine}Rules:
- If multiple bullets describe the same fact or location, merge them into one bullet that captures all the detail.
- If a bullet from a later part restates something already covered, drop the repeat and keep only the richer version.
- Focus on details that matter going forward — what changed, what was revealed, what has consequences.
- Write in past tense.
- Do NOT include titles, headers, section labels, or any text outside the <content> tag.
- Do not invent details not present in the drafts.

Drafts:
${jsonDrafts}

Output ONLY in this exact format — no other text before or after:
<content>
• [World lore fact or change]
• [World lore fact or change]
</content>`
	}
}
