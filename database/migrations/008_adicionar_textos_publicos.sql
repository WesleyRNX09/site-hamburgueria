-- Adiciona os textos editáveis do banner, do cardápio e da seção "sobre" à
-- configuração por estabelecimento. Não remove nem substitui colunas
-- existentes; todos os campos são opcionais e o site público já trata
-- ausência/NULL com os textos atuais como fallback.

ALTER TABLE configuracoes_estabelecimento
  ADD COLUMN banner_titulo VARCHAR(160) AFTER banner_url,
  ADD COLUMN banner_subtitulo VARCHAR(280) AFTER banner_titulo,
  ADD COLUMN banner_botao_texto VARCHAR(60) AFTER banner_subtitulo,
  ADD COLUMN banner_botao_destino VARCHAR(20) AFTER banner_botao_texto,
  ADD COLUMN titulo_cardapio VARCHAR(160) AFTER banner_botao_destino,
  ADD COLUMN texto_apresentacao VARCHAR(280) AFTER titulo_cardapio,
  ADD COLUMN titulo_sobre VARCHAR(160) AFTER texto_apresentacao,
  ADD COLUMN texto_sobre VARCHAR(600) AFTER titulo_sobre,
  ADD COLUMN mensagem_rodape VARCHAR(280) AFTER texto_sobre,
  ADD CONSTRAINT chk_config_banner_botao_destino
    CHECK (banner_botao_destino IS NULL
      OR banner_botao_destino IN ('cardapio', 'promocoes', 'sobre'));
