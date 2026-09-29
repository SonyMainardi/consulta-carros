-- Schema do Consulta de Carros (MySQL 8+)
-- Idempotente: pode rodar quantas vezes quiser.
--
-- ========================================================================
-- O DESENHO, EM UMA FRASE (ESTADO.md 2-X, 2026-09-16)
-- ========================================================================
-- NAO EXISTE "BUSCA SALVA". O usuario escolhe marca, modelo, km, ano, preco e
-- portais e clica BUSCAR; essa escolha vive na URL e no navegador dele, nunca
-- aqui. O banco guarda ANUNCIOS, indexados pelo par (marca, modelo) do
-- catalogo — e um cache do mundo, nao a busca de ninguem. Dois usuarios
-- pedindo Lancer leem o mesmo cache, e por isso a coleta nao se multiplica com
-- o numero de pessoas.
--
-- Consequencia: a coleta NAO filtra por km/preco/ano. Ela grava tudo que o
-- modelo devolve, e o recorte de cada pessoa acontece na LEITURA. So existe
-- uma regra de recorte, entao o painel nao tem como contradizer a coleta.
--
-- Tres tabelas de catalogo (marcas, modelos, enderecos), semeadas da FIPE:
-- ~107 marcas, ~3.200 modelos, ~9.600 enderecos. Finito e pequeno.
--
-- A unica excecao e `favoritos`, la embaixo: a unica tabela que e de ALGUEM, e
-- por isso a unica com dono.

-- ========================================================================
-- CATALOGO
-- ========================================================================

CREATE TABLE IF NOT EXISTS marcas (
  id          SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome        VARCHAR(64)  NOT NULL,           -- nome de exibicao ("Volkswagen")
  slug        VARCHAR(64)  NOT NULL UNIQUE,    -- "volkswagen"
  fipe_codigo VARCHAR(12)  NULL,               -- codigo na API da FIPE
  fipe_nome   VARCHAR(64)  NULL,               -- como a FIPE escreve ("VW - VolksWagen")
  -- Formas pelas quais a marca aparece no titulo de um anuncio: ["VW"].
  -- E o que o motivoDescarte() usa para conferir identidade.
  apelidos    JSON         NULL,
  ativa       TINYINT(1)   NOT NULL DEFAULT 1,
  criada_em   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O MODELO, nao a versao. A FIPE lista versoes ("Lancer GT 2.0 16V 160cv
-- Aut."): 218 so na Mitsubishi. `agruparModelosFipe()` reduz ao nome-base.
--
-- Versao NAO entra aqui: nenhum dos tres portais tem endereco para versao, e
-- foi exatamente isso que fez a busca "Vectra GT" falhar (ESTADO.md 2-T).
-- Versao e filtro de leitura, escolhido pelo usuario na hora da busca.
CREATE TABLE IF NOT EXISTS modelos (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  marca_id     SMALLINT UNSIGNED NOT NULL,
  nome         VARCHAR(96) NOT NULL,           -- "Lancer"
  slug         VARCHAR(96) NOT NULL,           -- "lancer"
  fipe_versoes SMALLINT UNSIGNED NOT NULL DEFAULT 0,  -- quantas versoes a FIPE tem
  ativo        TINYINT(1)  NOT NULL DEFAULT 1, -- 0 esconde do select (lixo do agrupamento)
  -- MONITORAMENTO POR CIMA DO CACHE: modelo marcado aqui e recoletado de
  -- tempos em tempos, e so nele os eventos (novo, baixou preco, sumiu) fazem
  -- sentido — eles exigem coleta repetida. Nao e a busca de ninguem: e o
  -- modelo que esta sendo acompanhado.
  acompanhado  TINYINT(1)  NOT NULL DEFAULT 0,
  acompanhado_desde TIMESTAMP NULL,
  criado_em    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marca_slug (marca_id, slug),
  KEY idx_acompanhado (acompanhado),
  CONSTRAINT fk_modelo_marca FOREIGN KEY (marca_id) REFERENCES marcas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O ENDERECO DE CADA COMBINACAO EM CADA PORTAL.
--
-- Uma linha por (modelo, portal). Nasce da regra padrao (slugify do nome) e se
-- corrige SOZINHA no uso: quando uma coleta real passa no conferirIdentidade(),
-- vira CONFIRMADO; quando a pagina nao e do carro pedido, vira QUEBRADO e
-- aparece para conserto. Ninguem preenche 9.600 linhas a mao.
--
-- E aqui que moram as excecoes que antes estavam em codigo (AJUSTES de
-- src/core/marcas.js): na OLX a Volkswagen e `vw-volkswagen`. Corrigir passa a
-- ser uma linha, e o conserto vale para todos os usuarios.
CREATE TABLE IF NOT EXISTS enderecos (
  modelo_id    INT UNSIGNED NOT NULL,
  portal       VARCHAR(32)  NOT NULL,
  marca_slug   VARCHAR(64)  NOT NULL,
  modelo_slug  VARCHAR(96)  NOT NULL,
  estado       ENUM('PADRAO','CONFIRMADO','QUEBRADO') NOT NULL DEFAULT 'PADRAO',
  conferido_em TIMESTAMP    NULL,
  observacao   VARCHAR(255) NULL,
  PRIMARY KEY (modelo_id, portal),
  KEY idx_estado (portal, estado),
  CONSTRAINT fk_endereco_modelo FOREIGN KEY (modelo_id) REFERENCES modelos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================================
-- CACHE DE ANUNCIOS
-- ========================================================================

CREATE TABLE IF NOT EXISTS listings (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source        VARCHAR(32)  NOT NULL,
  external_id   VARCHAR(160) NOT NULL,
  url           VARCHAR(768) NOT NULL,
  title         VARCHAR(320) NOT NULL,
  brand         VARCHAR(64)  NULL,             -- como o ANUNCIO escreve
  model         VARCHAR(96)  NULL,
  version       VARCHAR(160) NULL,
  -- Titulo + versao normalizados (sem acento, minusculas, entre espacos), para
  -- o filtro de versao virar SQL: `texto_busca LIKE '% gt %'` por palavra
  -- inteira. Sem isto, "Gol" casaria com "Golf" (ESTADO.md 2-S, regra 3).
  texto_busca   VARCHAR(480) NULL,
  year_fab      SMALLINT     NULL,
  year_model    SMALLINT     NULL,
  km            INT          NULL,
  price         DECIMAL(12,2) NULL,
  color         VARCHAR(48)  NULL,
  fuel          VARCHAR(32)  NULL,
  transmission  VARCHAR(32)  NULL,
  city          VARCHAR(96)  NULL,
  uf            CHAR(2)      NULL,
  seller_type   ENUM('PF','PJ','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  seller_name   VARCHAR(160) NULL,
  photos        JSON         NULL,
  fipe_code     VARCHAR(24)  NULL,
  fipe_price    DECIMAL(12,2) NULL,
  fipe_ratio    DECIMAL(6,3) NULL,             -- price / fipe_price (0.88 = 12% abaixo da FIPE)
  fingerprint   CHAR(64)     NULL,             -- dedupe entre plataformas
  raw           JSON         NULL,             -- payload original, para debug do adapter
  first_seen    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active        TINYINT(1)   NOT NULL DEFAULT 1,  -- derivado: ativo em algum modelo
  UNIQUE KEY uq_source_external (source, external_id),
  KEY idx_fingerprint (fingerprint),
  KEY idx_active_seen (active, last_seen),
  KEY idx_ratio (fipe_ratio),
  KEY idx_preco (price),
  KEY idx_km (km),
  KEY idx_ano (year_model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O vinculo anuncio <-> modelo do catalogo. E o cache: "este anuncio apareceu
-- na busca deste modelo".
--
-- `motivo_inativo` separa o que e noticia do que nao e:
--   SUMIU          a coleta viu a busca INTEIRA e o anuncio nao estava — gera
--                  "saiu do ar";
--   FORA_DA_JANELA a coleta viu so parte (1a pagina da OLX/ML, teto de paginas
--                  do Webmotors) — nao da para dizer que saiu.
-- So SUMIU gera evento. FORA_DO_RECORTE deixou de existir em 2026-09-16: o
-- recorte e de quem le, nao do banco.
CREATE TABLE IF NOT EXISTS listing_modelos (
  listing_id     BIGINT UNSIGNED NOT NULL,
  modelo_id      INT UNSIGNED    NOT NULL,
  primeiro_visto TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_visto   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ativo          TINYINT(1)      NOT NULL DEFAULT 1,
  motivo_inativo ENUM('SUMIU','FORA_DA_JANELA') NULL,
  inativo_desde  TIMESTAMP       NULL,
  PRIMARY KEY (listing_id, modelo_id),
  KEY idx_lm_modelo_ativo (modelo_id, ativo),
  CONSTRAINT fk_lm_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_lm_modelo  FOREIGN KEY (modelo_id)  REFERENCES modelos(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_history (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  listing_id  BIGINT UNSIGNED NOT NULL,
  price       DECIMAL(12,2)   NOT NULL,
  km          INT             NULL,
  captured_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_listing_time (listing_id, captured_at),
  CONSTRAINT fk_ph_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eventos sao fato do ANUNCIO ("baixou preco"), nao de uma pessoa. Cada
-- usuario ve os eventos do modelo que pediu, passados pelo recorte dele na
-- leitura. So fazem sentido em modelo `acompanhado`: sem coleta repetida nao
-- ha o que comparar.
CREATE TABLE IF NOT EXISTS events (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT UNSIGNED NOT NULL,
  modelo_id  INT UNSIGNED    NULL,
  type       ENUM('NEW','PRICE_DROP','PRICE_UP','DISAPPEARED','RELISTED','KM_CHANGED') NOT NULL,
  payload    JSON            NULL,
  notified   TINYINT(1)      NOT NULL DEFAULT 0,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_type_created (type, created_at),
  KEY idx_modelo_created (modelo_id, created_at),
  KEY idx_notified (notified),
  CONSTRAINT fk_ev_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_ev_modelo  FOREIGN KEY (modelo_id)  REFERENCES modelos(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================================
-- FAVORITOS — a unica tabela que e DE ALGUEM (ESTADO.md 2-AA, 2026-09-28)
-- ========================================================================
-- Tudo acima e cache do mundo, compartilhado. Isto e escolha pessoal: os
-- anuncios que a pessoa guardou para acompanhar. Tres decisoes:
--
--   * `dono` em toda linha. Hoje e sempre 'local' (quem usa este computador) e
--     vem de UMA funcao no server.js, `donoDe()`. Quando houver login, e so ela
--     que muda — as consultas ja filtram por dono.
--   * O anuncio e apontado pela chave NATURAL (source, external_id), sem FK
--     para `listings`: o cache pode ser apagado e recriado (ja foi, em 2-Y) sem
--     levar os favoritos junto. Quando o anuncio volta ao cache, o favorito
--     volta a mostrar preco e situacao atuais sozinho.
--   * Guarda uma FOTO do anuncio no momento em que foi favoritado. E o que
--     permite dizer "baixou R$ 3.000 desde que voce guardou" e mostrar o
--     anuncio mesmo quando ele nao esta mais no cache.
CREATE TABLE IF NOT EXISTS favoritos (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dono        VARCHAR(64)  NOT NULL,
  source      VARCHAR(32)  NOT NULL,
  external_id VARCHAR(160) NOT NULL,
  -- O carro do catalogo em que a pessoa achou o anuncio: da nome ao favorito
  -- ("Mitsubishi Lancer") e leva de volta a busca daquele carro.
  modelo_id   INT UNSIGNED NULL,
  -- A foto: mesmos nomes de `listings`, com os valores DO DIA em que favoritou.
  url         VARCHAR(768) NOT NULL,
  title       VARCHAR(320) NOT NULL,
  price       DECIMAL(12,2) NULL,
  km          INT          NULL,
  year_model  SMALLINT     NULL,
  city        VARCHAR(96)  NULL,
  uf          CHAR(2)      NULL,
  criado_em   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fav_dono_anuncio (dono, source, external_id),
  KEY idx_fav_dono_criado (dono, criado_em),
  CONSTRAINT fk_fav_modelo FOREIGN KEY (modelo_id) REFERENCES modelos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log de execucoes: essencial para diagnosticar bloqueio/anti-bot por fonte, e
-- e tambem o RELOGIO DO CACHE — a ultima rodada OK de um (modelo, portal) diz
-- se a resposta pode sair do banco ou se precisa coletar de novo.
-- O nome nao mudou de proposito: CLAUDE.md e ESTADO.md mandam "conferir
-- fetch_runs" em varios lugares.
CREATE TABLE IF NOT EXISTS fetch_runs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source       VARCHAR(32) NOT NULL,
  modelo_id    INT UNSIGNED NULL,
  status       ENUM('OK','PARTIAL','FAILED','SKIPPED') NOT NULL,
  items_found  INT NOT NULL DEFAULT 0,
  -- Quantos anuncios o PORTAL diz que a busca tem, quantas paginas foram lidas
  -- e se isso cobriu a busca inteira. E o que decide se um anuncio ausente
  -- "saiu do ar" (COMPLETA) ou so ficou fora da janela lida (PARCIAL).
  total_busca  INT NULL,
  paginas      INT NULL,
  cobertura    ENUM('COMPLETA','PARCIAL') NULL,
  http_status  INT NULL,
  duration_ms  INT NULL,
  error        TEXT NULL,
  started_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_source_time (source, started_at),
  KEY idx_modelo_time (modelo_id, source, started_at),
  CONSTRAINT fk_fr_modelo FOREIGN KEY (modelo_id) REFERENCES modelos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
