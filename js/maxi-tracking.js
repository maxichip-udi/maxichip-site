/* =============================================================================
 * maxi-tracking.js — conversões do Google Ads + marcador de origem no WhatsApp
 * Criado em 29/08/2026 (Ops), a partir do handoff do ads-strategist.
 *
 * RESOLVE DOIS PROBLEMAS:
 *
 * 1. O GTM base está nas 7 páginas desde 17/07, mas tag base NÃO registra
 *    conversão — ela habilita pageview e remarketing. As 3 conversões da conta
 *    são WEBPAGE_ONCLICK, ou seja, dependem de uma chamada explícita no clique.
 *    Sem isso, campanha ligada gasta sem medir (foi o que aconteceu fev–jun/26).
 *
 * 2. O Google NÃO entrega referral no payload do WhatsApp (o Meta entrega, via
 *    externalAdReply.sourceId). Quem clica no anúncio do Google e cai no
 *    WhatsApp chega indistinguível de um contato orgânico. O único sinal é o
 *    texto da mensagem — daí o marcador GOOGLE-<CODIGO>.
 *
 * 🔴 O MARCADOR É CONDICIONAL, E ISSO NÃO É DETALHE.
 *    Estas páginas recebem tráfego orgânico, direto e do Meta também. Marcador
 *    fixo faria TODO visitante ser creditado como google_ads — atribuição falsa,
 *    e decisão de verba tomada em cima de número inflado. Só injeta quando a
 *    visita comprovadamente veio do Google (gclid ou utm_source=google).
 *
 * 🔴 NUNCA SUBSTITUI O href. Só ACRESCENTA o marcador ao ?text=.
 *    Em 14/08 o Meta perdeu atribuição (30,4% -> 6,4% de conversas em 3 dias)
 *    porque o link do CTA foi sobrescrito. Aqui o href original é preservado
 *    inteiro; o marcador entra como prefixo do texto.
 * ========================================================================== */
(function () {
  'use strict';

  var AW = 'AW-757692394';

  // IDs vindos da API do Google Ads (conversion_action.tag_snippets), conta
  // 716-898-3490. Não inventar nem reaproveitar de outra conta.
  var CONV = {
    whatsapp: 'AW-757692394/MRsOCLD8lK8aEOrvpekC', // "Lead - Whatsapp"
    form:     'AW-757692394/Rny9CLC1vYIaEOrvpekC', // "Lead"
    rota:     'AW-757692394/-kkYCMjX0oIaEOrvpekC'  // "Ver rota"
  };
  // NÃO incluída de propósito: "Lead Chamada" (WEBSITE_CALL). Ela funciona por
  // SUBSTITUIÇÃO DO NÚMERO exibido na página, e trocar o número do site é
  // decisão do Luciano — não do código. As chamadas vindas da extensão de
  // chamada do anúncio seguem sendo medidas sem depender daqui.

  // ---------------------------------------------------------------------------
  // 1. gtag disponível
  // ---------------------------------------------------------------------------
  // ⚠️ AW-757692394 não aparecia em nenhuma das 7 páginas (auditado em 29/08),
  // então o tag do Google Ads não estava no HTML. Se ele TAMBÉM estiver
  // configurado dentro do GTM, existe risco de dupla contagem — ver NOTA-GTM no
  // fim deste arquivo. Carregamos aqui porque conversão que não dispara é pior
  // que conversão contada duas vezes: a primeira mente para menos e ninguém vê.
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  if (!document.querySelector('script[src*="gtag/js?id=' + AW + '"]')) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + AW;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', AW);
  }

  // ---------------------------------------------------------------------------
  // 2. A visita veio do Google? E de qual campanha?
  // ---------------------------------------------------------------------------
  // O código vem do PRÓPRIO utm_campaign — não de uma tabela fixa no site.
  // Assim uma campanha nova não exige deploy: basta a UTM certa no anúncio.
  var CHAVE = 'maxi_google_campanha';

  function normalizaCodigo(bruto) {
    if (!bruto) return null;
    // o CRM aceita 2-30 chars: letras, números e hífen; normaliza p/ maiúsculo
    var c = String(bruto).trim().toUpperCase().replace(/^GOOGLE[-_]/, '');
    c = c.replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (c.length < 2) return null;
    return 'GOOGLE-' + c.slice(0, 30 - 'GOOGLE-'.length);
  }

  function detectaCampanha() {
    var q = new URLSearchParams(window.location.search);
    var veioDoGoogle = q.has('gclid') ||
      (q.get('utm_source') || '').toLowerCase() === 'google';

    if (veioDoGoogle) {
      // sem utm_campaign a visita ainda é do Google — marca genérico para não
      // perder a atribuição de canal por falta de nome de campanha.
      var cod = normalizaCodigo(q.get('utm_campaign')) || 'GOOGLE-SEM-CAMPANHA';
      try { sessionStorage.setItem(CHAVE, cod); } catch (e) { /* modo privado */ }
      return cod;
    }
    // Persistência entre páginas: quem entrou pelo anúncio e navegou antes de
    // clicar no WhatsApp não pode perder o marcador.
    try { return sessionStorage.getItem(CHAVE); } catch (e) { return null; }
  }

  var CAMPANHA = detectaCampanha();

  // ---------------------------------------------------------------------------
  // 3. Marcador no link do WhatsApp — acrescenta, nunca substitui
  // ---------------------------------------------------------------------------
  function comMarcador(href) {
    if (!CAMPANHA) return href;                 // visita não veio do Google
    try {
      var u = new URL(href, window.location.origin);
      var texto = u.searchParams.get('text') || '';
      if (texto.indexOf(CAMPANHA) !== -1) return u.toString();  // já tem
      u.searchParams.set('text', texto ? (CAMPANHA + ' ' + texto) : CAMPANHA);
      return u.toString();
    } catch (e) {
      return href;                              // href estranho: não mexe
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Listener delegado — cobre link que nascer depois, sem tocar em 7 páginas
  // ---------------------------------------------------------------------------
  function ehWhatsApp(a) {
    var h = a.getAttribute('href') || '';
    return h.indexOf('wa.me') !== -1 || h.indexOf('api.whatsapp.com') !== -1;
  }
  function ehMapa(a) {
    var h = (a.getAttribute('href') || '').toLowerCase();
    return h.indexOf('google.com/maps') !== -1 || h.indexOf('maps.app.goo.gl') !== -1 ||
           h.indexOf('goo.gl/maps') !== -1;
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;

    var alvo = null, destino = a.getAttribute('href');
    if (ehWhatsApp(a)) { alvo = CONV.whatsapp; destino = comMarcador(destino); }
    else if (ehMapa(a)) { alvo = CONV.rota; }
    else return;

    // Abrir em nova aba não interrompe a navegação: dispara e deixa seguir.
    var novaAba = a.target === '_blank' || ev.ctrlKey || ev.metaKey ||
                  ev.shiftKey || ev.button === 1;

    if (novaAba) {
      if (destino !== a.getAttribute('href')) a.setAttribute('href', destino);
      window.gtag('event', 'conversion', { send_to: alvo });
      return;
    }

    // Mesma aba: segura a navegação até a conversão sair (event_callback),
    // com teto de 1s para nunca prender o usuário se a rede falhar.
    ev.preventDefault();
    var seguiu = false;
    var vai = function () { if (seguiu) return; seguiu = true; window.location.href = destino; };
    window.gtag('event', 'conversion', { send_to: alvo, event_callback: vai });
    setTimeout(vai, 1000);
  }, true);

  // ---------------------------------------------------------------------------
  // 5. Formulários — conversão "Lead"
  // ---------------------------------------------------------------------------
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f || f.tagName !== 'FORM') return;
    window.gtag('event', 'conversion', { send_to: CONV.form });
  }, true);

  // exposto para o teste manual da validação (DevTools)
  window.__maxiTracking = { campanha: CAMPANHA, comMarcador: comMarcador, conv: CONV };
})();

/* =============================================================================
 * NOTA-GTM — ler antes de mexer
 *
 * Em 29/08 nenhuma das 7 páginas continha AW-757692394 no HTML, então o tag de
 * conversão do Google Ads não estava lá. Este arquivo passa a carregá-lo.
 *
 * ⚠️ SE o contêiner GTM-M563LGFJ também tiver uma tag de conversão do Google Ads
 * configurada para os mesmos IDs, haverá DUPLA CONTAGEM. Como verificar:
 *   1. abrir o GTM, contêiner GTM-M563LGFJ
 *   2. procurar tags do tipo "Google Ads Conversion Tracking"
 *   3. se existir alguma com AW-757692394, escolher UM dos dois caminhos e
 *      desativar o outro — este arquivo ou a tag do GTM
 *
 * Como conferir na prática, sem depender do painel: abrir a página com
 * ?gclid=TESTE123&utm_source=google&utm_campaign=GOOGLE-TESTE, clicar no
 * WhatsApp e olhar a aba Network do DevTools. Deve haver UMA chamada para
 * googleadservices.com/pagead/conversion com o send_to correto — se houver
 * duas, é a dupla contagem.
 * ========================================================================== */
