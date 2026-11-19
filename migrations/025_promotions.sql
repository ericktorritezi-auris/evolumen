-- 2.5.0: promoções gerais do site (campanhas). Cupons e a promoção por produto continuam como estão.
CREATE TABLE IF NOT EXISTS promotions (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT        NOT NULL,
  kind         TEXT        NOT NULL CHECK (kind IN ('percent','fixed')),
  percent      INT         CHECK (percent BETWEEN 1 AND 99),
  amount_cents INT         CHECK (amount_cents > 0),
  tag_text     TEXT,
  banner_text  TEXT,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  all_products BOOLEAN     NOT NULL DEFAULT true,
  theme        TEXT        NOT NULL DEFAULT 'none' CHECK (theme IN ('none','blackfriday')),
  status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS promotion_courses (
  promotion_id BIGINT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  course_id    BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, course_id)
);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_price_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_price_source_check CHECK (price_source IN ('full','promo','coupon','renewal','campaign'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS campaign_id BIGINT REFERENCES promotions(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS campaign_name TEXT;
CREATE INDEX IF NOT EXISTS orders_campaign_idx ON orders (campaign_id) WHERE campaign_id IS NOT NULL;
