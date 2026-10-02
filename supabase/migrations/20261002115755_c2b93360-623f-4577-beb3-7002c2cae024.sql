CREATE TABLE public.payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_terms TO authenticated;
GRANT ALL ON public.payment_terms TO service_role;
ALTER TABLE public.payment_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own payment terms" ON public.payment_terms FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.customers ADD COLUMN neighborhood text, ADD COLUMN zip_code text;
ALTER TABLE public.orders ADD COLUMN payment_term text;

DROP VIEW public.order_summary;
CREATE VIEW public.order_summary WITH (security_invoker = true) AS
SELECT o.*, c.name AS customer_name, s.name AS seller_name, COALESCE(SUM(oi.total), 0) AS calculated_total
FROM public.orders o
LEFT JOIN public.customers c ON c.id = o.customer_id
LEFT JOIN public.sellers s ON s.id = o.seller_id
LEFT JOIN public.order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name, s.name;
GRANT SELECT ON public.order_summary TO authenticated;
GRANT SELECT ON public.order_summary TO service_role;