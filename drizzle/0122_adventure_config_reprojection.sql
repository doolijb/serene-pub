-- The Adventure pipelines' shipped configuration, re-projected.
--
-- ## What was wrong
--
-- `pipeline_config_values` is where an author preset's choices actually reach a
-- run, and the shipped default config is written ONCE: `ensureDefaultConfig`
-- returns early the moment a row with its `seedKey` exists, and `reconcileConfigs`
-- back-fills a missing address from the DECLARATION's default rather than from
-- the preset. A `path` parameter has no declared default, so a preset value added
-- after the config row was created can never land.
--
-- That is not hypothetical, and a live receipt is what said so. The adventure
-- respond preset ships `planWrite → path: speakers` and
-- `keeperWrite → path: values,possessions`; the run resolved `params: {}` for
-- both. So the voices map iterated the WHOLE plan document as one speaker, and
-- the state keeper's whole document arrived at `resolve-state-changes` as one
-- change with no slot on it — which is the sentence that reached the receipt:
-- "there is no '' to set here." Nothing was ever proposed.
--
-- ## What this does
--
-- Deletes the three shipped default configs so the next boot writes them again
-- from the presets the code currently ships. `ensureDefaultConfig` runs on every
-- boot (`reconcilePublishedConfigs`), so the row is back before anything reads
-- it, carrying the two `path` selections, the reply separator, the trusted
-- branch's `apply`, and the actions' own `write → path`.
--
-- ⚠ Safe because these rows are IMMUTABLE by construction: `is_immutable` is
-- what "core ships this one, copy it to tune it" means, and an administrator's
-- own tuning lives in a separate `pipeline_configs` row that this does not
-- touch. A scope that had SELECTED the shipped default has its
-- `pipeline_config_selections.config_id` set to NULL by the foreign key, which
-- is defined to mean "fall back to the shipped default" — the row this file
-- causes to be rewritten.
--
-- ⚠ **Not a spec or type re-projection.** Content addressing (ruled 2026-09-10)
-- carries an edited document and an edited declaration to every install on the
-- next boot, so the version-row and registry-row deletes that migrations 0095 to
-- 0115 each needed are gone. This is the one thing the pointer move does not
-- carry: a config row that was written before the preset said anything.
DELETE FROM "pipeline_configs"
WHERE "is_immutable" = true
AND "seed_key" IN (
	'pipeline-default:core:spec/adventure-respond',
	'pipeline-default:core:spec/adventure-rest',
	'pipeline-default:core:spec/adventure-advance-time'
);
