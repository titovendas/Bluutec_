import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

/**
 * Lê a sessão salva pelo Supabase direto do localStorage, sem depender da
 * biblioteca (que pode travar tentando renovar o token pela rede). Serve
 * de última opção quando getSession() demora demais offline.
 */
function readCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const key = Object.keys(window.localStorage).find((k) =>
      /^sb-.*-auth-token$/.test(k)
    );
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.user ?? parsed?.currentSession?.user ?? null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // getSession() deveria ser local/rápida, mas em alguns casos (token
    // perto de expirar) ela tenta renovar pela rede e pode travar sem
    // internet. Damos um prazo curto e, se estourar, usamos a sessão
    // salva no navegador diretamente, sem esperar mais.
    Promise.race([supabase.auth.getSession(), timeout(2500)])
      .then((result) => {
        if (!mounted) return;
        if (result === "timeout") {
          setUser(readCachedUser());
        } else {
          setUser(result.data.session?.user ?? readCachedUser());
        }
        setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setUser(readCachedUser());
          setLoading(false);
        }
      });

    if (typeof navigator === "undefined" || navigator.onLine) {
      supabase.auth
        .getUser()
        .then(({ data: { user: revalidated } }) => {
          if (mounted && revalidated) setUser(revalidated);
        })
        .catch(() => {
          /* sem internet ou erro momentâneo — mantém a sessão local */
        });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
