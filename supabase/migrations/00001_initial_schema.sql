-- ============================================
-- 国内外库存看板系统 — 数据库初始化脚本
-- 可直接在 Supabase SQL Editor 中执行
-- ============================================

-- ============================================
-- 1. 基础设置
-- ============================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================
-- 2. 通用触发器函数
-- ============================================

-- 自动更新 updated_at 字段
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================
-- 3. 建表
-- ============================================

-- 3.1 role
CREATE TABLE role (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT role_name_unique UNIQUE (name),
  CONSTRAINT role_name_check  CHECK (name IN ('admin', 'operator'))
);

-- 3.2 profiles
CREATE TABLE profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text        NOT NULL,
  role_id      uuid        NOT NULL REFERENCES role(id),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role_id ON profiles(role_id);
CREATE INDEX idx_profiles_is_active ON profiles(is_active);

-- 3.3 product
CREATE TABLE product (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL,
  name         text        NOT NULL,
  safety_stock integer     NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  category     text,
  unit         text        NOT NULL DEFAULT '件',
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_code_unique UNIQUE (code)
);

CREATE INDEX idx_product_name      ON product(name);
CREATE INDEX idx_product_is_active ON product(is_active);

-- 3.4 product_variant
CREATE TABLE product_variant (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid        REFERENCES product(id) ON DELETE SET NULL,
  sku          text        NOT NULL,
  country      text        NOT NULL,
  name         text        NOT NULL,
  match_status text        NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched', 'unmatched', 'pending')),
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT variant_sku_country_unique UNIQUE (sku, country),
  CONSTRAINT variant_country_check      CHECK (country IN ('TH', 'ID', 'MY', 'PH', 'VN', 'CN'))
);

CREATE INDEX idx_variant_product_id   ON product_variant(product_id);
CREATE INDEX idx_variant_match_status ON product_variant(match_status);
CREATE INDEX idx_variant_country      ON product_variant(country);
CREATE INDEX idx_variant_product_id_null ON product_variant(product_id) WHERE product_id IS NULL;

-- 3.5 warehouse
CREATE TABLE warehouse (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  country      text        NOT NULL,
  type         text        NOT NULL CHECK (type IN ('domestic', 'overseas')),
  is_active    boolean     NOT NULL DEFAULT true,
  sync_url     text,
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT warehouse_name_country_unique UNIQUE (name, country)
);

CREATE INDEX idx_warehouse_type    ON warehouse(type);
CREATE INDEX idx_warehouse_country ON warehouse(country);

-- 3.6 inventory
CREATE TABLE inventory (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id   uuid        NOT NULL REFERENCES product_variant(id) ON DELETE CASCADE,
  warehouse_id uuid        NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  quantity     integer     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_variant_warehouse_unique UNIQUE (variant_id, warehouse_id)
);

CREATE INDEX idx_inventory_warehouse_id ON inventory(warehouse_id);
CREATE INDEX idx_inventory_quantity     ON inventory(quantity) WHERE quantity = 0;
CREATE INDEX idx_inventory_low_stock    ON inventory(quantity) WHERE quantity <= 500;

-- 3.7 shipment
CREATE TABLE shipment (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_name       text,
  voyage_number     text,
  origin_port       text,
  destination_port  text,
  country           text        NOT NULL CHECK (country IN ('TH', 'ID', 'MY', 'PH', 'VN', 'CN')),
  warehouse_id      uuid        REFERENCES warehouse(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'booking' CHECK (status IN ('booking', 'loading', 'departed', 'arrived', 'customs', 'warehoused')),
  estimated_arrival date,
  created_by        uuid        NOT NULL REFERENCES profiles(id),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipment_status            ON shipment(status);
CREATE INDEX idx_shipment_country           ON shipment(country);
CREATE INDEX idx_shipment_warehouse_id      ON shipment(warehouse_id);
CREATE INDEX idx_shipment_estimated_arrival ON shipment(estimated_arrival);

-- 3.8 shipment_item
CREATE TABLE shipment_item (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id          uuid        NOT NULL REFERENCES shipment(id) ON DELETE CASCADE,
  variant_id           uuid        NOT NULL REFERENCES product_variant(id) ON DELETE RESTRICT,
  quantity             integer     NOT NULL CHECK (quantity >= 1),
  warehoused_quantity  integer     NOT NULL DEFAULT 0 CHECK (warehoused_quantity >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shipment_item_warehoused_check CHECK (warehoused_quantity <= quantity)
);

CREATE INDEX idx_shipment_item_shipment_id ON shipment_item(shipment_id);
CREATE INDEX idx_shipment_item_variant_id  ON shipment_item(variant_id);

-- 3.9 tracking_event
CREATE TABLE tracking_event (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id  uuid        NOT NULL REFERENCES shipment(id) ON DELETE CASCADE,
  status       text        NOT NULL CHECK (status IN ('booking', 'loading', 'departed', 'arrived', 'customs', 'warehoused')),
  description  text,
  occurred_at  timestamptz NOT NULL,
  created_by   uuid        NOT NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracking_event_shipment_id ON tracking_event(shipment_id);
CREATE INDEX idx_tracking_event_status      ON tracking_event(status);

-- 3.10 sync_log
CREATE TABLE sync_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id         uuid        NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  status               text        NOT NULL CHECK (status IN ('success', 'failed')),
  new_variants_count   integer     NOT NULL DEFAULT 0 CHECK (new_variants_count >= 0),
  error_message        text,
  started_at           timestamptz NOT NULL,
  finished_at          timestamptz NOT NULL,

  CONSTRAINT sync_log_time_check CHECK (finished_at >= started_at)
);

CREATE INDEX idx_sync_log_warehouse_id ON sync_log(warehouse_id);
CREATE INDEX idx_sync_log_status       ON sync_log(status);
CREATE INDEX idx_sync_log_started_at   ON sync_log(started_at);


-- ============================================
-- 4. updated_at 触发器绑定
-- ============================================

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_product_updated_at
  BEFORE UPDATE ON product
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_product_variant_updated_at
  BEFORE UPDATE ON product_variant
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_shipment_updated_at
  BEFORE UPDATE ON shipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- 5. get_user_role() 函数
-- ============================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.name
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = auth.uid()
    AND p.is_active = true;
$$;


-- ============================================
-- 6. 新用户注册自动创建 profile
-- ============================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  operator_role_id uuid;
BEGIN
  SELECT id INTO operator_role_id
  FROM public.role
  WHERE name = 'operator';

  INSERT INTO public.profiles (id, display_name, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    operator_role_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================
-- 7. RLS 策略
-- ============================================

-- 7.1 role 表
ALTER TABLE role ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_role" ON role
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_role" ON role
  FOR SELECT
  USING (get_user_role() = 'operator');


-- 7.2 profiles 表
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_profiles" ON profiles
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_profiles" ON profiles
  FOR SELECT
  USING (get_user_role() = 'operator');

CREATE POLICY "operator_update_own_profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id AND get_user_role() = 'operator')
  WITH CHECK (auth.uid() = id AND get_user_role() = 'operator');

-- 用户需要能读取自己的 profile（用于 get_user_role() 函数）
CREATE POLICY "user_read_own_profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);


-- 7.3 product 表
ALTER TABLE product ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_product" ON product
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_product" ON product
  FOR SELECT
  USING (get_user_role() = 'operator');


-- 7.4 product_variant 表
ALTER TABLE product_variant ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_variant" ON product_variant
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_variant" ON product_variant
  FOR SELECT
  USING (get_user_role() = 'operator');

CREATE POLICY "operator_update_variant_match" ON product_variant
  FOR UPDATE
  USING (get_user_role() = 'operator')
  WITH CHECK (get_user_role() = 'operator');


-- 7.5 warehouse 表
ALTER TABLE warehouse ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_warehouse" ON warehouse
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_warehouse" ON warehouse
  FOR SELECT
  USING (get_user_role() = 'operator');


-- 7.6 inventory 表
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_inventory" ON inventory
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_inventory" ON inventory
  FOR SELECT
  USING (get_user_role() = 'operator');

CREATE POLICY "operator_update_inventory_quantity" ON inventory
  FOR UPDATE
  USING (get_user_role() = 'operator')
  WITH CHECK (get_user_role() = 'operator');

-- inventory 记录由同步脚本创建，operator 不 INSERT
-- 但同步脚本使用 service_role 绕过 RLS，所以不需要 operator INSERT 策略


-- 7.7 shipment 表
ALTER TABLE shipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_shipment" ON shipment
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_shipment" ON shipment
  FOR SELECT
  USING (get_user_role() = 'operator');

CREATE POLICY "operator_insert_shipment" ON shipment
  FOR INSERT
  WITH CHECK (get_user_role() = 'operator');

CREATE POLICY "operator_update_shipment" ON shipment
  FOR UPDATE
  USING (get_user_role() = 'operator')
  WITH CHECK (get_user_role() = 'operator');


-- 7.8 shipment_item 表
ALTER TABLE shipment_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_shipment_item" ON shipment_item
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_shipment_item" ON shipment_item
  FOR SELECT
  USING (get_user_role() = 'operator');

CREATE POLICY "operator_insert_shipment_item" ON shipment_item
  FOR INSERT
  WITH CHECK (get_user_role() = 'operator');


-- 7.9 tracking_event 表
ALTER TABLE tracking_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_tracking_event" ON tracking_event
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_tracking_event" ON tracking_event
  FOR SELECT
  USING (get_user_role() = 'operator');

CREATE POLICY "operator_insert_tracking_event" ON tracking_event
  FOR INSERT
  WITH CHECK (get_user_role() = 'operator');


-- 7.10 sync_log 表
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_sync_log" ON sync_log
  FOR ALL
  USING (get_user_role() = 'admin');

CREATE POLICY "operator_select_sync_log" ON sync_log
  FOR SELECT
  USING (get_user_role() = 'operator');


-- ============================================
-- 8. 初始数据（seed）
-- ============================================

-- 8.1 role
INSERT INTO role (name, description) VALUES
  ('admin',    '管理员：完整读写权限'),
  ('operator', '运营：查看所有数据，写入库存记录和物流节点');

-- 8.2 warehouse（6 个仓库）
INSERT INTO warehouse (name, country, type) VALUES
  ('中国仓',   'CN', 'domestic'),
  ('泰国仓',   'TH', 'overseas'),
  ('印尼仓',   'ID', 'overseas'),
  ('马来西亚仓', 'MY', 'overseas'),
  ('菲律宾仓',   'PH', 'overseas'),
  ('越南仓',   'VN', 'overseas');


-- ============================================
-- 9. 说明
-- ============================================

-- 9.1 创建管理员
-- 首次使用：在 Supabase Dashboard → Authentication → Users 中创建一个用户
-- 然后在 SQL Editor 中执行：
--
--   UPDATE profiles
--   SET role_id = (SELECT id FROM role WHERE name = 'admin')
--   WHERE id = '<用户 UUID>';
--
-- 此后该用户即可在系统内管理其他用户角色。

-- 9.2 同步脚本
-- 页面抓取同步脚本使用 Supabase service_role key 绕过 RLS 写 inventory 和 product_variant 表。
