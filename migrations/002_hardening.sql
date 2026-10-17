-- Fase 1 · Endurecimento (revisão independente): aceite sem duplicata e registros imutáveis também contra TRUNCATE.
CREATE UNIQUE INDEX IF NOT EXISTS acceptances_user_doc_uq ON acceptances (user_id, legal_document_id);

DROP TRIGGER IF EXISTS acceptances_no_truncate ON acceptances;
CREATE TRIGGER acceptances_no_truncate BEFORE TRUNCATE ON acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION evl_block_change();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION evl_block_change();
