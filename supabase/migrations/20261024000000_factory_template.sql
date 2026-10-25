-- Modelo da planilha de pedido da fábrica (guardado no sistema).
-- Pode rodar mais de uma vez sem erro. Rodar ANTES de subir o código novo.
create table if not exists public.factory_templates (
  id             uuid primary key default gen_random_uuid(),
  file_name      text not null,
  content_base64 text not null,
  size_bytes     integer not null default 0,
  uploaded_at    timestamptz not null default now()
);

grant select, insert, update, delete on public.factory_templates to authenticated;
grant all on public.factory_templates to service_role;

alter table public.factory_templates enable row level security;

drop policy if exists "Authenticated can manage factory templates" on public.factory_templates;
create policy "Authenticated can manage factory templates"
  on public.factory_templates for all to authenticated
  using (true) with check (true);
