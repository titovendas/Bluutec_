import { useEffect, useState } from "react";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setPromptEvent(null);
      return;
    }
    toast.info(
      "No computador: abra o menu do navegador e escolha “Instalar Força de Vendas”. No celular: “Adicionar à tela inicial”.",
      { duration: 8000 }
    );
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 w-full text-xs"
      onClick={handleClick}
    >
      {promptEvent ? (
        <Download className="mr-1.5 h-3 w-3" />
      ) : (
        <Info className="mr-1.5 h-3 w-3" />
      )}
      Instalar no computador
    </Button>
  );
}
