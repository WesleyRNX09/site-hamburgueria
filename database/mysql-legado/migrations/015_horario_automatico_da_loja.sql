-- Faz a loja abrir e fechar sozinha pelo horário cadastrado.
--
-- Até aqui `loja_aberta` era uma chave manual: alguém precisava lembrar de
-- marcar "aberta" às 19h e "fechada" à meia-noite, e o texto livre de
-- `horario_funcionamento` servia só para leitura do cliente.
--
-- `horarios_json` guarda a grade da semana como uma lista de objetos
-- `{ "dia": 0-6, "aberto": true|false, "abre": "HH:MM", "fecha": "HH:MM" }`,
-- onde 0 é domingo. Um fechamento menor que a abertura significa que o
-- expediente atravessa a meia-noite (18:00 às 00:30).
--
-- `funcionamento_automatico` diz qual das duas fontes vale: quando é 1, o
-- servidor decide pelo relógio; quando é 0, continua valendo `loja_aberta`.
-- O padrão é 0, então nenhum estabelecimento já existente muda de
-- comportamento enquanto o administrador não cadastrar a grade.

ALTER TABLE configuracoes_estabelecimento
  ADD COLUMN horarios_json TEXT NULL AFTER horario_funcionamento,
  ADD COLUMN funcionamento_automatico TINYINT(1) NOT NULL DEFAULT 0 AFTER horarios_json;
