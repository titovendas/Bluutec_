import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings, CreditCard, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: SettingsMenuPage,
  head: () => ({
    meta: [
      { title: "Configurações | Força de Vendas" },
      { name: "description", content: "Configurações do sistema." },
    ],
  }),
});

const sections = [
  {
    to: "/configuracoes/prazos-pagamento",
    icon: CreditCard,
    title: "Prazos de pagamento",
    description: "Importar e gerenciar os prazos usados nos pedidos.",
  },
];

function SettingsMenuPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground">Ajustes gerais do sistema.</p>
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((section) => (
          <Link key={section.to} to={section.to}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center gap-4 p-4">
                <section.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{section.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {section.description}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
