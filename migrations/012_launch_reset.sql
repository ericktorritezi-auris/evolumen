-- 0.9.0 · Reset de lançamento. Idempotente.
-- Aceites legais seguem imutáveis. A única exceção é o reset de lançamento, que liga a chave "evl.launch_reset"
-- só dentro da própria transação (SET LOCAL). Fora dela, apagar ou editar continua proibido. TRUNCATE segue sempre bloqueado.
CREATE OR REPLACE FUNCTION evl_block_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'acceptances' AND current_setting('evl.launch_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

-- O registro do reset (launch_) fica 5 anos, como os demais registros financeiros e jurídicos.
CREATE OR REPLACE FUNCTION evl_audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - (CASE WHEN OLD.action ~ '^(order_|refund_|payment_|legal_|checkout_|data_|acceptance_|file_|download_|launch_)' THEN interval '5 years' ELSE interval '30 days' END) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
