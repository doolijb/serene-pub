-- Catalogue claims (23 §2): zone/role/mode as declared metadata on the
-- version, stored like mode/contributes so admin sorting is a SELECT. Existing
-- versions stay null ("unclassified") until core republishes at next boot —
-- declaring taxonomy changes each document's hash, which is the designed
-- behaviour for a content change.
ALTER TABLE "pipeline_spec_versions" ADD COLUMN "taxonomy" json;
