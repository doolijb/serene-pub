/**
 * 🚧 The conversation **dossier** — `session_full.v1`. Its shape is the
 * SDK's `SessionDossierV1` (`@serene-pub/sdk`, beside the other section
 * shapes since C4, 2026-10-10); core's conversation re-exports it with its
 * parts and `NO_LINE` from `@serene-pub/core-catalog/conversation`, and this
 * module re-exports them where the page has always imported them.
 * `ConversationDossierV1` is `SessionDossierV1` under its old name
 * (⏳ REMOVE in 0.7.0).
 */
export {
	NO_LINE,
	type ConversationCastV1,
	type ConversationComposerV1,
	type ConversationDossierV1,
	type ConversationLineV1,
	type ConversationProposalV1,
	type ConversationSceneV1,
	type ConversationSpeakerV1,
	type ConversationStateV1,
	type ConversationTabV1,
	type SessionDossierV1
} from "@serene-pub/core-catalog/conversation"
