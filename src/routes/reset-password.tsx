import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, Loader2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: "Nova senha | Força de Vendas" },
      { name: "description", content: "Crie uma nova senha de acesso." },
    ],
  }),
});

function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O link do e-mail traz um código de recuperação no próprio endereço da
  // página; o Supabase o lê sozinho e avisa com o evento PASSWORD_RECOVERY.
  useEffect(() => {
    const hash = window.location.hash;
    if (/error=|error_code=/.test(hash) || /[?&]error=/.test(window.location.search)) {
      setStatus("invalid");
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setStatus("ready");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus("ready");
    });
    const timer = setTimeout(() => {
      setStatus((current) => (current === "checking" ? "invalid" : current));
    }, 6000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As duas senhas não são iguais.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setError(
        /different from the old password/i.test(error.message)
          ? "A nova senha precisa ser diferente da anterior."
          : "Não foi possível salvar a nova senha. Peça um novo link e tente de novo."
      );
      return;
    }
    setStatus("done");
    setTimeout(() => router.navigate({ to: "/" }), 1500);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Nova senha</h1>
        </div>

        {status === "checking" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando o link...
          </div>
        )}

        {status === "invalid" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">
              Este link é inválido ou já expirou. Peça um novo link na tela de login.
            </p>
            <Button asChild className="w-full">
              <Link to="/auth">Voltar para o login</Link>
            </Button>
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Repita a nova senha</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar nova senha
            </Button>
          </form>
        )}

        {status === "done" && (
          <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-center text-sm text-green-800">
            Senha alterada! Entrando no sistema...
          </p>
        )}
      </div>
    </div>
  );
}
