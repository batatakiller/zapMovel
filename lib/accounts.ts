import { supabaseAdmin } from "./supabase-server";

export type Account = {
  instance: string;
  label: string;
  color: string;
  phone: string | null;
  kind: "live" | "archive";
  sort_order: number;
  hasCustomEvolution: boolean;
};

export type EvolutionConfig = { url: string; apikey: string };

// remove barra(s) no final — evita "http://host//instance" ao concatenar
export const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "super";
const DEFAULT_EVOLUTION: EvolutionConfig = {
  url: stripTrailingSlash(process.env.EVOLUTION_URL ?? ""),
  apikey: process.env.EVOLUTION_APIKEY ?? "",
};

// Lista as contas cadastradas. Se a tabela ainda não existir (migração não
// rodada), devolve a instância única do .env para o app não quebrar.
export async function listAccounts(): Promise<Account[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("zap_accounts")
    .select("instance,label,color,phone,kind,sort_order")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error || !data?.length) {
    return [
      {
        instance: DEFAULT_INSTANCE,
        label: "Principal",
        color: "#008069",
        phone: null,
        kind: "live",
        sort_order: 0,
        hasCustomEvolution: false,
      },
    ];
  }

  // marca quais contas têm servidor Evolution próprio (sem expor a apikey)
  let custom = new Set<string>();
  try {
    const { data: secrets } = await db.from("zap_account_secrets").select("instance,evolution_url,evolution_apikey");
    custom = new Set(
      (secrets ?? [])
        .filter((s) => s.evolution_url?.trim() || s.evolution_apikey?.trim())
        .map((s) => s.instance)
    );
  } catch {
    /* tabela ainda não existe — nenhuma conta tem config própria */
  }

  return (data as Omit<Account, "hasCustomEvolution">[]).map((a) => ({
    ...a,
    hasCustomEvolution: custom.has(a.instance),
  }));
}

// Valida que a instância existe e é 'live' (pode enviar/receber). Contas
// 'archive' são somente leitura.
export async function assertLiveInstance(instance: string): Promise<void> {
  const accounts = await listAccounts();
  const acc = accounts.find((a) => a.instance === instance);
  if (!acc) throw new Error(`conta '${instance}' não cadastrada`);
  if (acc.kind !== "live") throw new Error(`conta '${instance}' é somente leitura (arquivo importado)`);
}

// Resolve URL + apikey do Evolution para uma conta: usa a configuração
// própria da conta (zap_account_secrets) quando existir, senão cai no .env.
export async function getEvolutionConfig(instance: string): Promise<EvolutionConfig> {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("zap_account_secrets")
      .select("evolution_url,evolution_apikey")
      .eq("instance", instance)
      .maybeSingle();
    const customUrl = data?.evolution_url?.trim();
    return {
      url: customUrl ? stripTrailingSlash(customUrl) : DEFAULT_EVOLUTION.url,
      apikey: data?.evolution_apikey?.trim() || DEFAULT_EVOLUTION.apikey,
    };
  } catch {
    return DEFAULT_EVOLUTION;
  }
}

// Salva/atualiza o servidor Evolution de uma conta. Passar null/"" limpa o
// campo (volta a usar o padrão do .env). Não faz nada se ambos vierem vazios
// e não houver registro (evita criar linha à toa).
export async function setEvolutionConfig(
  instance: string,
  url: string | null | undefined,
  apikey: string | null | undefined
): Promise<void> {
  const db = supabaseAdmin();
  const cleanUrl = url?.trim() ? stripTrailingSlash(url.trim()) : null;
  const cleanKey = apikey?.trim() || null;
  const { error } = await db
    .from("zap_account_secrets")
    .upsert({ instance, evolution_url: cleanUrl, evolution_apikey: cleanKey }, { onConflict: "instance" });
  if (error) throw new Error(`falha ao salvar servidor Evolution: ${error.message}`);
}

// Remove a configuração própria de uma conta (volta a usar o .env padrão).
export async function clearEvolutionConfig(instance: string): Promise<void> {
  await supabaseAdmin().from("zap_account_secrets").delete().eq("instance", instance);
}
