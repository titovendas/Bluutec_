CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text, phone text, document text, address text, city text, state text,
  price_table text NOT NULL DEFAULT 'varejo_10',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own customers" ON public.customers FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text, sku text,
  price numeric(12,2) NOT NULL DEFAULT 0,
  cost numeric(12,2) DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own products" ON public.products FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text, phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sellers TO authenticated;
GRANT ALL ON public.sellers TO service_role;
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sellers" ON public.sellers FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  ref text,
  description text NOT NULL,
  barcode text, ncm text, category text, image_url text,
  ipi_percent numeric NOT NULL DEFAULT 0,
  st_percent numeric NOT NULL DEFAULT 0,
  price_atacado numeric, price_varejo_10 numeric, price_varejo_75 numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_products TO authenticated;
GRANT ALL ON public.catalog_products TO service_role;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read catalog" ON public.catalog_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage catalog" ON public.catalog_products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX catalog_products_category_idx ON public.catalog_products (category);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  price_table text NOT NULL DEFAULT 'varejo_10',
  subtotal numeric NOT NULL DEFAULT 0,
  ipi_total numeric NOT NULL DEFAULT 0,
  st_total numeric NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own orders" ON public.orders FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  catalog_product_id uuid REFERENCES public.catalog_products(id),
  code text, description text, image_url text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  ipi_percent numeric NOT NULL DEFAULT 0,
  st_percent numeric NOT NULL DEFAULT 0,
  ipi_value numeric NOT NULL DEFAULT 0,
  st_value numeric NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own order items" ON public.order_items FOR ALL TO authenticated
USING (order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid()))
WITH CHECK (order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid()));

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER sellers_updated_at BEFORE UPDATE ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER catalog_products_updated_at BEFORE UPDATE ON public.catalog_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE VIEW public.order_summary WITH (security_invoker = true) AS
SELECT o.*, c.name AS customer_name, s.name AS seller_name, COALESCE(SUM(oi.total), 0) AS calculated_total
FROM public.orders o
LEFT JOIN public.customers c ON c.id = o.customer_id
LEFT JOIN public.sellers s ON s.id = o.seller_id
LEFT JOIN public.order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name, s.name;
GRANT SELECT ON public.order_summary TO authenticated;
GRANT SELECT ON public.order_summary TO service_role;