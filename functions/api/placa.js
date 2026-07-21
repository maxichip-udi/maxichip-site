// Consulta de placa (V2 do simulador Maxi DNA) — Cloudflare Pages Function
// GET /api/placa?placa=ABC1D23
//
// Fluxo: cache no Supabase (public.veiculo) → se não tiver, consulta APIPLACAS → calcula
// categoria (regra validada pelo Luciano, 2026-07-21) → grava no cache → responde.
// Spec completa: business/campanhas/maxi-dna-mvp/v2-simulador-placa-briefing.md
//
// Variáveis de ambiente necessárias (Pages > Settings > Variables):
//   APIPLACAS_TOKEN     → token da conta APIPLACAS (cofre Auroq, item "MaxiChip - APIPLACAS")
//   SUPABASE_URL        → mesma URL usada pelos scripts da Máquina de Relacionamento
//   SUPABASE_SERVICE_KEY→ idem (precisa de permissão de escrita em public.veiculo)

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const placaBruta = url.searchParams.get("placa") || "";
  const placa = placaBruta.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!/^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/.test(placa)) {
    return json({ encontrado: false, motivo: "placa_invalida" }, 200);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ encontrado: false, motivo: "erro" }, 200);
  }

  try {
    const cache = await lerCache(env, placa);
    if (cache) return json(formatarResposta(cache, "cache"));
  } catch (_) {
    // cache indisponível não deve travar o fluxo — segue pra consulta na API
  }

  if (!env.APIPLACAS_TOKEN) return json({ encontrado: false, motivo: "erro" }, 200);

  let dadosApi;
  try {
    dadosApi = await consultarApiplacas(env.APIPLACAS_TOKEN, placa);
  } catch (e) {
    return json({ encontrado: false, motivo: e.message || "erro" }, 200);
  }

  const registro = montarRegistro(placa, dadosApi);

  try {
    await gravarCache(env, registro);
  } catch (_) {
    // erro ao gravar cache não impede responder o cliente com o dado já consultado
  }

  return json(formatarResposta(registro, "apiplacas"));
}

// ---- Supabase (cache em public.veiculo) ----

const SELECT_CACHE =
  "placa,marca,modelo,versao_motor,combustivel,categoria_maxi_dna,fipe_valor,fipe_mes_referencia,dados_fonte";

async function lerCache(env, placa) {
  const url = `${env.SUPABASE_URL}/rest/v1/veiculo?placa=eq.${placa}&select=${SELECT_CACHE}`;
  const r = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  const rows = await r.json();
  const row = rows[0];
  if (row && row.dados_fonte === "apiplacas") return row;
  return null;
}

async function gravarCache(env, registro) {
  const url = `${env.SUPABASE_URL}/rest/v1/veiculo?on_conflict=placa`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      {
        placa: registro.placa,
        marca: registro.marca,
        modelo: registro.modelo,
        versao_motor: registro.versao_motor,
        cor: registro.cor,
        combustivel: registro.combustivel,
        cilindradas: registro.cilindradas,
        tipo_veiculo: registro.tipo_veiculo,
        categoria_maxi_dna: registro.categoria_maxi_dna,
        fipe_codigo: registro.fipe_codigo,
        fipe_valor: registro.fipe_valor,
        fipe_mes_referencia: registro.fipe_mes_referencia,
        dados_fonte: "apiplacas",
        dados_consultados_em: new Date().toISOString(),
      },
    ]),
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${await r.text()}`);
}

// ---- APIPLACAS (wdapi2.com.br) ----

async function consultarApiplacas(token, placa) {
  const r = await fetch(`https://wdapi2.com.br/consulta/${placa}/${token}`);
  if (r.status === 401) throw new Error("placa_invalida");
  if (r.status === 406) throw new Error("nao_encontrado");
  if (r.status === 429) throw new Error("limite_atingido");
  if (!r.ok) throw new Error("erro");
  const data = await r.json();
  if (!data || !data.marca) throw new Error("nao_encontrado");
  return data;
}

function montarRegistro(placa, api) {
  const extra = api.extra || {};
  const fipeDados = (api.fipe && api.fipe.dados) || [];
  // a doc da APIPLACAS recomenda usar o item de maior "score" quando houver mais de um
  const fipeTop = [...fipeDados].sort((a, b) => (b.score || 0) - (a.score || 0))[0];

  return {
    placa,
    marca: api.marca || null,
    modelo: api.modelo || null,
    versao_motor: (fipeTop && fipeTop.texto_modelo) || api.modeloVersao || api.VERSAO || null,
    cor: api.cor || null,
    combustivel: extra.combustivel || null,
    cilindradas: extra.cilindradas || null,
    tipo_veiculo: extra.tipo_veiculo || null,
    categoria_maxi_dna: classificarCategoria({
      marca: api.marca,
      modelo: api.modelo,
      versao: (fipeTop && fipeTop.texto_modelo) || api.modeloVersao || api.VERSAO || "",
      combustivel: extra.combustivel,
      cilindradas: extra.cilindradas,
    }),
    fipe_codigo: (fipeTop && fipeTop.codigo_fipe) || null,
    // fipe_valor é NUMERIC no banco — nunca grava o texto formatado ("R$ 29.570,00") direto, sempre o número
    fipe_valor: (fipeTop && fipeTop.texto_valor) ? parseValorBR(fipeTop.texto_valor) : null,
    fipe_mes_referencia: (fipeTop && fipeTop.mes_referencia) || null,
  };
}

// "R$ 29.570,00" -> 29570 (formato BR: ponto de milhar, vírgula decimal)
function parseValorBR(texto) {
  const limpo = String(texto).replace(/[^\d,]/g, "").replace(",", ".");
  const num = parseFloat(limpo);
  return Number.isFinite(num) ? num : null;
}

function formatarResposta(registro, fonte) {
  const CATEGORIA_LABEL = [
    "Básico · Nacionais Aspirados",
    "Nacionais Turbo",
    "Premium · Importados",
    "Diesel Leve",
    "Esportivo / Super Esportivo",
    "Pickup Premium / HD",
  ];
  return {
    encontrado: true,
    marca: registro.marca,
    modelo: registro.modelo,
    versaoMotor: registro.versao_motor,
    categoria: registro.categoria_maxi_dna,
    categoriaLabel: CATEGORIA_LABEL[(registro.categoria_maxi_dna || 1) - 1],
    fipe: registro.fipe_valor
      ? {
          valor: Number(registro.fipe_valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
          mesReferencia: registro.fipe_mes_referencia,
        }
      : null,
    fonte,
  };
}

// ---- Regra de classificação — seção 2.1 do v2-simulador-placa-briefing.md ----
// Validada pelo Luciano (21/07). Ordem importa: mais específico primeiro.

const MARCAS_ESPORTIVO = ["PORSCHE", "FERRARI", "LAMBORGHINI", "MCLAREN", "MASERATI"];
const MARCAS_PREMIUM = ["BMW", "MERCEDES-BENZ", "MERCEDES BENZ", "AUDI", "VOLVO", "LAND ROVER", "JAGUAR", "LEXUS", "JEEP"];
const MODELOS_DIESEL_LEVE = ["HILUX", "RANGER", "AMAROK", "S10", "TRITON", "L200", "TRANSIT", "COMPASS", "RENEGADE"];
const MODELOS_PICKUP_HD = ["F-150", "F150", "SILVERADO", "TUNLAND"];

function norm(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function classificarCategoria({ marca, modelo, versao, combustivel, cilindradas }) {
  const M = norm(marca), MOD = norm(modelo), V = norm(versao), COMB = norm(combustivel);
  const isDiesel = COMB.includes("DIESEL");

  // 1 — Cat 5: Esportivo / Super Esportivo
  if (MARCAS_ESPORTIVO.some((m) => M.includes(m))) return 5;
  if (/\bAMG\b/.test(V) || /\bM[2345 ]?[2345]\b/.test(V) || /\bM8\b/.test(V)) return 5;
  if (/TYPE[\s-]?R\b/.test(V) || /\bWRX\b/.test(V) || /\bSTI\b/.test(V)) return 5;
  if (/GOLF\s*R\b/.test(MOD + " " + V) && !/GOLF\s*GTI\b/.test(MOD + " " + V)) return 5;

  // 2 — Cat 6: Pickup Premium/HD
  if (M === "RAM") return 6;
  if (MODELOS_PICKUP_HD.some((m) => MOD.includes(m))) return 6;

  // 3 — Cat 4: Diesel Leve (precisa vir ANTES do premium, por causa do Jeep diesel)
  if (isDiesel && MODELOS_DIESEL_LEVE.some((m) => MOD.includes(m))) return 4;

  // 4 — Cat 3: Premium/Importados (Jeep só chega aqui se não bateu a regra 3, ex. versão gasolina)
  if (MARCAS_PREMIUM.some((m) => M.includes(m))) return 3;

  // 5 — Cat 2: Nacionais Turbo
  if (/\bTURBO\b/.test(V) || /\bTSI\b/.test(V) || /\bGTS\b/.test(V)) return 2;
  const cc = parseInt(cilindradas, 10);
  if (cc && (Math.abs(cc - 999) <= 50 || Math.abs(cc - 1395) <= 50)) return 2;

  // 6 (default) — Cat 1: Básico/Nacionais Aspirados
  return 1;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
