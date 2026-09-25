// Função da Vercel: entrega ao navegador a URL do projeto Supabase e a
// chave pública (anon/publishable), lidas das variáveis de ambiente.
// Essa chave é pública por natureza; nunca exponha a service_role aqui.
module.exports = (req, res) => {

  const env = process.env;

  const url =
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  res.setHeader("Cache-Control", "no-store");

  if (!url || !anonKey) {
    res.status(500).json({
      error: "variáveis SUPABASE_URL e SUPABASE_ANON_KEY não configuradas na Vercel"
    });
    return;
  }

  res.status(200).json({ url, anonKey });

};
