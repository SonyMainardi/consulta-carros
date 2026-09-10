-- Schema do Consulta de Carros (MySQL 8+)
-- Idempotente: pode rodar quantas vezes quiser.

CREATE TABLE IF NOT EXISTS watches (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug             VARCHAR(64)  NOT NULL UNIQUE,
  name             VARCHAR(160) NOT NULL,
  enabled          TINYINT(1)   NOT NULL DEFAULT 1,
  brand            VARCHAR(64)  NULL,
  model            VARCHAR(96)  NULL,
  version_contains VARCHAR(160) NULL,
  year_min         SMALLINT     NULL,
  year_max         SMALLINT     NULL,
  price_min        DECIMAL(12,2) NULL,
  price_max        DECIMAL(12,2) NULL,
  km_max           INT          NULL,
  uf               VARCHAR(64)  NULL,          -- "SP" ou "SP,MG,PR"
  sources          JSON         NULL,          -- ["mercadolivre","webmotors","olx"]
  params           JSON         NULL,          -- overrides por fonte (query, url, etc)
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listings (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source        VARCHAR(32)  NOT NULL,
  external_id   VARCHAR(160) NOT NULL,
  url           VARCHAR(768) NOT NULL,
  title         VARCHAR(320) NOT NULL,
  brand         VARCHAR(64)  NULL,
  model         VARCHAR(96)  NULL,
  version       VARCHAR(160) NULL,
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
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_source_external (source, external_id),
  KEY idx_fingerprint (fingerprint),
  KEY idx_active_seen (active, last_seen),
  KEY idx_ratio (fipe_ratio),
  KEY idx_model_year (model, year_model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listing_watches (
  listing_id BIGINT UNSIGNED NOT NULL,
  watch_id   INT UNSIGNED    NOT NULL,
  matched_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_id, watch_id),
  CONSTRAINT fk_lw_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_lw_watch   FOREIGN KEY (watch_id)   REFERENCES watches(id)  ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS events (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT UNSIGNED NOT NULL,
  watch_id   INT UNSIGNED    NULL,
  type       ENUM('NEW','PRICE_DROP','PRICE_UP','DISAPPEARED','RELISTED','KM_CHANGED') NOT NULL,
  payload    JSON            NULL,
  notified   TINYINT(1)      NOT NULL DEFAULT 0,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_type_created (type, created_at),
  KEY idx_notified (notified),
  CONSTRAINT fk_ev_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_ev_watch   FOREIGN KEY (watch_id)   REFERENCES watches(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log de execucoes: essencial para diagnosticar bloqueio/anti-bot por fonte.
CREATE TABLE IF NOT EXISTS fetch_runs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source       VARCHAR(32) NOT NULL,
  watch_id     INT UNSIGNED NULL,
  status       ENUM('OK','PARTIAL','FAILED','SKIPPED') NOT NULL,
  items_found  INT NOT NULL DEFAULT 0,
  http_status  INT NULL,
  duration_ms  INT NULL,
  error        TEXT NULL,
  started_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_source_time (source, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
