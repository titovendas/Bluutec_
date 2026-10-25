import { get, set } from "idb-keyval";
import { base64ToBytes } from "@/lib/base64";
import { getFactoryTemplate, getFactoryTemplateInfo } from "@/lib/factory-template.functions";

const KEY = "factory-template-v1";

export type CachedFactoryTemplate = {
  id: string;
  fileName: string;
  uploadedAt: string;
  bytes: Uint8Array;
};

export async function cacheFactoryTemplate(template: CachedFactoryTemplate) {
  try {
    await set(KEY, template);
  } catch {
    /* sem cache o app só precisa de internet para gerar a planilha */
  }
}

/**
 * Devolve o modelo da fábrica. Com internet confere se há versão nova;
 * sem internet usa a cópia guardada no aparelho.
 */
export async function loadFactoryTemplate(): Promise<CachedFactoryTemplate> {
  let cached: CachedFactoryTemplate | undefined;
  try {
    cached = await get(KEY);
  } catch {
    cached = undefined;
  }

  const online = typeof navigator === "undefined" || navigator.onLine;
  if (online) {
    try {
      const info = await getFactoryTemplateInfo();
      if (!info) {
        throw new Error(
          "O modelo da planilha da fábrica ainda não foi enviado. Vá em Configurações → Planilha da fábrica."
        );
      }
      if (cached && cached.id === info.id) return cached;
      const full = await getFactoryTemplate();
      if (!full) throw new Error("Não consegui baixar o modelo da planilha da fábrica.");
      const fresh: CachedFactoryTemplate = {
        id: full.id,
        fileName: full.fileName,
        uploadedAt: full.uploadedAt,
        bytes: base64ToBytes(full.contentBase64),
      };
      await cacheFactoryTemplate(fresh);
      return fresh;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  }

  if (cached) return cached;
  throw new Error(
    "Sem internet e o modelo da fábrica ainda não está guardado neste aparelho. Conecte-se uma vez para baixá-lo."
  );
}
