/**
 * A modality is a SECTION — one entry per modality, and nothing else to edit.
 *
 * ## The rule
 *
 * A modality is a section, and a section is a row in this table. Adding NER
 * (`text->entities`) is one entry here plus the types that declare the modality:
 * no new branch in the sidebar's filter, no new view state, no new panel.
 *
 * ⚠ A modality given a panel of its own stops being a KIND OF CONNECTION and
 * becomes a feature that happens to have an endpoint — which means one of it,
 * bespoke verbs instead of a star, and no way to keep two configured and pick
 * between them. That is the shape this table exists to make impossible.
 *
 * ## Every field is something the sidebar would otherwise have branched on
 *
 * `label`/`description`/`icon` are the index card. `starCapability` is which
 * capability this section's star registers in `connection_defaults` — the
 * question that has no answer at the connection level, because one KoboldCPP row
 * does chat, vision and image generation from one process, so the category the
 * person is standing in is what says which they meant. `starVerb` is the
 * sentence on the button and in the screen-reader announcement.
 *
 * ⚠ **Ordering is display order.** Text generation first because it is the one
 * every install needs.
 *
 * ⚠ Client-safe: no adapter module, no SDK import, no Svelte. `capabilityGuard`
 * on the server reads it too (see `modalityAllows`), and it renders in the
 * browser.
 */

/** One modality, as the sidebar and the capability guard both see it. */
export interface ConnectionSection {
	/** The value in `connections.modality`, and what `modalityOf` answers. */
	modality: string
	/** The card heading and the management view's title. */
	label: string
	/** One line under the heading. */
	description: string
	/**
	 * A `@lucide/svelte` export name, resolved by the component that renders the
	 * card.
	 *
	 * A string rather than the component itself, so this module stays importable
	 * from the server (`capabilityGuard`) and from a plain unit test — pulling a
	 * Svelte component in here would make both impossible for the sake of an
	 * icon.
	 */
	icon: string
	/**
	 * The transform id this section's star registers in `connection_defaults`.
	 *
	 * ⚠ Exactly one per section, and no two sections may name the same one — a
	 * capability whose default two sections could both write is a star that
	 * moves when somebody was looking at a different list.
	 */
	starCapability: string
	/** The verb on the star button: "Use for chat", "Already used for chat". */
	starVerb: string
	/** What the list says when this modality has no connections yet. */
	emptyMessage: string
}

export const CONNECTION_SECTIONS: readonly ConnectionSection[] = [
	{
		modality: "text-gen",
		label: "Large Language Models",
		description:
			"Connections used for session, summarization, and narration.",
		icon: "Type",
		starCapability: "text->text",
		starVerb: "chat",
		emptyMessage:
			"No AI connections yet. Create one to get started with AI conversations."
	},
	{
		modality: "image-gen",
		label: "Image Generation",
		description:
			"Local image backends (KoboldCPP, A1111, …) for portraits and scene art.",
		icon: "Image",
		starCapability: "text->image",
		starVerb: "image generation",
		emptyMessage: "No image connections yet. Add one to generate images."
	},
	{
		modality: "embeddings",
		label: "Embeddings",
		description:
			"Turns lore, characters and messages into vectors, so retrieval can find lorebook entries by meaning.",
		// `Zap` is the embedding kind's icon — the same mark an entry shows when
		// its vectors are current (EmbeddingStatusIcon) and the Embeddings group
		// wears in admin/defaults. `Network` is the narrative graph's (NOMENCLATURE §22).
		icon: "Zap",
		starCapability: "text->embedding",
		starVerb: "embeddings",
		emptyMessage:
			"No embedding connections yet. Add one to turn on retrieval."
	},
	{
		modality: "ner",
		label: "Named entities",
		description:
			"Reads the names out of messages and lore, so an entry can be found by what it is called.",
		icon: "ScanText",
		starCapability: "text->entities",
		starVerb: "entity extraction",
		emptyMessage:
			"No entity connections yet. One finds the people, places and things a message names, so lore can be matched by name even when no keyword is set."
	}
]

/**
 * The section a modality belongs to, or undefined for one nothing declares.
 *
 * Undefined rather than a default section, deliberately: a plugin's modality is
 * not text generation, and answering with the text section would put its
 * connections in the LLM list and offer to star one as the chat default.
 */
export function sectionForModality(
	modality: string | null | undefined
): ConnectionSection | undefined {
	return CONNECTION_SECTIONS.find((s) => s.modality === modality)
}

/** The section whose star registers this capability, if any does. */
export function sectionForCapability(
	capability: string | null | undefined
): ConnectionSection | undefined {
	return CONNECTION_SECTIONS.find((s) => s.starCapability === capability)
}

/**
 * Every capability some section's star registers.
 *
 * Read by `capabilityGuard.modalityAllows`, which is why it is a set rather than
 * a repeated `.some()`: that predicate runs for every connection against every
 * slot in the picker.
 */
export const SECTION_STAR_CAPABILITIES: ReadonlySet<string> = new Set(
	CONNECTION_SECTIONS.map((s) => s.starCapability)
)

/** The modality whose connections can serve this capability's star, if any. */
export const MODALITY_FOR_STAR_CAPABILITY: Readonly<Record<string, string>> =
	Object.fromEntries(
		CONNECTION_SECTIONS.map((s) => [s.starCapability, s.modality])
	)

/** What comes OUT of a transform id — `"text+image->text"` → `"text"`. */
const outputSide = (id: string): string | null => {
	const at = id.indexOf("->")
	return at < 0 ? null : id.slice(at + 2)
}

/** Each section's modality, keyed by what its star transform produces. */
const MODALITY_FOR_OUTPUT: Readonly<Record<string, string>> =
	Object.fromEntries(
		CONNECTION_SECTIONS.map((s) => [outputSide(s.starCapability), s.modality])
	)

/**
 * Which modality a transform belongs to, read off what it PRODUCES: every
 * `…->text` is text generation (vision and documents included), every
 * `…->image` is image generation. Null for a feature (`tools`, `streaming`),
 * which has no side and qualifies whatever transform it rides on, and for an
 * output no section owns (`text->audio`).
 *
 * The rule a connection model's own modality is judged by — see
 * `capabilityGuard.modelModalityAllows`.
 */
export function modalityOfTransform(id: string): string | null {
	const out = outputSide(id)
	return out == null ? null : (MODALITY_FOR_OUTPUT[out] ?? null)
}
