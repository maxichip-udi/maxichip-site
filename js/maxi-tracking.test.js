/* Testa a LÓGICA do marcador de origem sem navegador.
 * O risco que este teste existe para pegar: creditar visita orgânica como
 * google_ads. Isso inflaria a atribuição e faria decisão de verba nascer torta.
 * Rodar: node js/maxi-tracking.test.js
 */
'use strict';

// --- reproduz as duas funções puras do maxi-tracking.js ---------------------
function normalizaCodigo(bruto) {
  if (!bruto) return null;
  var c = String(bruto).trim().toUpperCase().replace(/^GOOGLE[-_]/, '');
  c = c.replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (c.length < 2) return null;
  return 'GOOGLE-' + c.slice(0, 30 - 'GOOGLE-'.length);
}

function detecta(query) {
  var q = new URLSearchParams(query);
  var veio = q.has('gclid') || (q.get('utm_source') || '').toLowerCase() === 'google';
  if (!veio) return null;
  return normalizaCodigo(q.get('utm_campaign')) || 'GOOGLE-SEM-CAMPANHA';
}

function ehRotaWa(u) {
  return u.pathname === '/wa' || u.pathname === '/wa/';
}

function comMarcador(href, campanha, queryAtual) {
  if (!campanha) return href;
  try {
    var u = new URL(href, 'https://www.maxichip.com.br');
    if (ehRotaWa(u)) {
      u.searchParams.set('c', campanha);
      var g = new URLSearchParams(queryAtual || '').get('gclid');
      if (g) u.searchParams.set('gclid', g);
      return u.toString();
    }
    var texto = u.searchParams.get('text') || '';
    if (texto.indexOf(campanha) !== -1) return u.toString();
    u.searchParams.set('text', texto ? (campanha + ' ' + texto) : campanha);
    return u.toString();
  } catch (e) { return href; }
}

function ehWhatsApp(href) {
  var h = href || '';
  if (h.indexOf('wa.me') !== -1 || h.indexOf('api.whatsapp.com') !== -1) return true;
  try { return ehRotaWa(new URL(h, 'https://www.maxichip.com.br')); }
  catch (e) { return false; }
}

// --- lógica do servidor (functions/wa.js), para provar a cadeia inteira ------
var NUMEROS_PERMITIDOS = ['5534991483400'];
var NUMERO_PADRAO = '5534991483400';

function numeroValido(bruto) {
  var n = String(bruto || '').replace(/\D/g, '');
  return NUMEROS_PERMITIDOS.indexOf(n) !== -1 ? n : NUMERO_PADRAO;
}
function canalDe(campanha) {
  if (!campanha) return 'organico';
  if (campanha.indexOf('GOOGLE-') === 0) return 'google';
  if (campanha.indexOf('META-') === 0 || campanha.indexOf('FB-') === 0) return 'meta';
  return 'organico';
}
/** Reproduz montaDestino() do functions/wa.js. */
function destinoDoServidor(qs) {
  var q = new URLSearchParams(qs);
  var numero = numeroValido(q.get('n'));
  var campanha = q.get('c');
  var texto = q.get('t') || '';
  var u = new URL('https://wa.me/' + numero);
  var t = (campanha && texto.indexOf(campanha) === -1)
    ? (texto ? campanha + ' ' + texto : campanha)
    : texto;
  if (t) u.searchParams.set('text', t);
  return u.toString();
}

// --- casos ------------------------------------------------------------------
var falhas = 0;
function ok(cond, msg) { if (!cond) { falhas++; console.log('FALHOU |', msg); } else console.log('PASS   |', msg); }

console.log('=== A) QUEM É creditado como Google (e quem NÃO é) ===');
ok(detecta('?gclid=ABC123') === 'GOOGLE-SEM-CAMPANHA', 'gclid sozinho -> ' + detecta('?gclid=ABC123'));
ok(detecta('?gclid=ABC&utm_campaign=REMAP-AGRO') === 'GOOGLE-REMAP-AGRO', 'gclid + campanha -> ' + detecta('?gclid=ABC&utm_campaign=REMAP-AGRO'));
ok(detecta('?utm_source=google&utm_campaign=OFICINA-BH') === 'GOOGLE-OFICINA-BH', 'utm_source=google -> ' + detecta('?utm_source=google&utm_campaign=OFICINA-BH'));
ok(detecta('?utm_source=GOOGLE&utm_campaign=x1') === 'GOOGLE-X1', 'maiuscula normaliza -> ' + detecta('?utm_source=GOOGLE&utm_campaign=x1'));
ok(detecta('?utm_campaign=GOOGLE-REMAP') === null, '🔴 utm_campaign SEM origem google -> null (nao credita)');
ok(detecta('?utm_source=facebook&utm_campaign=x') === null, '🔴 visita do Meta -> null (nao credita)');
ok(detecta('') === null, '🔴 visita organica/direta -> null (nao credita)');
ok(detecta('?fbclid=XYZ') === null, '🔴 fbclid (Meta) -> null (nao credita)');

console.log('');
console.log('=== B) o marcador ACRESCENTA, nunca substitui ===');
var C = 'GOOGLE-REMAP-AGRO';
var r1 = comMarcador('https://wa.me/5534991483400', C);
ok(r1.indexOf('wa.me/5534991483400') !== -1 && r1.indexOf('GOOGLE-REMAP-AGRO') !== -1,
   'link sem texto -> ' + r1);

var orig = 'https://wa.me/5534991483400?text=Quero%20saber%20sobre%20remap';
var r2 = comMarcador(orig, C);
ok(r2.indexOf('Quero') !== -1 && r2.indexOf('GOOGLE-REMAP-AGRO') !== -1,
   '🔑 texto original PRESERVADO + marcador -> ' + decodeURIComponent(r2.split('text=')[1]));

var r3 = comMarcador(r2, C);
ok((r3.match(/GOOGLE-REMAP-AGRO/g) || []).length === 1, 'clicar duas vezes nao duplica o marcador');

ok(comMarcador(orig, null) === orig, '🔴 sem campanha -> href INTACTO (visitante organico)');

var telefone = comMarcador('https://wa.me/5534991483400?text=oi', C);
ok(telefone.indexOf('5534991483400') !== -1, 'o numero do WhatsApp nunca muda');

console.log('');
console.log('=== C) o CRM consegue ler o que o site escreve? ===');
// regex EXATA do workflow n8n (nos "Prepara Registro SDR" e "Registra Silencio")
var RE_CRM = new RegExp(String.fromCharCode(92) + 'bGOOGLE[-_]([A-Z0-9-]{2,30})' + String.fromCharCode(92) + 'b', 'i');
[['GOOGLE-REMAP-AGRO', 'REMAP-AGRO'], ['GOOGLE-OFICINA-BH', 'OFICINA-BH'], ['GOOGLE-SEM-CAMPANHA', 'SEM-CAMPANHA']]
  .forEach(function (par) {
    var texto = par[0] + ' Quero saber sobre remap';
    var m = texto.match(RE_CRM);
    ok(!!m && m[1].toUpperCase() === par[1], 'CRM le "' + par[0] + '" -> ' + (m ? m[1] : 'NAO CASOU'));
  });

console.log('');
console.log('=== D) a rota /wa — origem gravada no servidor (14/09) ===');

// 🔴 O caso que este bloco existe para pegar: trocar o href do CTA para /wa e
// o listener deixar de reconhecer o link. A conversao pararia de disparar em
// SILENCIO — o modo de falha de fev-jun/26, seis meses sem ninguem ver.
ok(ehWhatsApp('/wa?p=/oficina/&t=oi'), '🔴 o listener RECONHECE a rota /wa (conversao segue disparando)');
ok(ehWhatsApp('https://wa.me/5534991483400?text=oi'), 'e continua reconhecendo o wa.me direto (paginas ainda nao migradas)');
ok(!ehWhatsApp('/oficina/'), 'link comum nao vira conversao de WhatsApp');
ok(!ehWhatsApp('/wallpaper/'), '🔴 /wallpaper NAO e a rota /wa (prefixo nao basta)');

// URLSearchParams serializa espaco como "+" (form-urlencoded) — e o WhatsApp
// le "+" como espaco. Mesmo comportamento ja no ar desde 29/08, ver caso B.
function leg(s) { return decodeURIComponent(String(s).replace(/\+/g, '%20')); }

var w1 = comMarcador('/wa?p=%2Foficina%2F&t=Quero%20agendar', C, '?gclid=ABC123&utm_source=google');
ok(w1.indexOf('c=GOOGLE-REMAP-AGRO') !== -1, 'campanha vai em parametro proprio -> c=GOOGLE-REMAP-AGRO');
ok(w1.indexOf('gclid=ABC123') !== -1, 'gclid e repassado pro servidor');
ok(leg(w1).indexOf('t=Quero agendar') !== -1, '🔑 o texto da pagina NAO e alterado pelo JS');

ok(comMarcador('/wa?p=/oficina/&t=oi', null, '') === '/wa?p=/oficina/&t=oi',
   '🔴 visitante organico -> href INTACTO (sem c=, nao credita Google)');

// A ponta do servidor: o que sai do /wa para o WhatsApp.
var d1 = destinoDoServidor('c=GOOGLE-REMAP-AGRO&t=Quero%20agendar&p=/oficina/');
ok(d1.indexOf('wa.me/5534991483400') !== -1, 'servidor redireciona pro numero da casa -> ' + d1.split('?')[0]);
ok(leg(d1).indexOf('GOOGLE-REMAP-AGRO Quero agendar') !== -1,
   '🔑 marcador + texto original preservados no redirect (redundancia)');

var d2 = destinoDoServidor('t=Quero%20agendar&p=/oficina/');
ok(d2.indexOf("GOOGLE") === -1 && leg(d2).indexOf('Quero agendar') !== -1,
   'organico: texto intacto e SEM marcador');

// 🔴 redirecionador aberto: o /wa nao pode virar ponte pro WhatsApp de terceiro
ok(destinoDoServidor('n=5511999999999&t=oi').indexOf('5534991483400') !== -1,
   '🔴 numero fora da allowlist e IGNORADO (nao vira redirecionador aberto)');

ok(canalDe('GOOGLE-OFICINA') === 'google', 'canal do GOOGLE- -> google');
ok(canalDe('META-DIESEL') === 'meta', 'canal do META- -> meta');
ok(canalDe(null) === 'organico', 'sem campanha -> organico');

console.log('');
console.log(falhas === 0 ? '>>> TODOS OS CASOS PASSARAM' : '>>> FALHAS: ' + falhas);
process.exit(falhas === 0 ? 0 : 1);
