"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser, anonKeyConfigured } from "@/lib/supabase-browser";

// Redireciona para /login sem sessão. Retorna: undefined = carregando, true = ok.
export function useSession(): boolean | undefined {
  const [ok, setOk] = useState<boolean | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    if (!anonKeyConfigured()) {
      router.replace("/login");
      return;
    }
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setOk(true);
      else router.replace("/login");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  return ok;
}
