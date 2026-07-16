// Cria o usuário de login do app no Supabase Auth.
// Uso: node scripts/create-user.mjs seu@email.com SuaSenhaForte

import { supabase } from "./evo-common.mjs";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.log("Uso: node scripts/create-user.mjs seu@email.com SuaSenhaForte");
  process.exit(1);
}

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  console.error("Erro:", error.message);
  process.exit(1);
}
console.log(`Usuário criado: ${data.user.email} (id ${data.user.id})`);
console.log("Agora entre no app com esse e-mail e senha.");
