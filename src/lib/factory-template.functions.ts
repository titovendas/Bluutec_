import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Modelo da planilha de pedido da fábrica. Fica guardado no banco (um só,
// o mais recente) e é baixado pelo aparelho para preencher o pedido.

export const getFactoryTemplateInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("factory_templates")
      .select("id, file_name, size_bytes, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id as string,
      fileName: data.file_name as string,
      sizeBytes: Number(data.size_bytes ?? 0),
      uploadedAt: data.uploaded_at as string,
    };
  });

export const getFactoryTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("factory_templates")
      .select("id, file_name, content_base64, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id as string,
      fileName: data.file_name as string,
      contentBase64: data.content_base64 as string,
      uploadedAt: data.uploaded_at as string,
    };
  });

export const saveFactoryTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        fileName: z.string().min(1).max(200),
        contentBase64: z.string().min(100).max(12_000_000),
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as any;
    const sizeBytes = Math.floor((data.contentBase64.length * 3) / 4);
    const { data: created, error } = await db
      .from("factory_templates")
      .insert({
        file_name: data.fileName,
        content_base64: data.contentBase64,
        size_bytes: sizeBytes,
        uploaded_at: new Date().toISOString(),
      })
      .select("id, uploaded_at")
      .single();
    if (error) throw new Error(error.message);

    // Guarda só o modelo mais recente.
    await db.from("factory_templates").delete().neq("id", created.id);

    return { id: created.id as string, uploadedAt: created.uploaded_at as string };
  });
