/**
 * Moved to @serene-pub/core-catalog (24 §9, T6): the registry of pipelines
 * core ships — genres, specs, display names, the announcement — is a
 * publishable package now, and SP boot-seeds from it. This shim keeps the
 * app's import paths stable; edit the catalog package.
 */
export * from "@serene-pub/core-catalog"
