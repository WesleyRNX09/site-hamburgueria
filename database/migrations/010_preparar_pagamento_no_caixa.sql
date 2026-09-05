-- Prepara o pagamento feito no caixa: guarda quanto o cliente entregou, o
-- troco calculado pelo servidor e a origem da confirmação. As colunas de
-- provedor e referência externa existem para que uma integração futura com
-- gateway de pagamento seja registrada na mesma tabela, sem novo esquema.
-- Nenhum registro é removido; todas as colunas são opcionais e os
-- pagamentos já existentes continuam válidos como 'manual'.

ALTER TABLE pagamentos
  ADD COLUMN valor_recebido_centavos INT UNSIGNED NULL AFTER valor_centavos,
  ADD COLUMN troco_centavos INT UNSIGNED NULL AFTER valor_recebido_centavos,
  ADD COLUMN provedor VARCHAR(40) NOT NULL DEFAULT 'manual' AFTER troco_centavos,
  ADD COLUMN referencia_externa VARCHAR(120) NULL AFTER provedor,
  ADD INDEX idx_pagamentos_referencia_externa (referencia_externa);
