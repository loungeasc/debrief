/* Debrief — «Perguntar»: conversa com o Claude. Carregado só quando é usado.
   O Claude pede dados através de ferramentas que correm aqui, no dispositivo; só segue para o Claude o que a pergunta precisa.
   As conversas são privadas: ficam neste dispositivo e na tabela crm_conversas (só o próprio utilizador as vê). */

const CHAT_FN = 'debrief-chat';
const CHAT = { list: [], conv: null, busy: false, live: null, abort: null, remote: true };

/* ---------- guardar conversas (local + Supabase, privadas) */
const chatStore = {
  async list() {
    let local = []; try { local = (await DB.get('kv', 'chats:list')) || []; } catch (e) {}
    if (Sync.on() && navigator.onLine && CHAT.remote) {
      try {
        const { data, error } = await Sync.client().from('crm_conversas').select('id,titulo,reuniao_id,atualizado_em').order('atualizado_em', { ascending: false }).limit(80);
        if (error) { if (/crm_conversas|relation|schema cache/i.test(error.message || '')) CHAT.remote = false; }
        else if (data) {
          const byId = new Map(local.map((c) => [c.id, c]));
          for (const r of data) byId.set(r.id, { id: r.id, titulo: r.titulo, reuniaoId: r.reuniao_id, atualizado: Date.parse(r.atualizado_em) || 0 });
          local = [...byId.values()];
        }
      } catch (e) {}
    }
    return local.sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
  },
  async get(id) {
    let c = null; try { c = await DB.get('kv', 'chat:' + id); } catch (e) {}
    if (Sync.on() && navigator.onLine && CHAT.remote) {
      try {
        const { data } = await Sync.client().from('crm_conversas').select('id,titulo,reuniao_id,mensagens,atualizado_em').eq('id', id).maybeSingle();
        if (data && (!c || (Date.parse(data.atualizado_em) || 0) > (c.atualizado || 0))) c = { id: data.id, titulo: data.titulo, reuniaoId: data.reuniao_id, mensagens: data.mensagens || [], atualizado: Date.parse(data.atualizado_em) || 0 };
      } catch (e) {}
    }
    return c;
  },
  async save(c) {
    c.atualizado = Date.now();
    try { await DB.rawPut('kv', c, 'chat:' + c.id); } catch (e) {}
    try {
      const list = (await DB.get('kv', 'chats:list')) || [];
      const i = list.findIndex((x) => x.id === c.id); const row = { id: c.id, titulo: c.titulo, reuniaoId: c.reuniaoId || null, atualizado: c.atualizado };
      if (i >= 0) list[i] = row; else list.unshift(row);
      await DB.rawPut('kv', list.slice(0, 200), 'chats:list');
    } catch (e) {}
    if (Sync.on() && navigator.onLine && CHAT.remote) {
      try {
        const { error } = await Sync.client().from('crm_conversas').upsert({ id: c.id, titulo: c.titulo, reuniao_id: c.reuniaoId || null, mensagens: c.mensagens, atualizado_em: new Date(c.atualizado).toISOString() });
        if (error && /crm_conversas|relation|schema cache/i.test(error.message || '')) CHAT.remote = false;
      } catch (e) {}
    }
  },
  async del(id) {
    try { await DB.rawDel('kv', 'chat:' + id); } catch (e) {}
    try { const list = ((await DB.get('kv', 'chats:list')) || []).filter((x) => x.id !== id); await DB.rawPut('kv', list, 'chats:list'); } catch (e) {}
    if (Sync.on() && navigator.onLine && CHAT.remote) { try { await Sync.client().from('crm_conversas').delete().eq('id', id); } catch (e) {} }
  },
};

/* ---------- ferramentas (correm no dispositivo) */
const chatWords = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function chatMeetingText(m) {
  return [m.airlineName, m.airlineCode, EV.of(m)?.name, subjectOf(m), m.location, m.internal, m.tradeshow, ...(m.topics || []).map((t) => `${t.name} ${t.text || ''}`), m.raw, m.nextSteps,
    ...(m.contactIds || []).map(getC).filter(Boolean).map((c) => `${contactName(c)} ${c.title || ''}`), ...(m.plannedPeople || []).map((p) => p.name)].join(' ');
}
function chatFindAirline(q) {
  const n = norm(q); if (!n) return null;
  const all = airlines();
  return all.find((a) => norm(a.code) === n) || all.find((a) => norm(a.name) === n) || all.find((a) => norm(a.name).includes(n) || n.includes(norm(a.name))) || null;
}
const CHAT_TOOLS = {
  async procurar_reunioes({ companhia, texto, desde, ate, limite } = {}) {
    let list = S.meetings.filter((m) => !m._unsaved);
    if (companhia) { const q = norm(companhia); list = list.filter((m) => norm(m.airlineName).includes(q) || norm(m.airlineCode) === q || (q.length > 3 && q.includes(norm(m.airlineName)) && m.airlineName)); }
    if (desde) list = list.filter((m) => (m.start || '').slice(0, 10) >= String(desde));
    if (ate) list = list.filter((m) => (m.start || '').slice(0, 10) <= String(ate));
    if (texto) {
      const ws = chatWords(texto);
      const scored = list.map((m) => { const t = norm(chatMeetingText(m)); return { m, n: ws.filter((w) => t.includes(w)).length }; });
      const all = scored.filter((x) => x.n === ws.length);
      list = (all.length ? all : scored.filter((x) => x.n > 0).sort((a, b) => b.n - a.n)).map((x) => x.m);
    }
    list.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    const lim = Math.min(40, Math.max(1, +limite || 15));
    return {
      total: list.length,
      reunioes: list.slice(0, lim).map((m) => ({
        id: m.id, data: m.start, companhia: m.airlineName, codigo: m.airlineCode, assunto: subjectOf(m), estado: stateOf(m), local: m.location || '', evento: EV.of(m)?.name || '',
        temas: (m.topics || []).filter((t) => (t.text || '').trim()).map((t) => t.name),
        notas: cut([...(m.topics || []).map((t) => t.text), m.raw].filter(Boolean).join(' · '), 260),
        proximos_passos: cut(m.nextSteps, 180),
      })),
    };
  },
  async ler_reuniao({ id } = {}) {
    const m = getM(id) || S.meetings.find((x) => x.id.startsWith(String(id || '')));
    if (!m) return { erro: 'Reunião não encontrada' };
    return {
      id: m.id, data: m.start, companhia: m.airlineName, codigo: m.airlineCode, assunto: subjectOf(m), estado: stateOf(m), local: m.location || '',
      evento: EV.of(m) ? { nome: EV.of(m).name, datas: EV.dates(EV.of(m)), local: EV.of(m).location || '' } : null, type_of_tradeshow: m.tradeshow || '', criada_por: m.createdByName || '',
      participantes_companhia: (m.contactIds || []).map(getC).filter(Boolean).map((c) => ({ nome: contactName(c), cargo: c.title || '', email: c.email || '' })),
      na_agenda: (m.plannedPeople || []).map((p) => p.name),
      participantes_ana: m.internal || '',
      temas: (m.topics || []).map((t) => ({ tema: t.name, texto: t.text || '' })),
      notas_por_organizar: m.raw || '', proximos_passos: m.nextSteps || '',
      simulacoes: (m.sims || []).map((s) => ({ parametros: { aeroporto: s.p.ap, voos_semana: s.p.freq, aeronave: s.p.tipo, lugares: s.p.lugares, load_factor: s.p.lf, inicio: s.p.inicio, incentivo: s.p.incTipo }, resultado: { incentivo_total: Math.round(s.r.incTotal || 0), ano1: Math.round(s.r.inc1 || 0), ano2: Math.round(s.r.inc2 || 0), por_pax: +(s.r.porPax || 0).toFixed(2), taxas_por_rotacao: Math.round(s.r.rotTotal || 0) } })),
    };
  },
  async procurar_contactos({ texto, companhia } = {}) {
    let list = [...S.contacts];
    if (companhia) { const q = norm(companhia); list = list.filter((c) => norm(c.company).includes(q) || norm(c.airlineCode) === q); }
    if (texto) { const ws = chatWords(texto); list = list.filter((c) => { const t = norm([contactName(c), c.title, c.company, c.email, c.notes].join(' ')); return ws.every((w) => t.includes(w)); }); }
    return { total: list.length, contactos: list.slice(0, 25).map((c) => ({ nome: contactName(c), cargo: c.title || '', companhia: c.company || '', email: c.email || '', telefone: c.phone || '', telemovel: c.mobile || '', notas: cut(c.notes, 160), reunioes: S.meetings.filter((m) => (m.contactIds || []).includes(c.id)).length })) };
  },
  async ler_preparacao({ companhia } = {}) {
    const a = chatFindAirline(companhia);
    const m = S.meetings.find((x) => x.airlineName && (a ? PREP.key(x) === airlineKey(a) : norm(x.airlineName).includes(norm(companhia))));
    const key = a ? airlineKey(a) : (m ? PREP.key(m) : String(companhia || '').toUpperCase());
    const d = (await PREP.local(key)) || (await PREP.remote(key).catch(() => null));
    if (!d) return { erro: `Ainda não há preparação para ${companhia}. O utilizador pode tocar em «Preparar reunião» numa reunião com esta companhia.` };
    return { companhia: d.companhia, gerada_em: d.gerado_em, resumo: d.resumo, pontos: d.pontos, reunioes_anteriores: d.reunioes, noticias: (d.noticias || []).map((n) => ({ titulo: n.titulo, fonte: n.fonte, data: (n.data || '').slice(0, 10), categoria: n.categoria, porque: n.porque, angulo: n.angulo, link: n.link })) };
  },
  async procurar_noticias({ texto, dias } = {}) {
    if (!Sync.on() || !navigator.onLine) return { erro: 'Sem rede ou sem sessão: o arquivo de notícias está no Supabase.' };
    const raw = String(texto || '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
    if (!raw.length) return { erro: 'Indica pelo menos uma palavra com 3 letras ou mais.' };
    const desde = new Date(Date.now() - Math.min(400, Math.max(1, +dias || 120)) * 864e5).toISOString();
    const main = raw[0];
    const { data, error } = await Sync.client().from('crm_noticias').select('titulo,resumo,fonte,link,publicado_em').or(`titulo.ilike.*${main}*,resumo.ilike.*${main}*`).gte('publicado_em', desde).order('publicado_em', { ascending: false }).limit(120);
    if (error) return { erro: 'Não foi possível ler o arquivo de notícias.' };
    const ws = raw.slice(1).map(norm);
    const rows = (data || []).map((n) => ({ n, k: ws.filter((w) => norm(n.titulo + ' ' + (n.resumo || '')).includes(w)).length })).sort((a, b) => b.k - a.k || (b.n.publicado_em || '').localeCompare(a.n.publicado_em || ''));
    return { total: rows.length, noticias: rows.slice(0, 25).map(({ n }) => ({ titulo: n.titulo, fonte: n.fonte, data: (n.publicado_em || '').slice(0, 10), resumo: cut(n.resumo, 260), link: n.link })) };
  },
  async listar_aeronaves({ texto, companhia } = {}) {
    await loadSimScript(); const ref = await SIMREF.get(); if (!ref) return { erro: 'As tabelas do simulador ainda não foram carregadas (precisa de sessão e rede uma vez).' };
    const ops = companhia ? simOperators(ref, companhia) : [];
    let types = ref.aeronaves.types;
    if (texto) { const q = norm(texto); types = types.filter((t) => norm(t.icao + ' ' + t.desc).includes(q)); }
    if (ops.length) types = [...types].sort((a, b) => ((b.ops || []).some((o) => ops.includes(o)) - (a.ops || []).some((o) => ops.includes(o))));
    return { aeronaves: types.slice(0, 25).map((t) => ({ icao: t.icao, descricao: t.desc, pmd_t: t.mtow, lugares: t.cap, ruido: t.noise, usada_pela_companhia: (t.ops || []).some((o) => ops.includes(o)) })) };
  },
  async simular_rota(inp = {}) {
    await loadSimScript(); const ref = await SIMREF.get(); if (!ref) return { erro: 'As tabelas do simulador ainda não foram carregadas (precisa de sessão e rede uma vez).' };
    const comp = inp.companhia || (CHAT.conv?.reuniaoId && getM(CHAT.conv.reuniaoId)?.airlineName) || '';
    const p = simDefaults(ref, { airlineName: comp });
    const ap = String(inp.aeroporto || '').toUpperCase(); if (ref.tarifas.aeroportos[ap]) p.ap = ap;
    if (inp.aeronave) {
      const q = String(inp.aeronave).toUpperCase(); const nq = norm(inp.aeronave);
      const t = ref.aeronaves.types.find((x) => x.icao === q) || ref.aeronaves.types.find((x) => norm(x.desc).includes(nq));
      if (t) { p.tipo = t.icao; p.pmd = t.mtow; p.lugares = t.cap || p.lugares; p.ruido = t.noise || ''; } else return { erro: `Aeronave «${inp.aeronave}» não encontrada. Usa listar_aeronaves.` };
    }
    if (inp.lugares) p.lugares = +inp.lugares;
    p.freq = +inp.voos_semana || 0;
    if (inp.load_factor != null) p.lf = +inp.load_factor;
    if (inp.inicio && /^\d{4}-\d{2}-\d{2}$/.test(inp.inicio)) p.inicio = inp.inicio;
    if (inp.partida && /^\d{1,2}:\d{2}$/.test(inp.partida)) p.partida = inp.partida.padStart(5, '0');
    if (inp.tipo_incentivo === 'monopolio' || inp.tipo_incentivo === 'nova') p.incTipo = inp.tipo_incentivo;
    if (['S', 'UE', 'INT'].includes(inp.destino)) p.destino = inp.destino;
    const R = simCompute(ref, p); const r = R.resumo; const t = ref.aeronaves.types.find((x) => x.icao === p.tipo);
    return {
      parametros: { aeroporto: p.ap, destino: p.destino, aeronave: `${p.tipo} ${t?.desc || ''}`.trim(), pmd_t: p.pmd, lugares: p.lugares, voos_semana: p.freq, load_factor: p.lf, inicio: p.inicio, partida: p.partida, tipo_incentivo: p.incTipo, off_peak_pct: R.off },
      incentivo: R.inc ? { total: Math.round(r.incTotal), ano1: Math.round(r.inc1), ano2: Math.round(r.inc2), por_pax_partida: +r.porPax.toFixed(2), pax_partida: Math.round(R.inc.totPax), epocas: R.inc.cols.map((c) => ({ epoca: c.se.id, ano: c.se.ano + 1, rotacoes: Math.round(c.rot), pax: Math.round(c.pax), incentivo: Math.round(c.sub), elegivel: c.eleg })) } : null,
      taxas: { por_rotacao: Math.round(r.rotTotal), ana_por_rotacao: Math.round(r.rotANA), por_pax: +r.rotPorPax.toFixed(2), epoca_tarifaria: R.rot1.epocaLabel, ana_no_periodo: Math.round(r.taxasANA), rotacoes_no_periodo: Math.round(R.rotTot), ana_liquidas_de_incentivo: Math.round(r.liquido), incentivo_cobre_pct: Math.round(r.cobertura * 100) },
      mesma_rotacao_noutros_aeroportos: R.cmp.map((c) => ({ aeroporto: c.ap, taxas_por_rotacao: Math.round(c.total) })),
      avisos: R.avisos,
      fonte: `${ref.tarifas.versao || 'Guia de Taxas 2026'}; ${ref.incentivos.versao || ''}; sem IVA; simulação indicativa`,
    };
  },
};
const CHAT_TOOL_LABEL = {
  procurar_reunioes: (i) => `Procurei reuniões${i.companhia ? ` de ${i.companhia}` : ''}${i.texto ? ` sobre «${i.texto}»` : ''}`,
  ler_reuniao: (i) => { const m = getM(i.id); return `Li a reunião${m ? ` ${m.airlineName || ''} de ${fmtDateShort(m.start)}` : ''}`; },
  procurar_contactos: (i) => `Procurei contactos${i.companhia ? ` de ${i.companhia}` : ''}${i.texto ? ` «${i.texto}»` : ''}`,
  ler_preparacao: (i) => `Li a preparação de ${i.companhia || ''}`,
  procurar_noticias: (i) => `Procurei notícias sobre «${i.texto || ''}»`,
  listar_aeronaves: (i) => `Vi os tipos de aeronave${i.companhia ? ` da ${i.companhia}` : ''}${i.texto ? ` «${i.texto}»` : ''}`,
  simular_rota: (i) => `Simulei ${i.voos_semana || '?'} voos/semana${i.aeronave ? ` em ${i.aeronave}` : ''}${i.aeroporto ? ` no ${i.aeroporto}` : ''}`,
  web_search: (i) => `Pesquisei na web: «${i.query || ''}»`,
};

/* ---------- pedido ao Claude (streaming) */
function chatContext() {
  const m = CHAT.conv?.reuniaoId ? getM(CHAT.conv.reuniaoId) : null;
  return {
    hoje: new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ` (${ymd(new Date())})`,
    utilizador: Sync.userName || S.settings.ownerName || '', aeroporto: (S.settings.airportCode || 'OPO').toUpperCase(), concorrentes: S.settings.competitors || '',
    reuniao: m ? { id: m.id, companhia: m.airlineName || 'sem companhia', data: (m.start || '').slice(0, 10) } : null,
  };
}
async function chatCall(onUpdate) {
  const { data } = await Sync.client().auth.getSession();
  const token = data?.session?.access_token; if (!token) throw new Error('A sessão terminou. Volta a entrar.');
  CHAT.abort = new AbortController();
  const res = await fetch(`${CLOUD.url}/functions/v1/${CHAT_FN}`, {
    method: 'POST', signal: CHAT.abort.signal,
    headers: { Authorization: `Bearer ${token}`, apikey: CLOUD.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: CHAT.conv.mensagens, contexto: chatContext(), web: !!S.settings.chatWeb, app: APP_VERSION }),
  });
  if (!res.ok || !res.body) { let j = {}; try { j = await res.json(); } catch (e) {} throw new Error(j.message || (res.status === 404 ? 'O «Perguntar» ainda não está configurado no Supabase.' : 'O Claude não respondeu.')); }
  const msg = { role: 'assistant', content: [] }; let stop = null;
  CHAT.live = msg;
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const handle = (ev) => {
    switch (ev.type) {
      case 'content_block_start': { const b = JSON.parse(JSON.stringify(ev.content_block)); if (b.type === 'tool_use' || b.type === 'server_tool_use') { b._json = ''; } if (b.type === 'thinking') { b.thinking = b.thinking || ''; b.signature = b.signature || ''; } msg.content[ev.index] = b; break; }
      case 'content_block_delta': {
        const b = msg.content[ev.index]; if (!b) break; const d = ev.delta;
        if (d.type === 'text_delta') b.text = (b.text || '') + d.text;
        else if (d.type === 'input_json_delta') b._json = (b._json || '') + d.partial_json;
        else if (d.type === 'citations_delta') (b.citations = b.citations || []).push(d.citation);
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        break;
      }
      case 'content_block_stop': { const b = msg.content[ev.index]; if (b && b.type === 'thinking') { if (typeof b.thinking !== 'string') b.thinking = ''; if (typeof b.signature !== 'string') b.signature = ''; } if (b && b._json != null) { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch (e) { b.input = {}; } delete b._json; } break; }
      case 'message_delta': if (ev.delta?.stop_reason) stop = ev.delta.stop_reason; break;
      case 'error': throw new Error(ev.error?.type === 'overloaded_error' ? 'O Claude está sobrecarregado. Tenta daqui a pouco.' : (ev.error?.message || 'Erro na resposta'));
    }
  };
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:')); if (!line) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
      handle(ev); onUpdate();
    }
  }
  msg.content = msg.content.filter(Boolean).filter((b) => !(b.type === 'text' && !b.text && !b.citations) && !(b.type === 'thinking' && !b.thinking && !b.signature));
  CHAT.live = null;
  return { msg, stop };
}
async function chatSend(text) {
  const c = CHAT.conv; if (!c || CHAT.busy) return;
  if (!Sync.on()) return toast('O «Perguntar» precisa de sessão do Portal');
  if (!navigator.onLine) return toast('Sem rede');
  const snap = c.mensagens.length;
  c.mensagens.push({ role: 'user', content: [{ type: 'text', text }] });
  if (!c.titulo) c.titulo = cut(text, 70);
  CHAT.busy = true; chatRender(true);
  try {
    for (let step = 0; step < 10; step++) {
      const { msg, stop } = await chatCall(() => chatRenderSoon());
      c.mensagens.push(msg);
      if (stop === 'tool_use') {
        const uses = msg.content.filter((b) => b.type === 'tool_use');
        const results = [];
        for (const u of uses) {
          let out; try { out = CHAT_TOOLS[u.name] ? await CHAT_TOOLS[u.name](u.input || {}) : { erro: 'Ferramenta desconhecida' }; } catch (e) { out = { erro: e.message || String(e) }; }
          let s = JSON.stringify(out); if (s.length > 40000) s = s.slice(0, 40000) + '…(cortado)';
          results.push({ type: 'tool_result', tool_use_id: u.id, content: s });
        }
        c.mensagens.push({ role: 'user', content: results }); chatRender(); continue;
      }
      if (stop === 'pause_turn') continue;
      break;
    }
    await chatStore.save(c);
  } catch (e) {
    console.warn('chat', e);
    c.mensagens.length = snap; CHAT.live = null;
    const inp = $('#chat-in'); if (inp && !inp.value) { inp.value = text; chatGrow(inp); }
    toast(e.name === 'AbortError' ? 'Pergunta cancelada' : (e.message || 'O Claude não respondeu'));
  } finally { CHAT.busy = false; CHAT.abort = null; chatRender(true); }
}

/* ---------- apresentação */
function mdLite(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n'); const out = []; let list = null;
  const inline = (t) => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const l of lines) {
    const t = l.trimEnd();
    let mm;
    if (!t.trim()) { close(); continue; }
    if ((mm = t.match(/^\s*#{1,4}\s+(.*)$/))) { close(); out.push(`<h4>${inline(mm[1])}</h4>`); continue; }
    if ((mm = t.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(mm[1])}</li>`); continue; }
    if ((mm = t.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(mm[1])}</li>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(t)) { close(); if (/^\s*\|[\s:|-]+\|\s*$/.test(t)) continue; out.push(`<div class="mdrow">${t.trim().replace(/^\||\|$/g, '').split('|').map((x) => `<span>${inline(x.trim())}</span>`).join('')}</div>`); continue; }
    close(); out.push(`<p>${inline(t)}</p>`);
  }
  close(); return out.join('');
}
function chatTurns(msgs) {
  const turns = []; let cur = null;
  for (const m of msgs) {
    if (m.role === 'user') {
      const texts = (m.content || []).filter((b) => b.type === 'text');
      if (texts.length) { cur = null; turns.push({ who: 'user', text: texts.map((b) => b.text).join('\n') }); continue; }
      continue; // resultados de ferramentas: não se mostram
    }
    if (!cur) { cur = { who: 'ai', blocks: [] }; turns.push(cur); }
    cur.blocks.push(...(m.content || []));
  }
  return turns;
}
function chatAiHTML(blocks, live, idx) {
  const parts = []; const cites = new Map(); let text = '';
  for (const b of blocks) {
    if (b.type === 'text') { text += (text ? '\n\n' : '') + (b.text || ''); for (const c of b.citations || []) if (c.url) cites.set(c.url, c.title || c.url); }
    else if (b.type === 'tool_use' || b.type === 'server_tool_use') { if (text) { parts.push({ t: 'text', v: text }); text = ''; } parts.push({ t: 'tool', v: (CHAT_TOOL_LABEL[b.name] || ((i) => b.name))(b.input || {}) }); }
  }
  if (text) parts.push({ t: 'text', v: text });
  const lastTool = parts.map((p) => p.t).lastIndexOf('tool');
  const finalText = parts.slice(lastTool + 1).filter((p) => p.t === 'text').map((p) => p.v).join('\n\n') || parts.filter((p) => p.t === 'text').map((p) => p.v).join('\n\n');
  const html = parts.map((p) => p.t === 'tool' ? `<div class="ctool">${ico('search', 'sm')} ${esc(p.v)}</div>` : `<div class="cmd">${mdLite(p.v)}</div>`).join('');
  const src = cites.size ? `<div class="csrc"><b>Fontes</b>${[...cites].slice(0, 8).map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(cut(t, 70))}</a>`).join('')}</div>` : '';
  const acts = !live && finalText ? `<div class="cacts"><button class="btn sm" data-ccopy="${idx}">${ico('copy', 'sm')} Copiar</button>${CHAT.conv?.reuniaoId && getM(CHAT.conv.reuniaoId) ? `<button class="btn sm" data-cjoin="${idx}">${ico('plus', 'sm')} Juntar às notas</button>` : ''}</div>` : '';
  return { html: html + (live ? '<div class="ctyping"><i></i><i></i><i></i></div>' : '') + src + acts, text: finalText };
}
let chatRaf = 0;
function chatRenderSoon() { if (chatRaf) return; chatRaf = requestAnimationFrame(() => { chatRaf = 0; chatRender(); }); }
function chatRender(forceScroll) {
  const box = $('#chat-msgs'); if (!box || !CHAT.conv) return;
  const nearBottom = forceScroll || (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160);
  const msgs = CHAT.live ? [...CHAT.conv.mensagens, CHAT.live] : CHAT.conv.mensagens;
  const turns = chatTurns(msgs);
  CHAT._texts = [];
  if (!turns.length) { box.innerHTML = chatEmptyHTML(); }
  else {
    box.innerHTML = turns.map((t, i) => {
      if (t.who === 'user') return `<div class="cmsg me"><div class="cbub">${esc(t.text).replace(/\n/g, '<br>')}</div></div>`;
      const live = CHAT.busy && i === turns.length - 1;
      const r = chatAiHTML(t.blocks, live, i); CHAT._texts[i] = r.text;
      return `<div class="cmsg ai"><div class="cav">${ico('chat', 'sm')}</div><div class="cbody">${r.html || (live ? '<div class="ctyping"><i></i><i></i><i></i></div>' : '')}</div></div>`;
    }).join('') + (CHAT.busy && turns[turns.length - 1].who === 'user' ? `<div class="cmsg ai"><div class="cav">${ico('chat', 'sm')}</div><div class="cbody"><div class="ctyping"><i></i><i></i><i></i></div></div></div>` : '');
  }
  const send = $('#chat-send'); if (send) { send.innerHTML = CHAT.busy ? ico('x') : ico('up'); send.setAttribute('aria-label', CHAT.busy ? 'Parar' : 'Enviar'); }
  if (nearBottom) window.scrollTo(0, document.documentElement.scrollHeight);
}
function chatSuggestions() {
  const m = CHAT.conv?.reuniaoId ? getM(CHAT.conv.reuniaoId) : null;
  const an = m?.airlineName;
  if (m) return [`Resume esta reunião em 5 linhas`, `O que ficou pendente com a ${an || 'companhia'} nas reuniões anteriores?`, `Escreve o email de follow-up desta reunião`, `Quanto recebe de incentivo uma rota nova de 3 voos/semana${an ? ` da ${an}` : ''} a partir da próxima época?`, an ? `Que notícias recentes da ${an} importam para o Porto?` : 'Que notícias recentes importam para o Porto?'];
  return ['O que ficou pendente com a Ryanair nas últimas reuniões?', 'Que companhias falaram de slots de manhã este ano?', 'Quanto recebe de incentivo uma rota nova de 4 voos/semana em A321neo a partir do W26? E com 2 voos?', 'Dá-me 3 perguntas para a próxima reunião com a TAP', 'Que reuniões tenho esta semana e o que preparar para cada uma?'];
}
function chatEmptyHTML() {
  const m = CHAT.conv?.reuniaoId ? getM(CHAT.conv.reuniaoId) : null;
  return `<div class="cempty"><div class="cav lg">${ico('chat')}</div><h2>Pergunta ao Claude</h2><p>${m ? `Sobre a reunião com ${esc(m.airlineName || 'a companhia')} de ${fmtDateShort(m.start)}, ou qualquer outra coisa.` : 'Sobre as tuas reuniões (e as do colega), contactos, notícias das companhias e o simulador de taxas e incentivos.'}</p>
    <div class="csugg">${chatSuggestions().map((s) => `<button class="chip" data-csugg="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <p class="faint" style="font-size:12.5px;margin-top:14px">As conversas são só tuas. Para responder, o Claude lê no dispositivo só o que precisa e esse texto é enviado para a Anthropic.${CHAT.remote ? '' : ' As conversas ficam só neste dispositivo até ser criada a tabela crm_conversas.'}</p></div>`;
}
function chatGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px'; }
function chatListSheet() {
  chatStore.list().then((list) => {
    const sh = sheet({ title: 'Conversas', body: list.length ? list.map((c) => { const m = c.reuniaoId ? getM(c.reuniaoId) : null; return `<div class="simrow"><div class="grow" data-copen="${esc(c.id)}"><div class="t">${esc(c.titulo || 'Sem título')}</div><div class="s">${esc(fmtTs(c.atualizado))}${m ? ` · ${esc(m.airlineName || '')}` : ''}</div></div><button class="ibtn sm" data-cdel="${esc(c.id)}" aria-label="Apagar conversa">${ico('x', 'sm')}</button></div>`; }).join('') : '<p class="faint">Ainda não há conversas.</p>' });
    sh.el.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-copen]'); if (o) { sh.close(); return go('#/perguntar/' + o.dataset.copen); }
      const d = e.target.closest('[data-cdel]'); if (d) { if (!(await confirmSheet('Apagar conversa?', 'A conversa é apagada em todos os teus dispositivos.', 'Apagar'))) return; await chatStore.del(d.dataset.cdel); d.closest('.simrow').remove(); if (CHAT.conv?.id === d.dataset.cdel) go('#/perguntar'); }
    });
  });
}

async function viewChatPage(arg) {
  renderChrome('q');
  document.body.classList.add('editing', 'chatting');
  let conv = null; let reuniaoId = null;
  if (arg && arg.startsWith('r-')) reuniaoId = arg.slice(2);
  else if (arg) conv = await chatStore.get(arg);
  if (!conv) conv = { id: uid(), titulo: '', reuniaoId, mensagens: [] };
  CHAT.conv = conv;
  const m = conv.reuniaoId ? getM(conv.reuniaoId) : null;
  view.innerHTML = `<div class="page chatpage">
    <div class="top"><button class="ibtn" data-back aria-label="Voltar">${ico('back')}</button><h1>Perguntar<small>${m ? `${esc(m.airlineName || 'Reunião')} · ${fmtDateShort(m.start)}` : 'Claude'}</small></h1>
      <button class="ibtn solid" data-clist aria-label="Conversas" title="Conversas">${ico('list')}</button><button class="ibtn solid" data-cnew aria-label="Nova conversa" title="Nova conversa">${ico('plus')}</button></div>
    <div class="chat-msgs" id="chat-msgs"></div>
    <div class="chat-bar"><button class="ibtn ${S.settings.chatWeb ? 'on' : ''}" id="chat-web" data-cweb aria-pressed="${S.settings.chatWeb ? 'true' : 'false'}" title="Pesquisar também na web">${ico('globe')}</button>
      <textarea id="chat-in" rows="1" placeholder="Pergunta ao Claude…" aria-label="Pergunta"></textarea>
      <button class="ibtn solid send" id="chat-send" data-csend aria-label="Enviar">${ico('up')}</button></div>
  </div>`;
  if (!Sync.on()) $('#chat-msgs').innerHTML = `<div class="cempty"><h2>Precisa de sessão do Portal</h2><p>O «Perguntar» usa o Claude através do Supabase do Portal. Entra com a tua conta para usar.</p></div>`;
  else { chatRender(true); chatStore.list().then(() => { if (!CHAT.conv.mensagens.length) chatRender(); }); }
  const inp = $('#chat-in');
  inp.addEventListener('input', () => chatGrow(inp));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && isDesk()) { e.preventDefault(); $('#chat-send').click(); } });
  view.oninput = null; view.onchange = null;
  view.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-back]')) { if (CHAT.busy) CHAT.abort?.abort(); return goBack(m ? '#/r/' + m.id : '#/'); }
    if (t.closest('[data-clist]')) return chatListSheet();
    if (t.closest('[data-cnew]')) { if (CHAT.busy) return; return go(m ? '#/perguntar/r-' + m.id + '?' + Date.now() : '#/perguntar?' + Date.now()); }
    if (t.closest('[data-cweb]')) { S.settings.chatWeb = !S.settings.chatWeb; await saveSettings(); const b = $('#chat-web'); b.classList.toggle('on', !!S.settings.chatWeb); b.setAttribute('aria-pressed', S.settings.chatWeb ? 'true' : 'false'); return toast(S.settings.chatWeb ? 'Pesquisa na web ligada' : 'Pesquisa na web desligada'); }
    if (t.closest('[data-csend]')) {
      if (CHAT.busy) { CHAT.abort?.abort(); return; }
      const v = inp.value.trim(); if (!v) return inp.focus();
      inp.value = ''; chatGrow(inp); return chatSend(v);
    }
    const sg = t.closest('[data-csugg]'); if (sg) { inp.value = sg.dataset.csugg; chatGrow(inp); inp.focus(); return; }
    const cp = t.closest('[data-ccopy]'); if (cp) { await copyText(CHAT._texts[+cp.dataset.ccopy] || ''); return toast('Copiado'); }
    const cj = t.closest('[data-cjoin]'); if (cj) {
      const mm = getM(CHAT.conv.reuniaoId); if (!mm) return;
      const txt = (CHAT._texts[+cj.dataset.cjoin] || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim()).filter(Boolean).join('\n');
      mm.raw = [(mm.raw || '').trim(), txt].filter(Boolean).join('\n'); touchMeeting(mm); return toast('Juntado às notas da reunião');
    }
  };
}
