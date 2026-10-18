// Debrief — preparação de reuniões: notícias da companhia relevantes para o aeroporto.
// Ações:
//   recolher  — lê os feeds RSS (CAPA + sites de referência) e guarda no arquivo crm_noticias.
//               Chamada pela tarefa de hora a hora (cabeçalho x-debrief-cron) ou por um utilizador com acesso.
//   preparar  — junta arquivo + Google News + reuniões anteriores; o Claude escolhe e explica o que importa.
// Segredos: ANTHROPIC_API_KEY, CAPA_RSS_URL (um ou mais endereços, um por linha). Nada disto vai para a app.

const MODEL = Deno.env.get('DEBRIEF_MODEL') ?? 'claude-sonnet-5-5';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? 'sb_publishable_wjWRDRsB9LNA7XIn4fsXBw_-_b2yVnV';
const UA = 'Mozilla/5.0 (compatible; Debrief/1.0; +https://loungeasc.github.io/debrief/)';

// filtro: só para fontes gerais (turismo/economia) — guarda apenas o que fala de aviação
const FEEDS: { fonte: string; url: string; filtro?: boolean }[] = [
  { fonte: 'Aeroroutes', url: 'https://www.aeroroutes.com/eng?format=rss' },
  { fonte: 'AeroTime', url: 'https://www.aerotime.aero/feed' },
  { fonte: 'Simple Flying', url: 'https://simpleflying.com/feed/' },
  { fonte: 'FlightGlobal', url: 'https://www.flightglobal.com/rss' },
  { fonte: 'Airlines (IATA)', url: 'https://www.airlines.iata.org/rss.xml' },
  { fonte: 'anna.aero', url: 'https://www.anna.aero/feed/' },
  { fonte: 'aeroTELEGRAPH', url: 'https://www.aerotelegraph.com/feed' },
  { fonte: 'AirlineGeeks', url: 'https://www.airlinegeeks.com/feed/' },
  { fonte: 'Aviation24.be', url: 'https://www.aviation24.be/feed/' },
  { fonte: 'Aviación al Día', url: 'https://www.aviacionaldia.com/feed' },
  { fonte: 'Ambitur', url: 'https://www.ambitur.pt/feed/', filtro: true },
  { fonte: 'Preferente', url: 'https://www.preferente.com/rss', filtro: true },
  { fonte: 'Hosteltur', url: 'https://www.hosteltur.com/rss', filtro: true },
  { fonte: 'Jornal de Negócios', url: 'https://www.jornaldenegocios.pt/rss', filtro: true },
  { fonte: 'ECO', url: 'https://eco.sapo.pt/feed/', filtro: true },
];
const AVIATION_RE = /(avia[cç][aã]o|a[ée]re[oa]s?\b|aeroporto|aeropuerto|airport|airline|aerol[íi]nea|companhias? a[ée]rea|\bvoos?\b|\bvuelos?\b|low.?cost|ryanair|easyjet|transavia|vueling|iberia|lufthansa|wizz|\btap\b|binter|volotea|\bslots?\b)/i;

const CITY: Record<string, string> = { OPO: 'Porto', LIS: 'Lisboa', FAO: 'Faro', VGO: 'Vigo', SCQ: 'Santiago de Compostela', FNC: 'Funchal', PDL: 'Ponta Delgada', MAD: 'Madrid', BCN: 'Barcelona', BIO: 'Bilbao', SVQ: 'Sevilha', AGP: 'Málaga', LCG: 'Corunha', OVD: 'Astúrias' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---------- utilitários */
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', euro: '€' };
function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function text(s: string) {
  let t = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (let i = 0; i < 2; i++) t = decode(t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}
type Item = { id?: string; fonte: string; titulo: string; resumo: string; link: string; publicado_em: string | null };
function parseFeed(xml: string, fonte: string): Item[] {
  const out: Item[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const titulo = text(tag(b, 'title'));
    let link = text(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = decode(m[1]); }
    if (!link) { const g = text(tag(b, 'guid')); if (/^https?:/.test(g)) link = g; }
    if (!titulo || !/^https?:\/\//.test(link)) continue;
    const resumo = text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content')).slice(0, 600);
    const d = text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = d ? new Date(d) : null;
    const src = text(tag(b, 'source'));
    out.push({ fonte: src || fonte, titulo: titulo.slice(0, 400), resumo, link: link.slice(0, 1000), publicado_em: t && !isNaN(+t) ? t.toISOString() : null });
  }
  return out;
}
async function sha1(s: string) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function getText(url: string, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    const head = new TextDecoder('latin1').decode(buf.slice(0, 300));
    const cs = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] || r.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
    try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
  } finally { clearTimeout(t); }
}
const rest = (path: string, init: RequestInit = {}, key = SERVICE, auth = `Bearer ${SERVICE}`) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });

async function temAcesso(auth: string) {
  const r = await rest('rpc/crm_tem_acesso', { method: 'POST', body: '{}' }, ANON, auth);
  return r.ok && (await r.json()) === true;
}
async function cronOk(token: string) {
  if (!token) return false;
  const r = await rest('rpc/crm_cron_ok', { method: 'POST', body: JSON.stringify({ t: token }) });
  return r.ok && (await r.json()) === true;
}
function capaFeeds() {
  return (Deno.env.get('CAPA_RSS_URL') || '').split(/[\n,;]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)).map((url) => ({ fonte: 'CAPA', url }));
}

/* ---------- recolher: feeds → arquivo */
async function recolher() {
  const feeds = [...capaFeeds(), ...FEEDS];
  const res = await Promise.allSettled(feeds.map(async (f) => {
    const items = parseFeed(await getText(f.url), f.fonte);
    return f.filtro ? items.filter((i) => AVIATION_RE.test(i.titulo + ' ' + i.resumo)) : items;
  }));
  const rows: Item[] = []; const estado: Record<string, number | string> = {};
  res.forEach((r, i) => {
    const nome = feeds[i].fonte === 'CAPA' ? `CAPA ${i + 1}` : feeds[i].fonte;
    if (r.status === 'fulfilled') { rows.push(...r.value); estado[nome] = r.value.length; } else estado[nome] = 'erro: ' + String(r.reason?.message || r.reason).slice(0, 80);
  });
  for (const it of rows) it.id = await sha1(it.link);
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
  for (let i = 0; i < uniq.length; i += 200) {
    const r = await rest('crm_noticias?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(uniq.slice(i, i + 200)) });
    if (!r.ok) throw new Error('arquivo: ' + (await r.text()).slice(0, 200));
  }
  await rest('crm_noticias_estado?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ id: 1, recolhido_em: new Date().toISOString(), estado: estado }]) });
  return { total: uniq.length, estado };
}
async function ultimaRecolha(): Promise<number> {
  const r = await rest('crm_noticias_estado?id=eq.1&select=recolhido_em');
  if (!r.ok) return 0;
  const j = await r.json(); return j[0]?.recolhido_em ? Date.parse(j[0].recolhido_em) : 0;
}

/* ---------- preparar */
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function normT(s: string) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+-\s+[^-]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70); }

async function googleNews(q: string, lang: 'pt' | 'en') {
  const loc = lang === 'pt' ? 'hl=pt-PT&gl=PT&ceid=PT:pt-150' : 'hl=en-GB&gl=GB&ceid=GB:en';
  const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`, 12000);
  return parseFeed(xml, 'Google News').map((i) => ({ ...i, titulo: i.titulo.replace(/\s+-\s+[^-]{2,60}$/, ''), resumo: '' }));
}

const PREP_TOOL = {
  name: 'preparacao',
  description: 'Preparação de uma reunião com uma companhia aérea.',
  input_schema: {
    type: 'object',
    properties: {
      resumo: { type: 'string', description: '2 a 4 frases: a situação atual da companhia que importa para o aeroporto.' },
      noticias: {
        type: 'array', description: 'Até 12 notícias escolhidas, da mais para a menos importante.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'O id da notícia na lista fornecida.' },
            categoria: { type: 'string', enum: ['frota', 'rotas', 'financas', 'estrategia', 'operacoes', 'portugal'] },
            importancia: { type: 'integer', enum: [1, 2, 3], description: '3 = muito importante para a negociação' },
            porque: { type: 'string', description: 'Uma frase: porque importa para o aeroporto.' },
            angulo: { type: 'string', description: 'Opcional: como usar na reunião (pergunta, argumento, oportunidade, risco).' },
          },
          required: ['id', 'categoria', 'importancia', 'porque'],
        },
      },
      pontos: { type: 'array', items: { type: 'string' }, description: '3 a 6 pontos ou perguntas para levar à reunião.' },
      reunioes: {
        type: 'object', description: 'Só se houver reuniões anteriores.',
        properties: { resumo: { type: 'string' }, pendentes: { type: 'array', items: { type: 'string' } } },
      },
    },
    required: ['resumo', 'noticias', 'pontos'],
  },
};

async function preparar(body: any, userId: string) {
  const companhia = String(body?.companhia || '').trim().slice(0, 80);
  if (!companhia) throw new Error('Falta a companhia');
  const key = Deno.env.get('ANTHROPIC_API_KEY'); if (!key) throw new Error('Falta a chave da API do Claude nos segredos do Supabase.');
  const chave = String(body?.chave || companhia).slice(0, 120);
  const codigo = String(body?.codigo || '').trim().slice(0, 3);
  const aeroporto = String(body?.aeroporto || 'OPO').toUpperCase().slice(0, 3);
  const concorrentes: string[] = (Array.isArray(body?.concorrentes) ? body.concorrentes : ['LIS', 'FAO', 'VGO', 'SCQ']).map((c: unknown) => String(c).toUpperCase().slice(0, 3)).filter(Boolean).slice(0, 10);
  const nomes = [...new Set([companhia, ...(Array.isArray(body?.aliases) ? body.aliases : [])].map((s: unknown) => String(s).trim()).filter((s) => s.length >= 3))].slice(0, 5);
  const reunioes = (Array.isArray(body?.reunioes) ? body.reunioes : []).slice(0, 6).map((r: any) => `[${String(r.data || '').slice(0, 10)}] ${String(r.texto || '').slice(0, 1800)}`);

  // 1) arquivo atualizado (se a tarefa automática ainda não correu)
  let recolha: unknown = null;
  if (Date.now() - (await ultimaRecolha()) > 2 * 3600 * 1000) { try { recolha = await recolher(); } catch (e) { recolha = String(e); } }

  // 2) arquivo: últimos 120 dias que mencionem a companhia
  const rx = nomes.map((n) => `\\m${reEsc(n)}\\M`).join('|');
  const desde = new Date(Date.now() - 120 * 864e5).toISOString();
  const ar = await rest('rpc/crm_noticias_procurar', { method: 'POST', body: JSON.stringify({ padrao: rx, desde, lim: 160 }) });
  if (!ar.ok) console.error('arquivo', await ar.clone().text());
  const arquivo: Item[] = ar.ok ? await ar.json() : [];

  // 3) Google News (em direto)
  const n0 = `"${companhia}"`;
  const cidades = [aeroporto, ...concorrentes].map((c) => CITY[c] || c);
  const gq: [string, 'pt' | 'en'][] = [
    [`${n0} (${CITY[aeroporto] || aeroporto} OR Portugal) when:120d`, 'pt'],
    [`${n0} (fleet OR order OR aircraft OR deliveries OR route OR routes OR base OR capacity) when:60d`, 'en'],
    [`${n0} (results OR profit OR loss OR debt OR strike OR bankruptcy OR insolvency OR merger OR acquisition OR CEO) when:90d`, 'en'],
    [`${n0} (${cidades.slice(1).map((c) => `"${c}"`).join(' OR ')}) when:120d`, 'pt'],
  ];
  const gn = (await Promise.allSettled(gq.map(([qq, l]) => googleNews(qq, l)))).flatMap((r) => r.status === 'fulfilled' ? r.value : []);
  const viaGN = new Set(gn);

  // 4) juntar, tirar repetidas, limitar
  const all = [...arquivo, ...gn].filter((i) => i.titulo);
  const seen = new Set<string>(); const cand: Item[] = [];
  all.sort((a, b) => (b.publicado_em ? Date.parse(b.publicado_em) : 0) - (a.publicado_em ? Date.parse(a.publicado_em) : 0));
  for (const it of all) { const k = normT(it.titulo); if (!k || seen.has(k)) continue; seen.add(k); cand.push(it); if (cand.length >= 120) break; }
  const byId = new Map<string, Item>(); cand.forEach((it, i) => { const id = 'n' + (i + 1); byId.set(id, it); });
  const lista = [...byId.entries()].map(([id, it]) => `${id} | ${it.publicado_em ? it.publicado_em.slice(0, 10) : 's/d'} | ${it.fonte} | ${it.titulo}${it.resumo ? ' — ' + it.resumo.slice(0, 260) : ''}`).join('\n');

  // 5) Claude escolhe e explica
  const prompt = [
    `Vais preparar uma reunião comercial do Aeroporto do ${CITY[aeroporto] || aeroporto} (${aeroporto}; ANA Aeroportos de Portugal / VINCI Airports) com ${companhia}${codigo ? ` (${codigo})` : ''}.`,
    `O objetivo do aeroporto é atrair e reter capacidade, rotas e frequências, e negociar taxas e incentivos. Aeroportos concorrentes: ${concorrentes.map((c) => `${CITY[c] || c} (${c})`).join(', ')}.`,
    '',
    'Da lista de notícias abaixo, escolhe só as que contam para esta negociação, por exemplo:',
    '- frota: encomendas, entregas, atrasos, aviões parados (capacidade que vai ou não vai para algum lado);',
    '- rotas: aberturas, cortes, novas bases, sobretudo em Portugal, no Porto e nos aeroportos concorrentes;',
    '- finanças: resultados, dívida, risco de insolvência, venda ou fusão;',
    '- estratégia: alianças, codeshares, mudanças de gestão, foco em mercados;',
    '- operações: greves, falta de pilotos ou motores, limitações que afetem a operação;',
    '- portugal: tudo o que seja sobre a companhia em Portugal.',
    'Ignora curiosidades, incidentes com passageiros sem impacto e notícias que não são sobre esta companhia.',
    'Não inventes factos: usa só o que está na lista. Se for uma leitura tua, diz «possível» ou «pode».',
    'Escreve em português de Portugal, frases curtas. Se não houver nada relevante, diz isso no resumo e deixa as notícias vazias.',
    reunioes.length ? `\nReuniões anteriores do aeroporto com esta companhia (as notas são internas):\n${reunioes.join('\n\n')}\nResume-as em «reunioes» (resumo curto + pendentes: compromissos ou pedidos que ficaram por fechar).` : '',
    `\nNOTÍCIAS (${byId.size}):\n${lista || '(nenhuma)'}`,
  ].join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3500, tools: [PREP_TOOL], tool_choice: { type: 'tool', name: 'preparacao' }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) { const t = await r.text(); console.error('anthropic', r.status, t.slice(0, 500)); throw new Error(r.status === 401 ? 'Chave da API inválida.' : r.status === 429 ? 'Limite de utilização atingido.' : 'O Claude não respondeu.'); }
  const out = await r.json();
  const p = (out.content ?? []).find((c: any) => c.type === 'tool_use')?.input ?? {};
  const noticias = (Array.isArray(p.noticias) ? p.noticias : []).map((n: any) => {
    const it = byId.get(String(n.id)); if (!it) return null;
    return { titulo: it.titulo, fonte: it.fonte, data: it.publicado_em, link: it.link, categoria: n.categoria, importancia: n.importancia, porque: String(n.porque || ''), angulo: String(n.angulo || '') };
  }).filter(Boolean);
  const porFonte: Record<string, number> = {}; for (const it of cand) { const f = viaGN.has(it) ? 'Google News' : it.fonte; porFonte[f] = (porFonte[f] || 0) + 1; }
  const dados = {
    companhia, codigo, aeroporto, concorrentes, gerado_em: new Date().toISOString(),
    resumo: String(p.resumo || ''), noticias, pontos: Array.isArray(p.pontos) ? p.pontos.map(String) : [],
    reunioes: p.reunioes && reunioes.length ? { resumo: String(p.reunioes.resumo || ''), pendentes: Array.isArray(p.reunioes.pendentes) ? p.reunioes.pendentes.map(String) : [] } : null,
    analisadas: cand.length, porFonte, capa: capaFeeds().length > 0, modelo: out.model, usage: out.usage, recolha,
  };
  await rest('crm_preparacoes?on_conflict=chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ chave, companhia, dados, gerado_em: dados.gerado_em, gerado_por: userId }]) });
  return dados;
}

function userFromJwt(auth: string) {
  try { return JSON.parse(atob(auth.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405);
  let body: any = {}; try { body = await req.json(); } catch { /* vazio */ }
  const action = body?.action === 'recolher' ? 'recolher' : 'preparar';
  try {
    const cron = await cronOk(req.headers.get('x-debrief-cron') || '');
    const auth = req.headers.get('Authorization') ?? '';
    const user = !cron && auth.startsWith('Bearer ') && (await temAcesso(auth));
    if (!cron && !user) return json({ error: 'sem_acesso', message: 'Sem acesso às reuniões.' }, 403);
    if (action === 'recolher') return json(await recolher());
    if (!user) return json({ error: 'sem_acesso', message: 'Só utilizadores.' }, 403);
    return json(await preparar(body, userFromJwt(auth)));
  } catch (e) {
    console.error(e);
    const msg = String((e as Error)?.message || e);
    return json({ error: /chave/i.test(msg) ? 'sem_chave' : 'erro', message: msg }, /chave/i.test(msg) ? 503 : 500);
  }
});
