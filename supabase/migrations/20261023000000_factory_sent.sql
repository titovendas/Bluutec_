-- Controle de envio do pedido à fábrica (marcação manual na tela do pedido).
-- Pode rodar mais de uma vez sem erro. Rodar ANTES de subir o código novo.
alter table public.orders add column if not exists factory_sent_at timestamptz;
