import type * as schema from "$lib/server/db/schema"
import type { db } from "$lib/server/db"
import type {
	PgDatabase,
	PgQueryResultHKT,
	SelectedFieldsFlat
} from "drizzle-orm/pg-core"
import type { CompletionTemplate } from "$lib/shared/constants/completionTemplates"
import type { WireMode } from "@serene-pub/sdk"

export global {
	/**
	 * **The database handle a server module takes as a parameter.**
	 *
	 * The one spelling, global for the same reason `DbTransaction` below is:
	 * this is where handle-shaped types live, and a global costs no import —
	 * which is what keeps the "a **parameter**, never an import" posture
	 * visible. A module that names `Db` has no `$lib/server/db` in its import
	 * list at all, so nothing that imports it ends up with a live PGlite handle
	 * behind it, and any `PgDatabase` over this schema satisfies it (the parity
	 * harness's, the test suite's, a transaction). `PgDatabase` is itself a
	 * type-only import and `verbatimModuleSyntax` erases it outright, so even a
	 * module that spelled this out longhand would bind no driver at runtime —
	 * the global just spares every site the spelling.
	 *
	 * ⚠ It replaces `db: any` / `type Db = { select: any }`, which was not
	 * merely loose but **load-bearing in the wrong direction**: `any` on
	 * `select` makes every ROW read through it an `any` too, so a column that
	 * has never existed (`config.localModel`, `connection.tokenLimit`,
	 * `connection.contextSize`) type-checks cleanly and collapses its
	 * expression to the fallback forever. The table objects were always
	 * checked; the rows were not, and the rows are where the reads are.
	 *
	 * A module that needs the DRIVER rather than the schema (a dump, a raw
	 * migration read) wants `MigrationDb` below instead.
	 */
	export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

	/**
	 * A handle at MIGRATION time, when the schema is not a fact yet.
	 *
	 * `Db` above is wrong for the backup/ledger/data-upgrade path in both
	 * directions: those run before (or across) the migrations that make the
	 * schema true, they speak nothing but raw SQL, and the databases handed to
	 * them are frequently `drizzle(client)` with no schema generic at all — not
	 * assignable to `Db`, and rightly so.
	 *
	 * So it names the surface actually used and nothing else. Structural, so
	 * every driver and every schema generic satisfies it; `Pick`ed off
	 * `PgDatabase` rather than hand-written, so the signature stays drizzle's
	 * own.
	 *
	 * ⚠ `transaction` is the exception and has to be: `PgTransaction` carries a
	 * `protected schema` keyed on the schema generic, and protected members are
	 * compared invariantly — so the `Pick`ed method would refuse the app's own
	 * handle, which is the one caller that matters. Declared in terms of
	 * `MigrationTx` below, which has no protected members to disagree about.
	 */
	export type MigrationDb = Pick<PgDatabase<PgQueryResultHKT>, "execute"> & {
		transaction<T>(transaction: (tx: MigrationTx) => Promise<T>): Promise<T>
	}

	/** The transaction half of `MigrationDb` — what a data upgrade is handed. */
	export type MigrationTx = Pick<PgDatabase<PgQueryResultHKT>, "execute">

	// Transaction handle type inferred directly from the db instance's own
	// `.transaction()` callback parameter, so it always matches whatever
	// driver (pglite) backs `db`.
	export type DbTransaction = Parameters<typeof db.transaction>[0] extends (
		tx: infer T,
		...args: any[]
	) => any
		? T
		: never

	// Column/expression map accepted by Drizzle's `.returning(fields)`. Kept
	// flat (rather than the wider `SelectedFields`) since `PgDelete.returning`
	// only accepts `SelectedFieldsFlat`; a flat map is still assignable
	// wherever the wider `SelectedFields` (e.g. `PgUpdate.returning`) is
	// expected.
	export type ReturningSelect = SelectedFieldsFlat
	// User types
	export type SelectUser = typeof schema.users.$inferSelect
	export type InsertUser = typeof schema.users.$inferInsert
	export type UpdateUser = Partial<SelectUser> & { id: number }

	// Sampling Config types
	export type SelectSamplingConfig =
		typeof schema.samplingConfigs.$inferSelect
	export type InsertSamplingConfig =
		typeof schema.samplingConfigs.$inferInsert
	export type UpdateSamplingConfig = Partial<SelectSamplingConfig> & {
		id: number
	}
	/**
	 * A sampling config AS AN ADAPTER RECEIVES IT: flat, only the parameters
	 * switched on, defaults already applied. Produced by `resolveSampling()`
	 * (server/utils/resolveSampling.ts) from a `SelectSamplingConfig`.
	 *
	 * Global, like the row types beside it, so that the seven adapters can name
	 * the thing they are handed without each importing it — and so that the
	 * difference between "the row" and "what goes on the wire" is a type anyone
	 * reading an adapter signature can see.
	 */
	export type ResolvedSampling = Record<string, any>

	// Completion template types
	export type SelectCompletionTemplate =
		typeof schema.completionTemplates.$inferSelect
	export type InsertCompletionTemplate =
		typeof schema.completionTemplates.$inferInsert
	export type UpdateCompletionTemplate = Partial<SelectCompletionTemplate> & {
		id: number
	}

	// Connection types
	export type SelectConnection = typeof schema.connections.$inferSelect
	export type InsertConnection = typeof schema.connections.$inferInsert
	export type UpdateConnection = Partial<SelectConnection> & { id: number }

	/**
	 * One MODEL on an endpoint (0114) — the second half of the pair.
	 *
	 * Global, like the connection row types above it: `connections/models.ts`
	 * merges one onto a connection, four socket handlers write them, and the
	 * pickers name them, so the alternative is five files importing a row type
	 * for a table whose name they already say out loud.
	 */
	export type SelectConnectionModel =
		typeof schema.connectionModels.$inferSelect
	export type InsertConnectionModel =
		typeof schema.connectionModels.$inferInsert
	export type UpdateConnectionModel = Partial<SelectConnectionModel> & {
		id: number
	}
	/**
	 * A connection AS AN ADAPTER RECEIVES IT: the row, plus the
	 * `completion_templates` row its `prompt_format` names, already
	 * dereferenced. Produced by `withCompletionTemplate()`
	 * (server/connections/completionTemplates.ts) wherever a connection is
	 * loaded for a run.
	 *
	 * Global, like `ResolvedSampling` above and for the same reason: it is the
	 * difference between "the row" and "what an adapter is handed", and the
	 * seven adapters should be able to name it without importing anything.
	 *
	 * ## Why the template rides on the connection
	 *
	 * `prompt_format` is a KEY, and `completionTemplateOf` resolves a bare key
	 * against the BUILT-INS — so an adapter holding only the row could never
	 * see a template an admin authored, and stopped every generation on the
	 * default's markers while the prompt was rendered in the admin's. The row
	 * has to be dereferenced from the table, the table needs `db`, and an
	 * adapter must not have one (nor may `promptTextFor` become async). So the
	 * dereference happens where the connection is already being loaded and
	 * travels with it.
	 *
	 * ⚠ OPTIONAL, and it has to stay optional: a hand-built connection (a unit
	 * test, `connections:test` on unsaved form state) legitimately has no
	 * resolved template, and `BaseConnectionAdapter.completionTemplate` falls
	 * back to exactly what the renderer falls back to for that case.
	 */
	export type AdapterConnection = SelectConnection & {
		/**
		 * Which `connection_models` row this connection was MERGED with (0114),
		 * or null for an endpoint that has none.
		 *
		 * ⚠ The merge is why every adapter still reads `this.connection.model`
		 * and still gets the right string: `mergeEndpointModel` substitutes the
		 * model's identifier, template, tokenizer and capability layers INTO the
		 * row before it travels, so the adapters did not move. These three
		 * fields are what the endpoint has no column for, carried so a queue
		 * label, a receipt and `dispatchStep`'s token budget can name the model
		 * rather than the endpoint.
		 *
		 * ⚠ OPTIONAL, for the reason `completionTemplate` and `wireMode` below
		 * are: a hand-built connection (a unit test, `connections:test` on
		 * unsaved form state) has never been through the merge.
		 */
		connectionModelId?: number | null
		connectionModelName?: string | null
		/** The model's own context window, or null for "the sampling config decides". */
		contextWindow?: number | null
		completionTemplate?: CompletionTemplate | null
		/**
		 * Which METHOD this connection wants to be called by — `chat`
		 * (role-tagged messages) or `completion` (one text prompt).
		 *
		 * Attached by `withWireMode()` (server/connections/resolve.ts) at the two
		 * places a connection is loaded for a run, alongside the completion
		 * template above and for the same reason: resolving it needs the row's
		 * four capability layers, an adapter must not do that reading itself, and
		 * the value has to be the SAME one the pipeline rendered against.
		 *
		 * ⚠ OPTIONAL, and it has to stay optional for the same reason
		 * `completionTemplate` does: a hand-built connection (a unit test,
		 * `connections:test` on unsaved form state) has none, and
		 * `BaseConnectionAdapter.wireMode` falls back through the row's own
		 * declaration. It is also the field a test SETS to pin a mode, which is
		 * what replaced the `extraJson.useSession` / `prerenderPrompt` flags the
		 * adapters used to read.
		 */
		wireMode?: WireMode | null
	}

	// Widget style types (PLAN 25)
	export type SelectWidgetStyle = typeof schema.widgetStyles.$inferSelect
	export type InsertWidgetStyle = typeof schema.widgetStyles.$inferInsert
	export type UpdateWidgetStyle = Partial<SelectWidgetStyle> & { id: number }

	// Session layout preset types (PLAN 25 redesign)
	export type SelectSessionLayoutPreset =
		typeof schema.sessionLayoutPresets.$inferSelect
	export type InsertSessionLayoutPreset =
		typeof schema.sessionLayoutPresets.$inferInsert
	export type UpdateSessionLayoutPreset =
		Partial<SelectSessionLayoutPreset> & { id: number }

	// Context Config types
	export type SelectContextConfig = typeof schema.contextConfigs.$inferSelect
	export type InsertContextConfig = typeof schema.contextConfigs.$inferInsert
	export type UpdateContextConfig = Partial<SelectContextConfig> & {
		id: number
	}

	// Prompt Config types
	export type SelectPromptConfig = typeof schema.promptConfigs.$inferSelect
	export type InsertPromptConfig = typeof schema.promptConfigs.$inferInsert
	export type UpdatePromptConfig = Partial<SelectPromptConfig> & {
		id: number
	}

	// Narrator Prompt Config types
	export type SelectNarratorPromptConfig =
		typeof schema.narratorPromptConfigs.$inferSelect
	export type InsertNarratorPromptConfig =
		typeof schema.narratorPromptConfigs.$inferInsert
	export type UpdateNarratorPromptConfig =
		Partial<SelectNarratorPromptConfig> & {
			id: number
		}

	// Lorebook types
	export type SelectLorebook = typeof schema.lorebooks.$inferSelect
	export type InsertLorebook = typeof schema.lorebooks.$inferInsert
	export type UpdateLorebook = Partial<SelectLorebook> & { id: number }

	// Lorebook Binding types
	export type SelectLorebookBinding =
		typeof schema.lorebookBindings.$inferSelect
	export type InsertLorebookBinding =
		typeof schema.lorebookBindings.$inferInsert
	export type UpdateLorebookBinding = Partial<SelectLorebookBinding> & {
		id: number
	}

	/**
	 * Lorebook entry types are **not** here, and the absence is the decision.
	 *
	 * `SelectWorldLoreEntry` / `SelectCharacterLoreEntry` / `SelectHistoryEntry`
	 * inferred from the three legacy tables, which is what made
	 * `attachCharacterLoreToCharacters(entries: SelectCharacterLoreEntry[])` a
	 * compile-time guard against being handed world lore. They named the *wire
	 * row*, and the wire contract died when the three socket namespaces
	 * collapsed into `entries:*`. The guard is recovered as
	 * `LorebookEntry<typeId>` in `$lib/shared/entries/types` — branded by the
	 * real, non-null `type_id` column, so it refuses in both directions at
	 * compile time *and* narrows at runtime, which a phantom brand could not.
	 *
	 * It lives in a module rather than in this ambient block because the client
	 * names it too, and because a generic row shape belongs beside the
	 * declarations it mirrors rather than beside `$inferSelect` aliases for
	 * tables that no longer back it.
	 */

	// Tag types
	export type SelectTag = typeof schema.tags.$inferSelect
	export type InsertTag = typeof schema.tags.$inferInsert
	export type UpdateTag = Partial<SelectTag> & { id: number }

	// Character Tag types
	export type SelectCharacterTag = typeof schema.characterTags.$inferSelect
	export type InsertCharacterTag = typeof schema.characterTags.$inferInsert

	// Persona Tag types
	export type SelectPersonaTag = typeof schema.personaTags.$inferSelect
	export type InsertPersonaTag = typeof schema.personaTags.$inferInsert

	// Lorebook Tag types
	export type SelectLorebookTag = typeof schema.lorebookTags.$inferSelect
	export type InsertLorebookTag = typeof schema.lorebookTags.$inferInsert

	// Session Tag types
	export type SelectSessionTag = typeof schema.sessionTags.$inferSelect
	export type InsertSessionTag = typeof schema.sessionTags.$inferInsert

	// Character types
	export type SelectCharacter = typeof schema.characters.$inferSelect
	export type InsertCharacter = typeof schema.characters.$inferInsert
	export type UpdateCharacter = Partial<SelectCharacter> & { id: number }

	// Persona types
	export type SelectPersona = typeof schema.personas.$inferSelect
	export type InsertPersona = typeof schema.personas.$inferInsert
	export type UpdatePersona = Partial<SelectPersona> & { id: number }

	// Session types
	export type SelectSession = typeof schema.sessions.$inferSelect
	export type InsertSession = typeof schema.sessions.$inferInsert
	export type UpdateSession = Partial<SelectSession> & { id: number }

	// Session Message types
	export type SelectSessionMessage =
		typeof schema.sessionMessages.$inferSelect & {
			/**
			 * The parts-native half, attached by the server's wire enrichment
			 * (20 §13 phase 2). Optional: a message emitted mid-generation or
			 * by a not-yet-migrated path carries only the legacy fields, and
			 * the client's legacy rendering is parity-identical.
			 */
			parts?: SelectMessagePart[]
			activeRevisions?: Record<string, number>
			kind?: string
			speakerLabel?: string | null
			channel?: string
			extras?: Record<string, unknown>
			version?: string | null
		}
	export type InsertSessionMessage =
		typeof schema.sessionMessages.$inferInsert
	export type UpdateSessionMessage = Partial<SelectSessionMessage> & {
		id: number
	}

	// The message model (20 §1)
	export type SelectMessagePart = typeof schema.messageParts.$inferSelect
	export type SelectMessageRow = typeof schema.messages.$inferSelect
	// Media (28, resplit by 0182): a `files` row is the logical file and its
	// metadata, a `variants` row is one set of bytes on disk. A payload is
	// built from the file row alone.
	export type SelectFile = typeof schema.files.$inferSelect
	export type SelectVariant = typeof schema.variants.$inferSelect
	/** @deprecated 28 folded session_assets into media, and 0182 split media
	 *  into files + variants. This is the FILE row; bytes, mime and path live
	 *  on a variant. */
	export type SelectSessionAsset = SelectFile

	// Session Persona types
	export type SelectSessionPersona =
		typeof schema.sessionPersonas.$inferSelect
	export type InsertSessionPersona =
		typeof schema.sessionPersonas.$inferInsert

	// Session Character types
	export type SelectSessionCharacter =
		typeof schema.sessionCharacters.$inferSelect
	export type InsertSessionCharacter =
		typeof schema.sessionCharacters.$inferInsert

	// Session Lorebook types
	export type SelectSessionLorebook =
		typeof schema.sessionLorebooks.$inferSelect
	export type InsertSessionLorebook =
		typeof schema.sessionLorebooks.$inferInsert

	export type SelectSystemSettings = typeof schema.systemSettings.$inferSelect
	export type InsertSystemSettings = typeof schema.systemSettings.$inferInsert

	export type SelectOllamaSettings = typeof schema.ollamaSettings.$inferSelect
	export type InsertOllamaSettings = typeof schema.ollamaSettings.$inferInsert

	export type SelectKoboldCppSettings =
		typeof schema.koboldCppSettings.$inferSelect
	export type InsertKoboldCppSettings =
		typeof schema.koboldCppSettings.$inferInsert

	export type SelectUserSettings = typeof schema.userSettings.$inferSelect
	export type InsertUserSettings = typeof schema.userSettings.$inferInsert

	// Scene types
	export type SelectScene = typeof schema.scenes.$inferSelect
	export type InsertScene = typeof schema.scenes.$inferInsert
	export type UpdateScene = Partial<SelectScene> & { id: number }

	// Narrative graph types — a "node" IS a lorebookBindings row now (see
	// the merge plan); these names are kept as aliases for call sites that
	// still think in "node" terms (test fixtures, mostly), rather than
	// forcing every reference to be renamed.
	export type SelectNarrativeNode = SelectLorebookBinding
	export type InsertNarrativeNode = InsertLorebookBinding
	export type UpdateNarrativeNode = Partial<SelectNarrativeNode> & {
		id: number
	}

	export type SelectNarrativeRelationship =
		typeof schema.narrativeRelationships.$inferSelect
	export type InsertNarrativeRelationship =
		typeof schema.narrativeRelationships.$inferInsert
	export type UpdateNarrativeRelationship =
		Partial<SelectNarrativeRelationship> & { id: number }

	// World Summarize Config types
	export type SelectWorldSummarizeConfig =
		typeof schema.worldSummarizeConfigs.$inferSelect
	export type InsertWorldSummarizeConfig =
		typeof schema.worldSummarizeConfigs.$inferInsert
	export type UpdateWorldSummarizeConfig =
		Partial<SelectWorldSummarizeConfig> & { id: number }

	// Character Summarize Config types
	export type SelectCharacterSummarizeConfig =
		typeof schema.characterSummarizeConfigs.$inferSelect
	export type InsertCharacterSummarizeConfig =
		typeof schema.characterSummarizeConfigs.$inferInsert
	export type UpdateCharacterSummarizeConfig =
		Partial<SelectCharacterSummarizeConfig> & { id: number }

	// Scene Summarize Config types
	export type SelectSceneSummarizeConfig =
		typeof schema.sceneSummarizeConfigs.$inferSelect
	export type InsertSceneSummarizeConfig =
		typeof schema.sceneSummarizeConfigs.$inferInsert
	export type UpdateSceneSummarizeConfig =
		Partial<SelectSceneSummarizeConfig> & { id: number }

	// Graph Build Config types
	export type SelectGraphBuildConfig =
		typeof schema.graphBuildConfigs.$inferSelect
	export type InsertGraphBuildConfig =
		typeof schema.graphBuildConfigs.$inferInsert
	export type UpdateGraphBuildConfig = Partial<SelectGraphBuildConfig> & {
		id: number
	}

	// Account invite types (plan 27)
	export type SelectAccountInvite = typeof schema.accountInvites.$inferSelect
	export type InsertAccountInvite = typeof schema.accountInvites.$inferInsert

	// Server types (plan 26)
	export type SelectServer = typeof schema.servers.$inferSelect
	export type InsertServer = typeof schema.servers.$inferInsert
	export type UpdateServer = Partial<SelectServer> & { id: number }

	// Tunnel types (plan 26)
	export type SelectTunnel = typeof schema.tunnels.$inferSelect
	export type InsertTunnel = typeof schema.tunnels.$inferInsert
	export type UpdateTunnel = Partial<SelectTunnel> & { id: number }

	// Convenient re-exports of narrative graph inline types for server-side handlers
	export type NarrativeNodeShape = Sockets.NarrativeGraph.NarrativeNode
	export type NarrativeRelationshipShape =
		Sockets.NarrativeGraph.NarrativeRelationship
}
