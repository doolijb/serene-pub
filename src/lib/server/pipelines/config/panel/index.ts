/**
 * The configuration layer, as a read model and four writes (12 §2).
 *
 * Everything the pipeline view knows comes from here, and everything here comes
 * from **rows** rather than from an in-process descriptor map — see
 * `declarations.ts` for why that is a requirement and not a preference.
 *
 * The pieces, in the order a request moves through them:
 *
 * | file | what it holds |
 * |---|---|
 * | `types.ts` | the vocabulary — `ConfigOption`, `Decl`, the two errors |
 * | `ids.ts` | an option's opaque handle, and why it is not decodable |
 * | `declarations.ts` | what the registry says can be configured |
 * | `choices.ts` | the rows a reference-valued slot may name |
 * | `scopes.ts` | who may write what, and where the write lands |
 * | `read.ts` | `listNamespaces` / `namespaceView` — resolved, with provenance |
 * | `write.ts` | `writeOption` / `clearOption` / `selectNamedConfig` |
 *
 * This barrel is the public face: import from
 * `$lib/server/pipelines/config/panel`, not from the files behind it.
 */

export type {
	Viewer,
	OptionSource,
	WriteScope,
	ConfigOption,
	ConfigStep,
	NamedConfigSummary,
	NamespaceSummary,
	NamespaceView,
	Decl
} from "$lib/server/pipelines/config/panel/types"
export {
	OptionNotFoundError,
	OptionNotWritableError
} from "$lib/server/pipelines/config/panel/types"

export { optionId } from "$lib/server/pipelines/config/panel/ids"
export {
	declarations,
	humanizeTypeId,
	// The panel resolves display text this way and the builder needs the same
	// rule: two readings of an `I18n` is one that eventually disagrees.
	i18nText
} from "$lib/server/pipelines/config/panel/declarations"
export { writeScopeFor } from "$lib/server/pipelines/config/panel/scopes"
export {
	listNamespaces,
	namespaceView
} from "$lib/server/pipelines/config/panel/read"
export {
	writeOption,
	clearOption,
	selectNamedConfig,
	variableOptionGate,
	contextTemplateOptionGate
} from "$lib/server/pipelines/config/panel/write"
