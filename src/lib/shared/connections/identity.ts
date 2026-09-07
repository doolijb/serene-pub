/**
 * What a connection IS, to anyone allowed to know.
 *
 * Shared rather than server-owned because it travels on the wire: a progress
 * event and a stored generation error both carry one, and the client has to be
 * able to name the shape it is rendering. The *policy* — which key it hides
 * under, who may receive it, and where it is removed — stays in
 * `$lib/server/connections/visibility.ts`, which re-exports this and owns the
 * builder. One spelling of the shape, one place that decides who sees it.
 *
 * ⚠ Every field here is a fact a non-admin must not learn, and every one of them
 * used to be interpolated into prose somewhere: the name into the capability
 * refusal, the model path into an image-load progress line, the type into a
 * receipt's `via`, and the base URL into whatever a service chose to put in its
 * own error text. Adding a field that is NOT connection identity would make this
 * bag mean two things and quietly delete the innocent half for every non-admin.
 */
export interface ConnectionIdentity {
	id?: number | null
	name?: string | null
	/** The model the row names — a file path, on a managed connection. */
	model?: string | null
	/** The adapter kind: "koboldcpp", "openai-chat". */
	type?: string | null
	/**
	 * What the service itself said, verbatim.
	 *
	 * Inside the bag rather than beside it, because an upstream error message is
	 * connection identity written by somebody else — it names the base URL, the
	 * model file, occasionally the key — so it has to be removed by the same walk,
	 * at the same moment, as the fields around it.
	 */
	detail?: string
}
