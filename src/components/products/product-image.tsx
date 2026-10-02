import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ProductImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
};

/** Miniatura de produto clicável: ao tocar, abre a imagem ampliada em um
 * pop-up, útil para o vendedor confirmar o produto com o cliente na hora
 * da venda. Se a foto não carregar (ex: offline e ainda não baixada),
 * mostra um ícone no lugar em vez do quadrado quebrado do navegador. */
export function ProductImage({ src, alt, className }: ProductImageProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded border bg-muted text-muted-foreground",
          className
        )}
        title={!src ? undefined : "Foto indisponível offline"}
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "cursor-zoom-in overflow-hidden rounded border transition-opacity hover:opacity-80",
          className
        )}
      >
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle className="text-base">{alt}</DialogTitle>
          <img
            src={src}
            alt={alt}
            className="mx-auto max-h-[70vh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
