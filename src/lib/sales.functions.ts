import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const orderStatusSchema = z.enum(["orcamento", "pedido"]);

export const priceTableSchema = z.enum(["varejo", "especialista", "atacado"]);

// Optional UUID that also accepts an empty string (sent by forms when
// creating a new record) and normalizes it to undefined.
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
    message: "Invalid uuid",
  });

// Lista usada apenas como sugestão inicial (tela de Configurações) e como
// reserva quando ainda não há nada cadastrado nem em cache offline.
export const DEFAULT_PAYMENT_TERMS = [
  "À vista",
  "30 dias",
  "30/60 dias",
  "30/60/90 dias",
  "45 dias",
  "60 dias",
] as const;

const paymentTermSchema = z.object({
  id: optionalId,
  label: z.string().min(1),
  active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});

export const listPaymentTerms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("payment_terms")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Importa uma lista de prazos de pagamento de uma vez (usado pela tela de
 * Configurações após o usuário escolher a coluna da planilha). Prazos com
 * o mesmo nome já existentes são apenas atualizados, não duplicados.
 */
export const importPaymentTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ labels: z.array(z.string().min(1)) }).parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const uniqueLabels = Array.from(
      new Set(data.labels.map((l) => l.trim()).filter(Boolean))
    );
    if (uniqueLabels.length === 0) {
      throw new Error("Nenhum prazo de pagamento válido encontrado na coluna selecionada.");
    }
    const rows = uniqueLabels.map((label, index) => ({
      user_id: userId,
      label,
      active: true,
      sort_order: index,
    }));
    const { error } = await supabase
      .from("payment_terms")
      .upsert(rows, { onConflict: "user_id,label" });
    if (error) throw new Error(error.message);
    return { imported: rows.length };
  });

export const deletePaymentTerm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("payment_terms")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

/** Remove todos os prazos de pagamento do usuário (usado antes de uma
 * reimportação, quando o usuário escolhe "substituir tudo"). */
export const clearPaymentTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("payment_terms")
      .delete()
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

const customerSchema = z.object({
  id: optionalId,
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  document: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  neighborhood: z.string().optional().or(z.literal("")),
  zip_code: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  // Construtora: ST não é destacado no pedido, segundo a legislação atual.
  customer_type: z.enum(["varejo", "construtora"]).default("varejo"),
});

const productSchema = z.object({
  id: optionalId,
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  sku: z.string().optional().or(z.literal("")),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0).default(0),
  stock: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

const sellerSchema = z.object({
  id: optionalId,
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  active: z.boolean().default(true),
});

const orderItemSchema = z.object({
  catalog_product_id: z.string().uuid(),
  code: z.string(),
  description: z.string(),
  image_url: z.string().nullable().optional(),
  quantity: z.coerce.number().int().min(1),
  table_price: z.coerce.number().min(0).default(0),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  unit_price: z.coerce.number().min(0),
  ipi_percent: z.coerce.number().min(0).default(0),
  st_percent: z.coerce.number().min(0).default(0),
});

const orderSchema = z.object({
  id: optionalId,
  customer_id: z.string().uuid(),
  seller_id: optionalId,
  status: orderStatusSchema.default("orcamento"),
  price_table: priceTableSchema.default("varejo"),
  payment_term: z.string().optional().or(z.literal("")),
  cash_discount_percent: z.coerce.number().min(0).max(100).default(0),
  pickup_discount_percent: z.coerce.number().min(0).max(100).default(0),
  items: z.array(orderItemSchema).min(1),
});

// Dashboard stats
export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { count: customersCount } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: productsCount } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: sellersCount } = await supabase
      .from("sellers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: ordersCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { data: recentOrders } = await supabase
      .from("order_summary")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);

    return {
      customersCount: customersCount ?? 0,
      productsCount: productsCount ?? 0,
      sellersCount: sellersCount ?? 0,
      ordersCount: ordersCount ?? 0,
      recentOrders: recentOrders ?? [],
    };
  });

// Customers
export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => customerSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      document: data.document || null,
      address: data.address || null,
      neighborhood: data.neighborhood || null,
      zip_code: data.zip_code || null,
      city: data.city || null,
      state: data.state || null,
      customer_type: data.customer_type,
    };

    if (data.id) {
      const { data: result, error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    }

    const { data: result, error } = await supabase
      .from("customers")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

async function fetchFromBrasilApi(digits: string) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    headers: {
      "User-Agent": "ForcaDeVendas/1.0 (+https://friendly-sales-win.lovable.app)",
      Accept: "application/json",
    },
  });
  if (res.status === 404) {
    throw new Error("NOT_FOUND");
  }
  if (!res.ok) {
    throw new Error(`BRASILAPI_HTTP_${res.status}`);
  }
  const info: any = await res.json();
  const street = [
    info.descricao_tipo_de_logradouro,
    info.logradouro,
    info.numero,
    info.complemento,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const phone = info.ddd_telefone_1 || info.telefone1 || "";
  return {
    document: digits,
    name: info.razao_social || info.nome_fantasia || "",
    email: info.email || "",
    phone,
    address: street,
    neighborhood: info.bairro || "",
    zip_code: info.cep || "",
    city: info.municipio || "",
    state: info.uf || "",
  };
}

async function fetchFromReceitaWs(digits: string) {
  const res = await fetch(`https://www.receitaws.com.br/v1/cnpj/${digits}`, {
    headers: {
      "User-Agent": "ForcaDeVendas/1.0 (+https://friendly-sales-win.lovable.app)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`RECEITAWS_HTTP_${res.status}`);
  }
  const info: any = await res.json();
  if (info.status === "ERROR") {
    throw new Error("NOT_FOUND");
  }
  const street = [info.logradouro, info.numero, info.complemento]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    document: digits,
    name: info.nome || info.fantasia || "",
    email: info.email || "",
    phone: info.telefone || "",
    address: street,
    neighborhood: info.bairro || "",
    zip_code: info.cep || "",
    city: info.municipio || "",
    state: info.uf || "",
  };
}

export const lookupCnpj = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ cnpj: z.string().min(1) }).parse(data)
  )
  .handler(async ({ data }) => {
    const digits = data.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) {
      throw new Error("CNPJ inválido. Digite os 14 números.");
    }

    let lastError: unknown = null;
    for (const fetcher of [fetchFromBrasilApi, fetchFromReceitaWs]) {
      try {
        return await fetcher(digits);
      } catch (err: any) {
        lastError = err;
        if (err?.message === "NOT_FOUND") {
          throw new Error("CNPJ não encontrado.");
        }
        // try next provider
      }
    }

    console.error("[lookupCnpj] all providers failed", lastError);
    throw new Error(
      "Não foi possível consultar o CNPJ agora. Você pode preencher os dados manualmente."
    );
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// Products
export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => productSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      name: data.name,
      description: data.description || null,
      sku: data.sku || null,
      price: data.price,
      cost: data.cost,
      stock: data.stock,
      active: data.active,
    };

    if (data.id) {
      const { data: result, error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    }

    const { data: result, error } = await supabase
      .from("products")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// Sellers
export const listSellers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("sellers")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => sellerSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      active: data.active,
    };

    if (data.id) {
      const { data: result, error } = await supabase
        .from("sellers")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    }

    const { data: result, error } = await supabase
      .from("sellers")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

export const deleteSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("sellers")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// Orders
export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("order_summary")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: order, error } = await supabase
      .from("orders")
      .select(
        "*, customer:customers(id, name, document, phone, email, address, neighborhood, zip_code, city, state, price_table, customer_type), seller:sellers(id, name, phone, email)"
      )
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (error) throw new Error(error.message);

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", data.id)
      .order("code");
    if (itemsError) throw new Error(itemsError.message);

    return {
      order: {
        ...order,
        customer_name: order.customer?.name ?? null,
        seller_name: order.seller?.name ?? null,
      },
      items: items ?? [],
    };
  });

export const upsertOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => orderSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const computed = data.items.map((item) => {
      const base = item.quantity * item.unit_price;
      const ipi_value = (base * item.ipi_percent) / 100;
      const st_value = (base * item.st_percent) / 100;
      return { item, base, ipi_value, st_value };
    });

    const subtotal = computed.reduce((s, c) => s + c.base, 0);
    const ipi_total = computed.reduce((s, c) => s + c.ipi_value, 0);
    const st_total = computed.reduce((s, c) => s + c.st_value, 0);
    const total = subtotal + ipi_total + st_total;

    // Se nenhum vendedor foi informado, usa automaticamente o vendedor
    // cadastrado para este usuário (o representante logado no sistema).
    let sellerId = data.seller_id ?? null;
    if (!sellerId) {
      const { data: defaultSeller } = await supabase
        .from("sellers")
        .select("id")
        .eq("user_id", userId)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      sellerId = defaultSeller?.id ?? null;
    }

    const orderPayload = {
      user_id: userId,
      customer_id: data.customer_id,
      seller_id: sellerId,
      status: data.status,
      price_table: data.price_table,
      payment_term: data.payment_term || null,
      cash_discount_percent: data.cash_discount_percent,
      pickup_discount_percent: data.pickup_discount_percent,
      subtotal,
      ipi_total,
      st_total,
      total,
    };

    let orderId = data.id;

    if (orderId) {
      const { error } = await supabase
        .from("orders")
        .update(orderPayload)
        .eq("id", orderId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);

      await supabase.from("order_items").delete().eq("order_id", orderId);
    } else {
      const { data: inserted, error } = await supabase
        .from("orders")
        .insert(orderPayload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      orderId = inserted.id;
    }

    const itemsPayload = computed.map(({ item, base, ipi_value, st_value }) => ({
      order_id: orderId!,
      catalog_product_id: item.catalog_product_id,
      code: item.code,
      description: item.description,
      image_url: item.image_url ?? null,
      quantity: item.quantity,
      table_price: item.table_price,
      discount_percent: item.discount_percent,
      unit_price: item.unit_price,
      ipi_percent: item.ipi_percent,
      st_percent: item.st_percent,
      ipi_value,
      st_value,
      total: base + ipi_value + st_value,
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(itemsPayload);
    if (itemsError) throw new Error(itemsError.message);

    return { id: orderId };
  });

// Tabela de preços
//
// A importação é genérica: o navegador lê a planilha e pergunta ao
// usuário em qual coluna está cada informação (código, descrição,
// família, embalagem, preço unitário) — não depende de nomes fixos de
// aba ou cabeçalho. Impostos (ST) não entram mais por aqui; ficam para
// uma ferramenta separada.
const priceTableProductRowSchema = z.object({
  code: z.string().min(1),
  description: z.string().optional().default(""),
  family: z.string().optional().or(z.literal("")),
  color: z.string().optional().or(z.literal("")),
  package_qty: z.coerce.number().int().min(0).optional(),
  table_price: z.coerce.number().min(0),
});

/**
 * Importa produtos já mapeados pelo navegador (tela de Configurações >
 * Tabela de preços) e registra no histórico de importações. Upsert por
 * código — reimportar atualiza os produtos existentes em vez de
 * duplicar. Marca price_updated_at em todos os produtos importados.
 */
export const importPriceTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        fileName: z.string().min(1),
        products: z.array(priceTableProductRowSchema),
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    if (data.products.length === 0) {
      throw new Error("Nenhum produto encontrado com as colunas selecionadas.");
    }

    const now = new Date().toISOString();

    // Cria o registro da importação primeiro, pra poder vincular cada
    // produto a ela — assim, excluir essa importação depois consegue
    // remover exatamente os produtos que ela trouxe.
    const { data: importLog, error: logError } = await supabase
      .from("price_table_imports")
      .insert({
        file_name: data.fileName,
        products_count: data.products.length,
        imported_at: now,
      })
      .select("id")
      .single();
    if (logError) throw new Error(logError.message);

    const productRows = data.products.map((p) => ({
      code: p.code,
      description: p.description,
      family: p.family || null,
      color: p.color || null,
      package_qty: p.package_qty ?? null,
      table_price: p.table_price,
      // Mantém os campos antigos preenchidos com o mesmo valor, já que o
      // pedido ainda usa "price_atacado/varejo" até reformularmos o cálculo.
      price_atacado: p.table_price,
      price_varejo_10: p.table_price,
      price_varejo_75: p.table_price,
      price_updated_at: now,
      price_table_import_id: importLog.id,
      active: true,
    }));

    const { error } = await supabase
      .from("catalog_products")
      .upsert(productRows, { onConflict: "code" });
    if (error) throw new Error(error.message);

    return {
      importedProducts: productRows.length,
      fileName: data.fileName,
      importedAt: now,
    };
  });

export const getPriceTableSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { count, error } = await supabase
      .from("catalog_products")
      .select("id", { count: "exact", head: true })
      .not("table_price", "is", null);
    if (error) throw new Error(error.message);
    return { productsWithPrice: count ?? 0 };
  });

/** Histórico de importações da tabela de preços, mais recente primeiro. */
export const listPriceTableImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("price_table_imports")
      .select("id, file_name, products_count, imported_at")
      .order("imported_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Edita um único produto (ex: a Bluutec reajustou só um item) sem
 * precisar reimportar a planilha inteira. Grava price_updated_at com a
 * data/hora da edição.
 */
export const updateCatalogProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        description: z.string().optional(),
        family: z.string().optional(),
        color: z.string().optional(),
        package_qty: z.coerce.number().int().min(0).optional(),
        table_price: z.coerce.number().min(0).optional(),
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { id, ...fields } = data as any;

    const payload: any = {
      price_updated_at: new Date().toISOString(),
    };
    if (fields.description !== undefined) payload.description = fields.description;
    if (fields.family !== undefined) payload.family = fields.family || null;
    if (fields.color !== undefined) payload.color = fields.color || null;
    if (fields.package_qty !== undefined) payload.package_qty = fields.package_qty;
    if (fields.table_price !== undefined) {
      payload.table_price = fields.table_price;
      payload.price_atacado = fields.table_price;
      payload.price_varejo_10 = fields.table_price;
      payload.price_varejo_75 = fields.table_price;
    }

    const { data: updated, error } = await supabase
      .from("catalog_products")
      .update(payload)
      .eq("id", id)
      .select("id, code")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Produto não encontrado.");

    return { id: updated.id, code: updated.code };
  });

/**
 * Remove um produto do catálogo (ex: foi importado com o código errado
 * e não dá pra só corrigir). Se o produto já foi usado em algum pedido,
 * o banco recusa a exclusão — a mensagem de erro explica isso.
 */
export const deleteCatalogProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("catalog_products")
      .delete()
      .eq("id", data.id);
    if (error) {
      if (error.message.toLowerCase().includes("foreign key")) {
        throw new Error(
          "Esse produto já foi usado em algum pedido e não pode ser excluído."
        );
      }
      throw new Error(error.message);
    }
    return { id: data.id };
  });

/** Apaga um registro do histórico de importações (não desfaz os preços
 * importados — só remove o registro da lista). */
export const deletePriceTableImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    // Exclui os produtos que vieram dessa importação e que ninguém
    // atualizou desde então (se um produto foi tocado por uma
    // importação ou edição mais recente, price_table_import_id já
    // aponta pra essa importação mais nova, e ele não é removido aqui).
    const { error: productsError, count } = await supabase
      .from("catalog_products")
      .delete({ count: "exact" })
      .eq("price_table_import_id", data.id);
    if (productsError) {
      if (productsError.message.toLowerCase().includes("foreign key")) {
        throw new Error(
          "Alguns produtos dessa importação já foram usados em pedidos e não puderam ser excluídos. Exclua-os individualmente no painel Produtos, se necessário."
        );
      }
      throw new Error(productsError.message);
    }

    const { error } = await supabase
      .from("price_table_imports")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    return { id: data.id, deletedProducts: count ?? 0 };
  });

// Imagens dos produtos
//
// Cada imagem é nomeada com o código do produto (ex: 70032001.jpg). O
// navegador envia o arquivo em base64; aqui ele é decodificado, salvo no
// Storage do Supabase (bucket "product-images", substituindo se já
// existir uma imagem com o mesmo código) e o link público é gravado no
// produto correspondente.
const uploadProductImageSchema = z.object({
  code: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  base64Data: z.string().min(1),
});

export const uploadProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => uploadProductImageSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const extMatch = data.fileName.match(/\.[a-zA-Z0-9]+$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : "";
    const path = `${data.code}${ext}`;
    const binary = Buffer.from(data.base64Data, "base64");

    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(path, binary, {
        contentType: data.contentType,
        upsert: true,
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(path);
    // "?v=" evita que o navegador mostre a foto antiga em cache quando a
    // imagem de um código é substituída.
    const imageUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { data: updated, error: updateError } = await supabase
      .from("catalog_products")
      .update({ image_url: imageUrl })
      .eq("code", data.code)
      .select("id, code")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);

    return { code: data.code, image_url: imageUrl, matched: !!updated };
  });

export const listCatalogProductCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("catalog_products")
      .select(
        "id, code, description, family, color, package_qty, table_price, price_updated_at, image_url"
      )
      .order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Remove a imagem de um produto: apaga o arquivo do armazenamento (se
 * conseguir identificar o caminho) e limpa o vínculo no produto. Um erro
 * ao apagar do armazenamento não impede de desvincular — o importante é
 * o produto deixar de mostrar a foto errada.
 */
export const deleteProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ code: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: product, error } = await supabase
      .from("catalog_products")
      .select("id, image_url")
      .eq("code", data.code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) throw new Error("Produto não encontrado.");

    if (product.image_url) {
      const marker = "/product-images/";
      const idx = product.image_url.indexOf(marker);
      if (idx !== -1) {
        let path = product.image_url.slice(idx + marker.length);
        const qIdx = path.indexOf("?");
        if (qIdx !== -1) path = path.slice(0, qIdx);
        await supabase.storage.from("product-images").remove([path]);
      }
    }

    const { error: updateError } = await supabase
      .from("catalog_products")
      .update({ image_url: null })
      .eq("id", product.id);
    if (updateError) throw new Error(updateError.message);

    return { code: data.code };
  });

/**
 * Move a imagem de um produto (fromCode) para outro (toCode) — usado
 * quando a foto foi carregada com o código errado. O produto de origem
 * fica sem imagem.
 */
export const reassignProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({ fromCode: z.string().min(1), toCode: z.string().min(1) })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: fromProduct, error: fromError } = await supabase
      .from("catalog_products")
      .select("id, image_url")
      .eq("code", data.fromCode)
      .maybeSingle();
    if (fromError) throw new Error(fromError.message);
    if (!fromProduct?.image_url) {
      throw new Error("Esse produto não tem imagem para mover.");
    }

    const { data: toProduct, error: toError } = await supabase
      .from("catalog_products")
      .update({ image_url: fromProduct.image_url })
      .eq("code", data.toCode)
      .select("id, code")
      .maybeSingle();
    if (toError) throw new Error(toError.message);
    if (!toProduct) {
      throw new Error(`Código "${data.toCode}" não encontrado no catálogo.`);
    }

    const { error: clearError } = await supabase
      .from("catalog_products")
      .update({ image_url: null })
      .eq("id", fromProduct.id);
    if (clearError) throw new Error(clearError.message);

    return { toCode: toProduct.code };
  });

// Impostos por produto e por estado (UF)
//
// Cada estado brasileiro tem sua própria tributação. A importação é por
// estado: código do produto + IPI + ST (mesmo mapeamento genérico de
// colunas da tabela de preços). Reimportar sobrescreve IPI e ST do
// estado — se uma coluna não for mapeada nessa importação, ela entra
// como 0 (não mantém o valor antigo).
const taxRateRowSchema = z.object({
  code: z.string().min(1),
  ipi_percent: z.coerce.number().min(0).default(0),
  st_percent: z.coerce.number().min(0).default(0),
});

export const importTaxRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        uf: z.string().min(2).max(2),
        rates: z.array(taxRateRowSchema),
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    if (data.rates.length === 0) {
      throw new Error("Nenhuma linha encontrada com as colunas selecionadas.");
    }
    const uf = data.uf.toUpperCase();

    const codes = data.rates.map((r) => r.code);
    const { data: products, error: productsError } = await supabase
      .from("catalog_products")
      .select("id, code")
      .in("code", codes);
    if (productsError) throw new Error(productsError.message);

    const codeToId = new Map((products ?? []).map((p: any) => [p.code, p.id]));
    const notFound: string[] = [];
    const rows = data.rates
      .map((r) => {
        const productId = codeToId.get(r.code);
        if (!productId) {
          notFound.push(r.code);
          return null;
        }
        return {
          product_id: productId,
          uf,
          ipi_percent: r.ipi_percent,
          st_percent: r.st_percent,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);

    if (rows.length > 0) {
      const { error } = await supabase
        .from("product_tax_rates")
        .upsert(rows, { onConflict: "product_id,uf" });
      if (error) throw new Error(error.message);
    }

    return { uf, imported: rows.length, notFound };
  });

/** Quantos produtos têm imposto configurado, por estado. */
export const listTaxRatesSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.from("product_tax_rates").select("uf");
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as any[]) {
      counts[row.uf] = (counts[row.uf] ?? 0) + 1;
    }
    return counts;
  });

/** Impostos cadastrados para um estado específico, com código e descrição
 * do produto já junto (pra exibir e editar na tela). */
export const listTaxRatesByUf = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ uf: z.string().min(2).max(2) }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("product_tax_rates")
      .select("id, ipi_percent, st_percent, catalog_products(code, description)")
      .eq("uf", data.uf.toUpperCase());
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[])
      .map((r) => ({
        id: r.id,
        ipi_percent: r.ipi_percent,
        st_percent: r.st_percent,
        code: r.catalog_products?.code ?? "",
        description: r.catalog_products?.description ?? "",
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  });

export const updateTaxRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        ipi_percent: z.coerce.number().min(0).optional(),
        st_percent: z.coerce.number().min(0).optional(),
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const payload: any = {};
    if (data.ipi_percent !== undefined) payload.ipi_percent = data.ipi_percent;
    if (data.st_percent !== undefined) payload.st_percent = data.st_percent;

    const { error } = await supabase
      .from("product_tax_rates")
      .update(payload)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

export const deleteTaxRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.from("product_tax_rates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

/**
 * Busca os impostos (IPI/ST) cadastrados para um estado, para um
 * conjunto de produtos — usado ao montar um orçamento, assim que o
 * cliente é selecionado, pra já calcular os impostos dos itens.
 */
export const getTaxRatesForOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        uf: z.string().min(2).max(2),
        productIds: z.array(z.string().uuid()),
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    if (data.productIds.length === 0) return [];
    const { data: rows, error } = await supabase
      .from("product_tax_rates")
      .select("product_id, ipi_percent, st_percent")
      .eq("uf", data.uf.toUpperCase())
      .in("product_id", data.productIds);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Catalog
export const listCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ search: z.string().optional() }).parse(data ?? {})
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let query = supabase
      .from("catalog_products")
      .select("*")
      .eq("active", true)
      .order("code")
      .limit(60);
    const term = (data.search ?? "").trim();
    if (term) {
      // Busca por palavra, não pela frase inteira: cada palavra
      // digitada precisa aparecer em algum lugar (código, referência,
      // descrição ou código de barras) — em qualquer ordem. Assim
      // "eletroduto branco" e "elet bran" encontram o mesmo produto,
      // mesmo a descrição sendo "ELETRODUTO PVC SEM ROSCA 3/4 BRANCO".
      const words = term.split(/\s+/).filter(Boolean);
      for (const word of words) {
        const w = word.replace(/[%,]/g, "");
        if (!w) continue;
        query = query.or(
          `code.ilike.%${w}%,ref.ilike.%${w}%,description.ilike.%${w}%,barcode.ilike.%${w}%`
        );
      }
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return term ? sortCatalogByRelevance(rows ?? [], term) : rows ?? [];
  });

/**
 * Reordena os resultados da busca priorizando quem bate exatamente com o
 * termo digitado (ex: buscar "2088" mostra primeiro o produto de código
 * 2088, em vez de ordenar tudo apenas alfabeticamente).
 */
function sortCatalogByRelevance(rows: any[], term: string) {
  const t = term.trim().toLowerCase();
  const score = (row: any) => {
    const code = String(row.code ?? "").toLowerCase();
    const ref = String(row.ref ?? "").toLowerCase();
    const description = String(row.description ?? "").toLowerCase();
    const barcode = String(row.barcode ?? "").toLowerCase();
    if (code === t || barcode === t) return 0;
    if (code.startsWith(t)) return 1;
    if (ref === t) return 2;
    if (ref.startsWith(t)) return 3;
    if (code.includes(t) || barcode.includes(t)) return 4;
    if (ref.includes(t)) return 5;
    if (description.startsWith(t)) return 6;
    return 7; // description.includes(t) ou outro campo
  };
  return [...rows].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return String(a.code ?? "").localeCompare(String(b.code ?? ""));
  });
}

// Retorna o catálogo completo (sem limite), usado para sincronizar a
// cópia local que permite consultar preços e montar pedidos offline.
export const listCatalogAll = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const pageSize = 500;
    let from = 0;
    const all: any[] = [];
    while (true) {
      const { data: rows, error } = await supabase
        .from("catalog_products")
        .select("*")
        .eq("active", true)
        .order("code")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  });

/**
 * Busca o registro completo do catálogo (preços das 3 tabelas, IPI, ST)
 * para uma lista de produtos, por id. Usado ao abrir um pedido para editar,
 * para recalcular corretamente o preço de cada item se o usuário trocar a
 * tabela de preço.
 */
export const getCatalogProductsByIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ ids: z.array(z.string().uuid()) }).parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    if (data.ids.length === 0) return [];
    const { data: rows, error } = await supabase
      .from("catalog_products")
      .select("*")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        status: orderStatusSchema,
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("orders")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
