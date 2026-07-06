// Formulário de contato — Cloudflare Pages Function
// POST /api/contact  { nome, email, telefone, mensagem, website (honeypot) }
//
// Provedor de envio por variável de ambiente (Pages > Settings > Variables):
//   RESEND_API_KEY   → envia via Resend (from precisa de domínio verificado; ver CONTACT_FROM)
//   WEB3FORMS_KEY    → envia via Web3Forms (chave criada para comercial@maxichip.com.br)
// Opcionais: CONTACT_TO (default comercial@maxichip.com.br), CONTACT_FROM (Resend)

export async function onRequestPost(context) {
  const { request, env } = context;
  let data;
  try {
    data = await request.json();
  } catch (_) {
    return json({ ok: false, error: "payload inválido" }, 400);
  }

  // Honeypot: bot preencheu o campo oculto → aceita em silêncio e descarta
  if (data.website) return json({ ok: true });

  const nome = String(data.nome || "").trim();
  const email = String(data.email || "").trim();
  const telefone = String(data.telefone || "").trim();
  const mensagem = String(data.mensagem || "").trim();

  if (!nome || !email || !mensagem) return json({ ok: false, error: "campos obrigatórios faltando" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "e-mail inválido" }, 400);
  if (nome.length > 200 || email.length > 200 || telefone.length > 30 || mensagem.length > 5000)
    return json({ ok: false, error: "campo acima do limite" }, 400);

  const destino = env.CONTACT_TO || "comercial@maxichip.com.br";
  const assunto = `[Site Maxi Chip] Contato de ${nome}`;
  const corpo = [
    `Nome: ${nome}`,
    `E-mail: ${email}`,
    `Telefone: ${telefone || "—"}`,
    "",
    "Mensagem:",
    mensagem,
    "",
    "— Enviado pelo formulário de contato de maxichip.com.br",
  ].join("\n");

  try {
    if (env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.CONTACT_FROM || "Site Maxi Chip <contato@maxichip.com.br>",
          to: [destino],
          reply_to: email,
          subject: assunto,
          text: corpo,
        }),
      });
      if (!r.ok) return json({ ok: false, error: "provedor recusou o envio" }, 502);
      return json({ ok: true });
    }

    if (env.WEB3FORMS_KEY) {
      const r = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: env.WEB3FORMS_KEY,
          subject: assunto,
          from_name: nome,
          email: email,
          phone: telefone,
          message: corpo,
          replyto: email,
        }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || out.success === false) return json({ ok: false, error: "provedor recusou o envio" }, 502);
      return json({ ok: true });
    }
  } catch (_) {
    return json({ ok: false, error: "falha no envio" }, 502);
  }

  // Nenhum provedor configurado ainda — o front mostra a mensagem de erro com fallback pro WhatsApp
  return json({ ok: false, error: "provedor de envio não configurado" }, 503);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
