// Função da Vercel: diz qual versão (deploy) está no ar. A página
// compara com a versão com que abriu e, quando muda, se atualiza.
// VERCEL_GIT_COMMIT_SHA muda a cada commit publicado; VERCEL_URL, a cada
// deploy (fallback se as variáveis de sistema não estiverem expostas).
module.exports = (req, res) => {

  const env = process.env;

  const version =
    env.VERCEL_GIT_COMMIT_SHA ||
    env.VERCEL_DEPLOYMENT_ID ||
    env.VERCEL_URL ||
    "dev";

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ version });

};
