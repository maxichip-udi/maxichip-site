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

function comMarcador(href, campanha) {
  if (!campanha) return href;
  try {
    var u = new URL(href, 'https://www.maxichip.com.br');
    var texto = u.searchParams.get('text') || '';
    if (texto.indexOf(campanha) !== -1) return u.toString();
    u.searchParams.set('text', texto ? (campanha + ' ' + texto) : campanha);
    return u.toString();
  } catch (e) { return href; }
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
console.log(falhas === 0 ? '>>> TODOS OS CASOS PASSARAM' : '>>> FALHAS: ' + falhas);
process.exit(falhas === 0 ? 0 : 1);
