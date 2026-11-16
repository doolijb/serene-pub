/** The kinds of knowledge tie between a cast member and an entry; the last is the opposite of the rest. */
export const KNOWLEDGE_KINDS = [
	"was_told",
	"knows",
	"has_been_there",
	"kept_from"
] as const

/** One knowledge tie kind (`narrative_relationships.knowledge_kind`). */
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number]

/** True when `v` is one of the knowledge tie kinds. */
export function isKnowledgeKind(v: unknown): v is KnowledgeKind {
	return (
		typeof v === "string" &&
		(KNOWLEDGE_KINDS as readonly string[]).includes(v)
	)
}
