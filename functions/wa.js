// Atribuição do WhatsApp por servidor — Cloudflare Pages Function
// GET /wa?c=GOOGLE-OFICINA&p=/oficina/&t=<texto>&gclid=<se houver>
//
// POR QUE ESTA ROTA EXISTE (medido em 14/09/2026):
//   Google Ads contou 19 conversões "Lead - Whatsapp" em 7 dias. O CRM
//   registrou 0 leads com origem = google_ads. Em 317 mensagens entrantes, a
//   única ocorrência de "GOOGLE-" foi o teste de 30/08.
//
//   O site NÃO tem defeito. O elo que falha é o último, e é humano: o marcador
//   viaja dentro do texto pré-preenchido da mensagem, e quem apaga o texto
//   pronto antes de escrever — muita gente apaga — apaga a atribuição junto.
//
//   Aqui o CTA passa por nós antes de ir pro WhatsApp: a origem nasce no
//   servidor, num momento em que o usuário ainda não pode interferir. O
//   marcador no texto continua indo junto, mas vira segunda via, não a única.
//
// 🔴 REGRA INEGOCIÁVEL DESTE ARQUIVO: o redirect SEMPRE acontece.
//   Falha de banco, variável faltando, parâmetro estranho — nada disso pode
//   impedir o cliente de chegar no WhatsApp. Medir é secundário; a conversa é
//   o negócio. Por isso toda gravação está em try/catch que segue em frente.
//
// Padrão reusado de functions/api/placa.js (no ar desde 21/07), com as mesmas
// variáveis já configuradas no Pages:
//   SUPABASE_URL         → projeto maxi-crm-relacionamento
//   SUPABASE_SERVICE_KEY → service_role (precisa de INSERT em marketing_wa_clique)

// Números para os quais esta rota aceita redirecionar.
//
// ⚠️ É allowlist de propósito. Aceitar número livre da query transformaria /wa
// num redirecionador aberto — qualquer um poderia espalhar links do domínio
// da Maxi Chip apontando para o WhatsApp dele. Número novo entra AQUI, no
// código, com deploy.
const NUMEROS_PERMITIDOS = new Set([
  "5534991483400", // número principal da empresa (instância Z-API, desde 23/08)
]);
const NUMERO_PADRAO = "5534991483400";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = url.searchParams;

  const numero = numeroValido(q.get("n"));
  const campanha = normalizaCampanha(q.get("c"));
  const gclid = limita(q.get("gclid"), 200);
  const pagina = limita(q.get("p"), 200);
  const texto = q.get("t") || "";

  // O destino é montado ANTES de qualquer I/O: se a gravação explodir, o
  // redirect já está pronto e sai igual.
  const destino = montaDestino(numero, campanha, texto);

  try {
    await gravaClique(env, {
      canal: canalDe(campanha),
      campanha,
      gclid,
      pagina,
    });
  } catch (_) {
    // Medição perdida é prejuízo pequeno; conversa perdida é prejuízo grande.
    // Segue para o redirect de qualquer jeito.
  }

  return Response.redirect(destino, 302);
}

// ---- montagem do destino ----

function montaDestino(numero, campanha, texto) {
  const u = new URL(`https://wa.me/${numero}`);
  // O marcador continua no texto como REDUNDÂNCIA: quando o usuário não apaga
  // o texto pronto, a atribuição é exata e dispensa o casamento por janela.
  const t = campanha && texto.indexOf(campanha) === -1
    ? (texto ? `${campanha} ${texto}` : campanha)
    : texto;
  if (t) u.searchParams.set("text", t);
  return u.toString();
}

function numeroValido(bruto) {
  const n = String(bruto || "").replace(/\D/g, "");
  return NUMEROS_PERMITIDOS.has(n) ? n : NUMERO_PADRAO;
}

// Mesmo formato que o maxi-tracking.js produz: 2-30 chars, A-Z 0-9 e hífen.
function normalizaCampanha(bruto) {
  if (!bruto) return null;
  const c = String(bruto).trim().toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return c.length >= 2 ? c : null;
}

function limita(v, n) {
  if (!v) return null;
  const s = String(v).slice(0, n);
  return s || null;
}

// O canal sai do prefixo do próprio marcador — campanha nova não exige deploy,
// basta a UTM certa no anúncio (mesma escolha do maxi-tracking.js).
function canalDe(campanha) {
  if (!campanha) return "organico";
  if (campanha.startsWith("GOOGLE-")) return "google";
  if (campanha.startsWith("META-") || campanha.startsWith("FB-")) return "meta";
  return "organico";
}

// ---- Supabase ----

async function gravaClique(env, linha) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/marketing_wa_clique`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([linha]),
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
}
