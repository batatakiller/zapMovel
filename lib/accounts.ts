import { supabaseAdmin } from "./supabase-server";

export type Account = {
  instance: string;
  label: string;
  color: string;
  phone: string | null;
  kind: "live" | "archive";
  sort_order: number;
};

const DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "super";

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
    return [{ instance: DEFAULT_INSTANCE, label: "Principal", color: "#008069", phone: null, kind: "live", sort_order: 0 }];
  }
  return data as Account[];
}

// Valida que a instância existe e é 'live' (pode enviar/receber). Contas
// 'archive' são somente leitura.
export async function assertLiveInstance(instance: string): Promise<void> {
  const accounts = await listAccounts();
  const acc = accounts.find((a) => a.instance === instance);
  if (!acc) throw new Error(`conta '${instance}' não cadastrada`);
  if (acc.kind !== "live") throw new Error(`conta '${instance}' é somente leitura (arquivo importado)`);
}
