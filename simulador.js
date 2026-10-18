/* Debrief — simulador de taxas e incentivos da rota. Carregado só quando é usado. */
// Motor de cálculo do Simulador de Taxas 2026 (copiado do simulador, sem alterações à lógica).
// As tabelas (TARIFAS) não estão aqui: vêm do Supabase, só com login.
function criarMotor(TARIFAS) {
  const r2 = (x) => (Math.round(Math.round(x * 1e6) / 1e4) / 100) || 0; // arredonda ao cêntimo, tolerando erro binário

  function apDef(code) {
    const a = TARIFAS.aeroportos[code];
    if (!a) throw new Error("Aeroporto desconhecido: " + code);
    if (a.ref) return Object.assign({}, TARIFAS[a.ref], a, { codigo: code });
    return Object.assign({ codigo: code }, a);
  }
  function grupoRuido(code) {
    const a = TARIFAS.aeroportos[code];
    if (a.ref) return a.ref;           // AZO
    if (a.grupo === "Madeira") return "MAD";
    return code;
  }
  function epocaDe(ap, mes) {
    for (const [k, e] of Object.entries(ap.epocas)) if (e.meses.includes(mes)) return k;
    return Object.keys(ap.epocas)[0];
  }
  // Verão IATA: do último domingo de março ao sábado anterior ao último domingo de outubro
  function lastSunday(y, m0) { const d = new Date(Date.UTC(y, m0 + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; }
  function veraoIATA(date) {
    const y = date.getUTCFullYear();
    const ini = lastSunday(y, 2), fim = lastSunday(y, 9);
    return date >= ini && date < fim;
  }
  // Escalões cumulativos: o PMD acima de cada limite paga a taxa do escalão seguinte
  function escalonado(pmd, limites, taxas) {
    let prev = 0, soma = 0, detalhe = [];
    for (let i = 0; i < taxas.length; i++) {
      const cap = limites[i] ?? Infinity;
      const span = Math.min(pmd, cap) - prev;
      if (span <= 0) break;
      soma += span * taxas[i]; detalhe.push({ ton: span, taxa: taxas[i] });
      prev = cap;
    }
    return { total: soma, detalhe };
  }

  // ---------- entrada normalizada ----------
  // in = { aeroporto, data (Date UTC), pmd (t), ruido ("R5"|null), modRuido (bool),
  //   tipoOp: "comercial"|"geral"|"treino"|"tecnica"|"estado", noturno (bool), rotaPXO (bool),
  //   destino: "S"|"UE"|"INT"|"ILHAS"|"PXO",
  //   paxLocais, paxTransf, paxTransito, bebes, paxInterIlhas,
  //   chegada (min do dia), partida (min do dia), diasExtra (int), areaManut (bool),
  //   sobretaxaPeriodos, pontes (n), pontesMin, gpsMin, balcoes, balcoesMin,
  //   bagagens, sbd, brsOn, abertura: null|"prolongamento"|"comercial"|"emergencia", aberturaHoras,
  //   abrigoDias, slots (n), terminalFormula (bool) }
  function calcular(inp) {
    const ap = apDef(inp.aeroporto);
    const mes = inp.data.getUTCMonth() + 1;
    const ep = epocaDe(ap, mes);
    const L = []; const avisos = []; const notas = [];
    const add = (grupo, taxa, entidade, qtd, unidade, unit, total, nota) =>
      L.push({ grupo, taxa, entidade, qtd, unidade, unit, total: r2(total), nota: nota || "" });

    const pmd = Math.max(0, +inp.pmd || 0);
    const isento = inp.tipoOp === "estado";
    const geral = inp.tipoOp === "geral";
    const treino = inp.tipoOp === "treino";
    const tecnica = inp.tipoOp === "tecnica";
    if (inp.tipoOp === "geral") { inp = Object.assign({}, inp, { pontes: 0, pontesMin: 0, gpsMin: 0, balcoes: 0, bagagens: 0, sbd: 0 }); notas.push("Aviação geral: sem pontes, GPS, check-in nem bagagem; PMR não aplicável."); }
    if (inp.tipoOp === "carga") { inp = Object.assign({}, inp, { paxLocais: 0, paxTransf: 0, paxTransito: 0, bebes: 0, paxInterIlhas: 0, balcoes: 0, bagagens: 0, sbd: 0, pontes: 0, pontesMin: 0, gpsMin: 0, sobretaxaPeriodos: 0, abrigoDias: 0 }); }

    // ---------- ATERRAGEM / DESCOLAGEM ----------
    let atDef = ap.aterragem ? ap.aterragem[ep] : null;
    let atEntidade = "ANA";
    if (ap.aterragemRef) { // Beja: tarifa de Faro, cobrada pela FAP
      const ref = apDef(ap.aterragemRef);
      atDef = ref.aterragem[epocaDe(ref, mes)]; atEntidade = ap.aterragemEntidade || "FAP";
      notas.push("Aterragem em Beja cobrada pela FAP ao valor praticado em Faro (protocolo FAP/ANA).");
    }
    if (isento) {
      add("Tráfego", "Aterragem/descolagem", atEntidade, 1, "operação", 0, 0, "Isenta (operação de Estado / militar / SAR)");
    } else if (tecnica && ap.escalaTecnicaTon != null) {
      add("Tráfego", "Aterragem/descolagem (escala técnica)", atEntidade, pmd, "t", ap.escalaTecnicaTon, pmd * ap.escalaTecnicaTon);
    } else if (atDef) {
      const tab = (inp.rotaPXO && atDef.pxo) ? atDef.pxo : atDef;
      const fator = (inp.modRuido && inp.ruido && TARIFAS.ruido[grupoRuido(ap.codigo)]?.[inp.ruido]) || 1;
      const base = escalonado(pmd, tab.escaloes, tab.base.map(t => t * fator));
      let total = base.total; let nota = [];
      if (tab.minimo != null && total < tab.minimo) { total = tab.minimo; nota.push("valor mínimo"); }
      if (tab.minimoNoturno != null && inp.noturno && total < tab.minimoNoturno) { total = tab.minimoNoturno; nota.push("mínimo noturno"); }
      if (fator !== 1) nota.push(`fator ruído ${inp.ruido} × ${fator}`);
      if (inp.rotaPXO && atDef.pxo) nota.push("tarifa Madeira↔Porto Santo");
      if (treino) { total *= 0.5; nota.push("−50% voo de treino/instrução"); }
      add("Tráfego", "Aterragem/descolagem", atEntidade, pmd, "t PMD", r2(total / (pmd || 1)), total, nota.join(" · "));
      if (atDef.adicional) {
        let adT = escalonado(pmd, atDef.escaloes, atDef.adicional).total;
        let n = "";
        if (atDef.minimoAdicional != null && adT < atDef.minimoAdicional) { adT = atDef.minimoAdicional; n = "valor mínimo"; }
        if (treino) adT *= 0.5;
        add("Tráfego", "Aterragem — adicional (ajust. N-2)", atEntidade, pmd, "t PMD", r2(adT / (pmd || 1)), adT, n);
      }
    }

    // ---------- ESTACIONAMENTO ----------
    const est = ap.estacionamento;
    let minTotal = inp.partida - inp.chegada;
    if (minTotal < 0) minTotal += 1440;
    minTotal += (inp.diasExtra || 0) * 1440;
    const horas = minTotal / 60;
    if (est) {
      let total = 0, nota = [], qtd = minTotal, unidade = "min", unit = 0;
      if (isento && minTotal <= 2880) { nota.push("isento nas primeiras 48h (operação de Estado)"); }
      else if (est.tipo === "LIS") {
        // minutos cobráveis nas primeiras 24h, excluindo 00h–06h
        const primeiras = Math.min(minTotal, 1440);
        let exentos = 0;
        for (let m = 0; m < primeiras; m++) { const hod = ((inp.chegada + m) % 1440 + 1440) % 1440; if (hod >= est.isencaoNoturna[0] * 60 && hod < est.isencaoNoturna[1] * 60) exentos++; }
        const cobr = primeiras - exentos;
        const blocos = minTotal > 4320 ? 3 : minTotal > 2880 ? 2 : minTotal > 1440 ? 1 : 0;
        if (pmd <= 45) {
          total = cobr * est.ate45.minuto; unit = est.ate45.minuto;
          for (let i = 0; i < blocos; i++) total += est.ate45.blocos[i];
        } else {
          total = cobr * pmd * est.mais45.minutoTon; unit = r2(est.mais45.minutoTon * pmd); unidade = "min × PMD";
          for (let i = 0; i < blocos; i++) total += est.mais45.blocosTon[i] * pmd;
        }
        if (exentos) nota.push(`${exentos} min isentos (00h–06h)`);
        if (blocos) nota.push(`+${blocos} escalão(ões) acima de 24h`);
        qtd = cobr;
      } else if (est.tipo === "TON24") {
        const livre = est.desdeCalcos ? 0 : (pmd > 100 ? est.isencaoMin.mais100 : est.isencaoMin.ate100);
        if (minTotal <= livre || minTotal === 0) { total = 0; nota.push(`dentro do tempo livre (${livre} min)`); }
        else {
          const periodos = Math.ceil((minTotal - livre) / 1440);
          const taxa = inp.areaManut && est.manutencao24h ? est.manutencao24h : est.porTon24h;
          total = taxa * pmd * periodos; unit = taxa; unidade = `t × ${periodos} período(s) 24h`; qtd = pmd;
          if (livre) nota.push(`${livre} min livres`);
          if (inp.areaManut && est.manutencao24h) nota.push("área de manutenção");
          if (est.minimo != null && total < est.minimo) { total = est.minimo; nota.push("valor mínimo"); }
        }
      }
      add("Tráfego", "Estacionamento", "ANA", qtd, unidade, unit, total, nota.join(" · ") + (minTotal ? ` · ${Math.floor(horas)}h${String(minTotal % 60).padStart(2, "0")} no solo` : ""));
      if (inp.sobretaxaPeriodos > 0) add("Tráfego", "Sobretaxa de remoção", "ANA", inp.sobretaxaPeriodos, "× 15 min", est.sobretaxa15, inp.sobretaxaPeriodos * est.sobretaxa15);
    }

    // ---------- PONTES / GPS ----------
    if (ap.pontes && inp.pontes > 0 && inp.pontesMin > 0) {
      const p = ap.pontes; const m = inp.pontesMin; let total = 0, nota = "";
      if (p.tipo === "faixas") {
        const bandas = escalonado(m, p.faixas, p.porMinuto); total = bandas.total * inp.pontes;
        nota = "faixas ≤30 / 31–60 / 61–90 / >90 min aplicadas de forma marginal";
      } else {
        const n = Math.min(inp.pontes, p.maxPontes);
        const tab = (n >= 2 && p.duasPontes) ? p.duasPontes : p.umaPonte;
        const mult = (n >= 2 && !p.duasPontes) ? n : 1;
        total = (Math.min(m, 120) * tab.ate2h + Math.max(0, m - 120) * tab.apos2h) * mult;
        nota = n >= 2 && p.duasPontes ? "tarifa de 2 pontes" : (mult > 1 ? `${mult} pontes × tarifa de 1 ponte` : "1 ponte");
        if (m > 120) nota += " · minutos além de 2h à tarifa superior";
      }
      add("Tráfego", "Pontes telescópicas", "ANA", m, "min", r2(total / m), total, nota);
    } else if (!ap.pontes && inp.pontes > 0) avisos.push(`${ap.nome}: sem pontes telescópicas tarifadas no guia — não aplicado.`);
    if (ap.gps != null && inp.gpsMin > 0) add("Tráfego", "GPS (400 Hz)", "ANA", inp.gpsMin, "min", ap.gps, inp.gpsMin * ap.gps);
    else if (ap.gps == null && inp.gpsMin > 0) avisos.push(`${ap.nome}: GPS não tarifado no guia — não aplicado.`);

    if (inp.abrigoDias > 0 && ap.abrigo) add("Tráfego", "Abrigo (hangar)", "ANA", pmd * inp.abrigoDias, "t × 24h", ap.abrigo, pmd * inp.abrigoDias * ap.abrigo);

    // ---------- ABERTURA DE AERÓDROMO ----------
    if (inp.abertura && ap.abertura) {
      const taxa = ap.abertura[inp.abertura];
      if (taxa != null) { const per = Math.max(1, Math.ceil((inp.aberturaHoras || 2) / 2)); add("Tráfego", `Abertura de aeródromo — ${inp.abertura}`, ap.codigo === "BEJ" ? "FAP" : "ANA", per, "× 2h", taxa, per * taxa); }
      else avisos.push(`${ap.nome}: tipo de abertura "${inp.abertura}" não tarifado.`);
    } else if (inp.abertura && !ap.abertura) avisos.push(`${ap.nome}: abertura de aeródromo não tarifada no guia.`);

    let pagantes = 0;
    const carga = inp.tipoOp === "carga";
    if (carga) { notas.push("Voo de carga: sem taxas por passageiro, check-in, bagagem, pontes nem GPS."); }
    else {
    // ---------- PASSAGEIROS ----------
    const px = ap.passageiros[ep];
    const locais = Math.max(0, inp.paxLocais | 0), transf = Math.max(0, inp.paxTransf | 0), transito = Math.max(0, inp.paxTransito | 0), bebes = Math.max(0, inp.bebes | 0), inter = Math.max(0, inp.paxInterIlhas | 0);
    const classe = inp.destino === "S" || inp.destino === "ILHAS" || inp.destino === "PXO" ? "S" : "NS";
    pagantes = locais + transf; // embarcados sujeitos a taxa (trânsito direto e bebés isentos)
    const exInter = (ap.ref === "AZO" && inp.destino === "ILHAS") ? Math.min(inter, pagantes) : 0; // transferência inter-ilhas isenta
    const paxServ = pagantes - exInter;
    const isentoPax = isento || treino;
    const sfx = classe === "S" ? "Schengen" : "fora Schengen";
    const notaIsentos = [transito ? `${transito} em trânsito direto` : "", exInter ? `${exInter} em transferência inter-ilhas` : ""].filter(Boolean).join(", ");
    if (isentoPax) {
      add("Passageiros", "Serviço a passageiros", "ANA", pagantes, "pax", 0, 0, treino ? "voo de treino/instrução — isento" : "operação de Estado — isento");
    } else if (inp.destino === "PXO" && px.pxo != null) {
      add("Passageiros", "Serviço a passageiros — Madeira↔Porto Santo", "ANA", paxServ, "pax", px.pxo, paxServ * px.pxo, notaIsentos && `isentos: ${notaIsentos}`);
    } else if (px.transferencia) {
      if (locais) add("Passageiros", `Serviço a passageiros — locais ${sfx}`, "ANA", locais, "pax", px.local[classe], locais * px.local[classe], notaIsentos && `isentos: ${notaIsentos}`);
      if (transf) add("Passageiros", `Serviço a passageiros — transferência ${sfx}`, "ANA", transf, "pax", px.transferencia[classe], transf * px.transferencia[classe]);
    } else {
      add("Passageiros", `Serviço a passageiros — ${sfx}`, "ANA", paxServ, "pax", px.local[classe], paxServ * px.local[classe], notaIsentos && `isentos: ${notaIsentos}`);
    }
    // Segurança ANA, PMR, CUPPS
    const paxSeg = isento ? 0 : paxServ;
    add("Passageiros", "Segurança (ANA)", "ANA", paxSeg, "pax", TARIFAS.comum.segurancaANA, paxSeg * TARIFAS.comum.segurancaANA, isento ? "isento" : "");
    if (!geral) { const n = isentoPax ? 0 : paxSeg; add("Passageiros", "Serviço a PMR", "ANA", n, "pax", TARIFAS.comum.pmr, n * TARIFAS.comum.pmr, isentoPax ? "isento" : ""); }
    if (ap.cupps && pagantes && !isento) add("Passageiros", "CUPPS e CUSS", "ANA", pagantes, "pax", ap.cupps, pagantes * ap.cupps);
    // ANAC
    const anacKey = inp.destino === "UE" ? "ueForaSchengen" : inp.destino === "INT" ? "internacional" : "schengen";
    const anacLabel = { schengen: "Schengen", ueForaSchengen: "intracomunitária fora de Schengen", internacional: "internacional" }[anacKey];
    add("Passageiros", `Segurança ANAC — viagem ${anacLabel}`, "ANAC", paxSeg, "pax", TARIFAS.comum.anac[anacKey], paxSeg * TARIFAS.comum.anac[anacKey], isento ? "isento" : "");
    if (bebes) notas.push(`${bebes} bebé(s) < 2 anos isentos das taxas por passageiro.`);

    // ---------- ASSISTÊNCIA EM ESCALA / BAGAGEM ----------
    if (ap.checkin && inp.balcoes > 0 && inp.balcoesMin > 0) {
      const c = ap.checkin; let total = 0, unidade = "", unit = 0, qtd = 0, nota = "";
      if (c.por15min != null) { qtd = Math.ceil(inp.balcoesMin / 15) * inp.balcoes; unidade = "× 15 min"; unit = c.por15min; total = qtd * unit; nota = `${inp.balcoes} balcão(ões) × ${inp.balcoesMin} min`; }
      else { const extra = Math.max(0, Math.ceil((inp.balcoesMin - 60) / 30)); total = (c.primeiraHora + extra * c.meiaHoraSeguinte) * inp.balcoes; qtd = inp.balcoes; unidade = "balcão"; unit = r2(total / inp.balcoes); nota = `1.ª hora ${c.primeiraHora} € + ${extra} × ½h ${c.meiaHoraSeguinte} €`; }
      add("Assistência", "Balcões de check-in", "ANA", qtd, unidade, unit, total, nota);
    }
    const bags = Math.max(0, inp.bagagens | 0), sbd = Math.min(bags, Math.max(0, inp.sbd | 0));
    if (bags && ap.bagagem) add("Assistência", "Sistema de tratamento de bagagem", "ANA", bags, "bag.", ap.bagagem, bags * ap.bagagem);
    if (sbd && ap.sbd) add("Assistência", "Self-Baggage Drop", "ANA", sbd, "bag.", ap.sbd, sbd * ap.sbd);
    if (bags && ap.brs && inp.brsOn) add("Assistência", "BRS (reconciliação de bagagem)", "ANA", bags, "bag.", ap.brs, bags * ap.brs);

    }
    // ---------- OUTRAS ENTIDADES ----------
    const ct = ap.controloTerminal === "FAP" ? TARIFAS.comum.controloTerminalBeja : TARIFAS.comum.controloTerminal;
    if (!isento) {
      if (inp.terminalFormula && pmd > 0) { const f = Math.pow(pmd / 50, 0.7); add("Navegação", "Controlo de terminal", ap.controloTerminal === "FAP" ? "FAP" : "NAV", 1, "aterragem", ct, ct * f, `taxa unitária × (PMD/50)^0,7 = × ${f.toFixed(3)}`); }
      else add("Navegação", "Controlo de terminal", ap.controloTerminal === "FAP" ? "FAP" : "NAV", 1, "aterragem", ct, ct, "valor fixo do guia");
    }
    if (inp.slots > 0 && ap.slots) {
      const aplica = ap.slots === "sempre" || (ap.slots === "verao" && veraoIATA(inp.data));
      if (aplica) add("Navegação", "Atribuição de faixas horárias (slots)", "NAV", inp.slots, "slot", TARIFAS.comum.slot, inp.slots * TARIFAS.comum.slot, ap.slots === "verao" ? "só no Verão IATA" : "");
      else notas.push("Slots em Faro só são tarifados no Verão IATA — data fora do período.");
    }

    // ---------- TOTAIS ----------
    const porEntidade = {}; const porGrupo = {};
    for (const l of L) { porEntidade[l.entidade] = r2((porEntidade[l.entidade] || 0) + l.total); porGrupo[l.grupo] = r2((porGrupo[l.grupo] || 0) + l.total); }
    const total = r2(L.reduce((s, l) => s + l.total, 0));
    const totalANA = porEntidade.ANA || 0;
    return { aeroporto: ap.codigo, nome: ap.nome, epoca: ep, epocaLabel: ap.epocas[ep].label, linhas: L, porEntidade, porGrupo, total, totalANA,
      pax: pagantes, porPax: pagantes ? r2(total / pagantes) : null, porPaxANA: pagantes ? r2(totalANA / pagantes) : null,
      lugares: inp.lugares || null, porLugar: inp.lugares ? r2(total / inp.lugares) : null, avisos, notas, minutosSolo: minTotal };
  }

  return { calcular, apDef, epocaDe, veraoIATA, escalonado, r2, grupoRuido };
}

/* ---------- épocas IATA e incentivo (versão pura do cálculo do simulador) */
const SIMX = (() => {
  const lastSundayUTC = (y, m0) => { const d = new Date(Date.UTC(y, m0 + 1, 0, 12)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
  function iataSeasons() {
    const out = [];
    for (let y = 2024; y <= 2031; y++) {
      const sIni = lastSundayUTC(y, 2), sFim = new Date(lastSundayUTC(y, 9)); sFim.setUTCDate(sFim.getUTCDate() - 1);
      out.push({ id: 'S' + String(y).slice(2), ini: sIni, fim: sFim });
      const wIni = lastSundayUTC(y, 9), wFim = new Date(lastSundayUTC(y + 1, 2)); wFim.setUTCDate(wFim.getUTCDate() - 1);
      out.push({ id: 'W' + String(y).slice(2), ini: wIni, fim: wFim });
    }
    return out;
  }
  const IATA = iataSeasons();
  function mesesDoPeriodo(per) {
    const out = []; const cur = new Date(Date.UTC(per.ini.getUTCFullYear(), per.ini.getUTCMonth(), 1, 12));
    while (cur <= per.fim) {
      const y = cur.getUTCFullYear(), m = cur.getUTCMonth();
      const mIni = new Date(Date.UTC(y, m, 1, 12)), mFim = new Date(Date.UTC(y, m + 1, 0, 12));
      const a = mIni < per.ini ? per.ini : mIni, b = mFim > per.fim ? per.fim : mFim;
      const dias = Math.round((b - a) / 86400000) + 1;
      out.push({ y, m, dias, rot: dias * per.freq / 7, data: new Date(Date.UTC(y, m, 15, 12)) });
      cur.setUTCMonth(m + 1);
    }
    return out;
  }
  function seasonOf(d) { return IATA.find((x) => d >= x.ini && d <= x.fim) || null; }
  function nextSeasonStart(d) { const s = IATA.find((x) => x.ini > d); return s ? s.ini : d; }
  function seasonList(inicio, nAnos) {
    const out = []; const se = seasonOf(inicio); if (!se) return out; const idx = IATA.indexOf(se);
    for (let k = 0; k < nAnos * 2 && idx + k < IATA.length; k++) { const x = IATA[idx + k]; out.push({ id: x.id, tipo: x.id[0], ano: Math.floor(k / 2), ini: k === 0 ? inicio : x.ini, fim: x.fim }); }
    return out;
  }
  function offpeakAuto(def, partidaMin) { if (!def.janelas) return def.offpeak ? null : 0; return def.janelas.some(([a, b]) => partidaMin >= a && partidaMin < b) ? 100 : 0; }
  // base: { freq, lug, lf, off }
  function calcIncentivo(INC, ap, tipo, inicio, base) {
    const g = INC.grupo[ap]; if (!g) return null; const def = INC[tipo]?.[g]; if (!def) return null;
    const nAnos = def.basico.length; const cols = []; let total = 0, totPax = 0;
    for (const se of seasonList(inicio, nAnos)) {
      const dias = Math.round((se.fim - se.ini) / 86400000) + 1; const semanas = dias / 7;
      let rot = 0, rotSh = 0;
      for (const mm of mesesDoPeriodo({ ini: se.ini, fim: se.fim, freq: base.freq })) { rot += mm.rot; if (se.tipo === 'S' && INC.shoulderMeses.includes(mm.m + 1)) rotSh += mm.rot; }
      const paxRot = base.lug * base.lf / 100; const pax = rot * paxRot, paxSh = rotSh * paxRot; const y = se.ano;
      const basico = pax * def.basico[y]; const shoulder = def.shoulder && se.tipo === 'S' ? paxSh * def.shoulder[y] : 0;
      const inverno = se.tipo === 'W' ? pax * def.inverno[y] : 0; const offp = def.offpeak ? pax * (base.off / 100) * def.offpeak[y] : 0;
      const okFreq = base.freq >= def.minFreq[se.tipo], okSem = semanas >= def.minSemanas[se.tipo]; const eleg = okFreq && okSem;
      const potencial = basico + shoulder + inverno + offp; const sub = eleg ? potencial : 0;
      total += sub; totPax += pax;
      cols.push({ se, semanas, rot, pax, sub, potencial, eleg, okFreq, okSem });
    }
    return { ap, g, def, tipo, nAnos, cols, total, totPax, porPax: totPax ? total / totPax : 0 };
  }
  return { IATA, mesesDoPeriodo, seasonOf, nextSeasonStart, seasonList, offpeakAuto, calcIncentivo };
})();

/* ---------- ecrã de simulação */
const eur = (x) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(x || 0);
const eur2 = (x) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x || 0);
const int0 = (x) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(x || 0);
const ymdU = (d) => d.toISOString().slice(0, 10);
const seasonLabel = (id) => (id[0] === 'S' ? 'Verão ' : 'Inverno ') + id.slice(1) + (id[0] === 'W' ? '/' + (+id.slice(1) + 1) : '');
const tminS = (v) => { const [h, mm] = String(v || '0:0').split(':').map(Number); return (h || 0) * 60 + (mm || 0); };

function simOperators(ref, airlineName) {
  const n = norm(airlineName || ''); if (!n) return [];
  return Object.entries(ref.aeronaves.operators || {}).filter(([, nm]) => { const x = norm(nm); return x && (x === n || x.includes(n) || n.includes(x)); }).map(([k]) => k);
}
function simDefaults(ref, m) {
  const ops = simOperators(ref, m.airlineName);
  const types = ref.aeronaves.types;
  const t = (ops.length && types.find((x) => (x.ops || []).some((o) => ops.includes(o)))) || types.find((x) => x.icao === 'A320') || types[0];
  const apOk = ref.tarifas.aeroportos[(S.settings.airportCode || 'OPO').toUpperCase()] ? (S.settings.airportCode || 'OPO').toUpperCase() : 'OPO';
  return {
    ap: apOk, destino: 'S', tipo: t.icao, pmd: t.mtow, lugares: t.cap || 180, ruido: t.noise || '',
    freq: 3, inicio: ymdU(SIMX.nextSeasonStart(new Date())), partida: '11:00', lf: 85, incTipo: 'nova',
    solo: 60, pontes: 1, gps: 30, balcoes: 2, balcoesMin: 120, bagPax: 0.6, transf: 0, externo: false,
  };
}
function simInputs(p, apCode, date) {
  const pax = Math.round((p.lugares || 0) * (p.lf || 0) / 100);
  const transf = Math.min(pax, Math.max(0, +p.transf || 0));
  const chegada = 600;
  return {
    aeroporto: apCode, data: date, pmd: +p.pmd || 0, lugares: +p.lugares || 0, ruido: p.ruido || null, modRuido: !p.externo,
    tipoOp: 'comercial', carga: false, noturno: false, rotaPXO: false, destino: p.destino,
    paxLocais: pax - transf, paxTransf: transf, paxTransito: 0, bebes: 0, paxInterIlhas: 0,
    chegada, partida: chegada + Math.max(0, +p.solo || 0), diasExtra: 0, areaManut: false, sobretaxaPeriodos: 0,
    pontes: +p.pontes || 0, pontesMin: (+p.pontes || 0) ? Math.max(0, +p.solo || 0) : 0, gpsMin: +p.gps || 0,
    balcoes: +p.balcoes || 0, balcoesMin: +p.balcoesMin || 0, bagagens: Math.round(pax * (+p.bagPax || 0)), sbd: 0, brsOn: true,
    abertura: null, aberturaHoras: 2, abrigoDias: 0, slots: 2, terminalFormula: true,
  };
}
function simCompute(ref, p) {
  const M = criarMotor(ref.tarifas);
  const inicio = new Date((p.inicio || ymdU(new Date())) + 'T12:00:00Z');
  const partidaMin = tminS(p.partida);
  const g = ref.incentivos.grupo[p.ap];
  const def = g ? ref.incentivos[p.incTipo]?.[g] : null;
  const offAuto = def ? SIMX.offpeakAuto(def, partidaMin) : 0;
  const off = offAuto == null ? (+p.off || 0) : offAuto;
  const inc = def ? SIMX.calcIncentivo(ref.incentivos, p.ap, p.incTipo, inicio, { freq: +p.freq || 0, lug: +p.lugares || 0, lf: +p.lf || 0, off }) : null;
  // taxas por rotação (época de início) e no período do incentivo (ou 1 ano)
  const rot1 = M.calcular(simInputs(p, p.ap, inicio));
  const seasons = inc ? inc.cols.map((c) => c.se) : SIMX.seasonList(inicio, 1);
  let taxasANA = 0, taxasTot = 0, rotTot = 0, paxTot = 0;
  const porEpoca = seasons.map((se) => {
    let a = 0, t = 0, r = 0;
    for (const mm of SIMX.mesesDoPeriodo({ ini: se.ini, fim: se.fim, freq: +p.freq || 0 })) { const res = M.calcular(simInputs(p, p.ap, mm.data)); a += res.totalANA * mm.rot; t += res.total * mm.rot; r += mm.rot; }
    taxasANA += a; taxasTot += t; rotTot += r; paxTot += r * (+p.lugares || 0) * (+p.lf || 0) / 100;
    return { id: se.id, a, t, r };
  });
  // comparação com os outros aeroportos do continente para a mesma rotação
  const cmp = ['OPO', 'LIS', 'FAO'].filter((c) => c !== p.ap && ref.tarifas.aeroportos[c]).map((c) => { const r = M.calcular(simInputs(p, c, inicio)); return { ap: c, nome: r.nome, total: r.total, totalANA: r.totalANA }; });
  const fimProg = SIMX.IATA.find((x) => x.id === 'W27')?.fim;
  const avisos = [...rot1.avisos];
  if (inc) {
    for (const c of inc.cols.filter((c) => !c.eleg)) avisos.push(`${seasonLabel(c.se.id)}: não elegível — ${!c.okFreq ? `${p.freq} voo${+p.freq === 1 ? '' : 's'}/semana, abaixo do mínimo de ${inc.def.minFreq[c.se.tipo]}` : ''}${!c.okFreq && !c.okSem ? '; ' : ''}${!c.okSem ? `${(Math.round(c.semanas * 10) / 10).toString().replace('.', ',')} semanas, abaixo do mínimo de ${inc.def.minSemanas[c.se.tipo]}` : ''} (perde ${eur(c.potencial)}).`);
    if (fimProg && inc.cols.some((c) => c.se.fim > fimProg)) avisos.push('O programa de incentivos termina no fim do Inverno 27/28; as épocas seguintes não estão cobertas.');
  } else if (!g) avisos.push(`${ref.tarifas.aeroportos[p.ap]?.nome || p.ap}: sem programa de incentivos Non-Based.`);
  const anoInc = (y) => inc ? inc.cols.filter((c) => c.se.ano === y).reduce((s, c) => s + c.sub, 0) : 0;
  return {
    inc, off, offAuto, rot1, porEpoca, taxasANA, taxasTot, rotTot, paxTot, cmp, avisos,
    resumo: {
      incTotal: inc ? inc.total : 0, inc1: anoInc(0), inc2: anoInc(1), porPax: inc ? inc.porPax : 0, anos: inc ? inc.nAnos : 0,
      rotTotal: rot1.total, rotANA: rot1.totalANA, rotPorPax: rot1.porPax || 0, taxasANA, liquido: taxasANA - (inc ? inc.total : 0),
      cobertura: taxasANA && inc ? inc.total / taxasANA : 0, eleg: inc ? inc.cols.every((c) => c.eleg) : false,
    },
  };
}
function simSummaryLine(s) {
  const p = s.p, r = s.r;
  const a = `${p.ap} · ${p.freq}×/sem · ${p.tipo} ${p.lugares} lug. · LF ${p.lf}% · desde ${String(p.inicio).split('-').reverse().join('/')}`;
  const b = r.anos ? `incentivo ${r.anos === 2 ? '2 anos' : '1 ano'} ${eur(r.incTotal)} (${eur2(r.porPax)}/pax)` : 'sem incentivo';
  return { a, b: `${b} · taxas/rotação ${eur(r.rotTotal)}` };
}
function simText(m, s) {
  const p = s.p, r = s.r;
  return [`Simulação ${m.airlineName || ''} — ${p.ap}`, `${p.freq} voos/semana · ${p.tipo} (${p.lugares} lugares, PMD ${p.pmd} t) · LF ${p.lf}% · início ${String(p.inicio).split('-').reverse().join('/')} · partida ${p.partida}`,
    r.anos ? `Incentivo ${p.incTipo === 'nova' ? 'nova rota' : '2.ª companhia em monopólio'}: ${eur(r.incTotal)} (ano 1 ${eur(r.inc1)}${r.anos > 1 ? `, ano 2 ${eur(r.inc2)}` : ''}) · ${eur2(r.porPax)} por passageiro de partida` : 'Sem incentivo neste aeroporto',
    `Taxas por rotação: ${eur(r.rotTotal)} (ANA ${eur(r.rotANA)}) · ${eur2(r.rotPorPax)} por passageiro`,
    r.anos ? `Taxas ANA no período: ${eur(r.taxasANA)} · líquidas de incentivo ${eur(r.liquido)} (incentivo cobre ${Math.round(r.cobertura * 100)}%)` : '',
    'Simulação indicativa (Guia de Taxas Reguladas 2026 e programa Non-Based 2024–2028), sem IVA.'].filter(Boolean).join('\n');
}

async function openSimSheet(m, existing, after) {
  let ref;
  try { ref = await SIMREF.get(); } catch (e) { ref = null; }
  if (!ref) return toast(Sync.on() ? 'Não foi possível carregar as tabelas de taxas. Tenta com rede.' : 'As tabelas de taxas precisam de sessão do Portal (abre uma vez com rede).');
  const p = existing ? { ...simDefaults(ref, m), ...existing.p } : simDefaults(ref, m);
  const ops = simOperators(ref, m.airlineName);
  const types = [...ref.aeronaves.types];
  const mine = types.filter((t) => (t.ops || []).some((o) => ops.includes(o)));
  const opt = (t) => `<option value="${esc(t.icao)}">${esc(t.icao)} · ${esc(t.desc)}</option>`;
  const aps = Object.entries(ref.tarifas.aeroportos).map(([k, a]) => `<option value="${k}">${esc(a.nome)} (${k})</option>`).join('');
  const f = (k, label, type = 'number', extra = '') => `<div class="field"><label class="lbl" for="sm-${k}">${label}</label><input class="inp" id="sm-${k}" data-sp="${k}" type="${type}" ${extra}></div>`;
  const sh = sheet({
    title: `Simular rota${m.airlineName ? ' · ' + esc(m.airlineName) : ''}`, wide: true,
    body: `<div class="sim-sum" id="sm-sum"></div><div class="sim">
      <div class="sim-form">
        <div class="grid2"><div class="field"><label class="lbl" for="sm-ap">Aeroporto</label><select class="inp" id="sm-ap" data-sp="ap">${aps}</select></div>
        <div class="field"><label class="lbl" for="sm-destino">Destino</label><select class="inp" id="sm-destino" data-sp="destino"><option value="S">Schengen</option><option value="UE">UE fora de Schengen</option><option value="INT">Internacional</option></select></div></div>
        <div class="field"><label class="lbl" for="sm-tipo">Aeronave${mine.length ? ` <span class="faint" style="font-weight:500">(primeiro as usadas pela ${esc(m.airlineName)})</span>` : ''}</label><select class="inp" id="sm-tipo" data-sp="tipo">${mine.length ? `<optgroup label="${esc(m.airlineName)}">${mine.map(opt).join('')}</optgroup><optgroup label="Todas">` : ''}${types.filter((t) => !mine.includes(t)).map(opt).join('')}${mine.length ? '</optgroup>' : ''}</select></div>
        <div class="g3">${f('pmd', 'PMD (t)', 'number', 'step="0.1" min="0"')}${f('lugares', 'Lugares', 'number', 'min="0"')}<div class="field"><label class="lbl" for="sm-ruido">Ruído</label><select class="inp" id="sm-ruido" data-sp="ruido"><option value="">—</option>${['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'].map((r) => `<option>${r}</option>`).join('')}</select></div></div>
        <div class="g3">${f('freq', 'Voos / semana', 'number', 'min="0" max="70"')}${f('lf', 'Load factor %', 'number', 'min="0" max="100"')}${f('partida', 'Partida', 'time')}</div>
        <div class="grid2">${f('inicio', 'Início da operação', 'date')}<div class="field"><label class="lbl" for="sm-incTipo">Incentivo</label><select class="inp" id="sm-incTipo" data-sp="incTipo"><option value="nova">Nova rota (2 anos)</option><option value="monopolio">2.ª companhia em monopólio (1 ano)</option></select></div></div>
        <div class="field" id="sm-offf" hidden>${''}<label class="lbl" for="sm-off">Partidas em off-peak %</label><input class="inp" id="sm-off" data-sp="off" type="number" min="0" max="100" step="5"></div>
        <details class="raw"><summary>Operação no solo e assistência</summary><div style="padding-top:8px">
          <div class="g3">${f('solo', 'Tempo no solo (min)', 'number', 'min="0" step="5"')}<div class="field"><label class="lbl" for="sm-pontes">Pontes</label><select class="inp" id="sm-pontes" data-sp="pontes"><option value="0">Sem ponte</option><option value="1">1 ponte</option><option value="2">2 pontes</option></select></div>${f('gps', 'GPS (min)', 'number', 'min="0" step="5"')}</div>
          <div class="g3">${f('balcoes', 'Balcões check-in', 'number', 'min="0"')}${f('balcoesMin', 'Min. / balcão', 'number', 'min="0" step="15"')}${f('bagPax', 'Bagagens / pax', 'number', 'min="0" step="0.1"')}</div>
          ${f('transf', 'Passageiros em transferência (por voo)', 'number', 'min="0"')}
        </div></details>
        <label class="check" style="margin-top:10px;align-items:flex-start"><input type="checkbox" class="ck" id="sm-externo" data-sp="externo"><span>Vista para a companhia<span class="faint" style="display:block;font-size:12.5px">Sem a modulação interna por ruído, para mostrar o ecrã à companhia.</span></span></label>
      </div>
      <div class="sim-res" id="sm-res"></div>
    </div>`,
    foot: `<button class="btn" data-close>Fechar</button><button class="btn" data-smcopy aria-label="Copiar resumo">${ico('copy', 'sm')}<span class="hide-s"> Copiar</span></button><button class="btn pri" data-smsave>${ico('check', 'sm')} Guardar<span class="hide-s"> na reunião</span></button>`,
  });
  const root = sh.el;
  root.querySelector('.sheet')?.classList.add('xwide');
  const setVals = () => { for (const el of root.querySelectorAll('[data-sp]')) { const k = el.dataset.sp; if (el.type === 'checkbox') el.checked = !!p[k]; else el.value = p[k] ?? ''; } };
  setVals();
  let last = null;
  const render = () => {
    const R = simCompute(ref, p); last = R; const r = R.resumo;
    root.querySelector('#sm-sum').innerHTML = `<div><span>Incentivo</span><b>${R.inc ? eur(r.incTotal) : '—'}</b></div><div><span>Taxas / rotação</span><b>${eur(r.rotTotal)}</b></div><div><span>Por pax</span><b>${R.inc ? eur2(r.porPax) : '—'}</b></div>`;
    const offF = root.querySelector('#sm-offf'); offF.hidden = !(R.inc && R.offAuto == null && R.inc.def.offpeak);
    const tile = (k, v, d, cls = '') => `<div class="stile ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
    const offTxt = R.inc && R.inc.def.offpeak ? (R.offAuto == null ? `off-peak: ${R.off}% das partidas` : R.offAuto ? 'partida em off-peak (+ mark-up)' : `fora do off-peak (${R.inc.def.offpeakDef})`) : '';
    root.querySelector('#sm-res').innerHTML = `
      <div class="stiles">
        ${R.inc ? tile(`Incentivo · ${R.inc.nAnos === 2 ? '2 anos' : '1 ano'}`, eur(r.incTotal), `${int0(R.inc.totPax)} pax de partida${r.eleg ? '' : ' · <b>há épocas não elegíveis</b>'}`, 'ok') : tile('Incentivo', '—', 'sem programa neste aeroporto')}
        ${R.inc ? tile('Ano 1', eur(r.inc1), R.inc.cols.filter((c) => c.se.ano === 0).map((c) => `${c.se.id} ${eur(c.sub)}`).join(' · ')) : ''}
        ${R.inc && R.inc.nAnos > 1 ? tile('Ano 2', eur(r.inc2), R.inc.cols.filter((c) => c.se.ano === 1).map((c) => `${c.se.id} ${eur(c.sub)}`).join(' · ')) : ''}
        ${R.inc ? tile('Por passageiro', eur2(r.porPax), offTxt) : ''}
      </div>
      <div class="ssec"><div class="prep-h">Taxas</div>
        <div class="srow"><span>Por rotação (${esc(R.rot1.epocaLabel)})</span><b>${eur(r.rotTotal)}</b></div>
        <div class="srow sub"><span>das quais ANA</span><span>${eur(r.rotANA)}</span></div>
        <div class="srow sub"><span>por passageiro</span><span>${eur2(r.rotPorPax)}</span></div>
        <div class="srow"><span>Taxas ANA no período (${int0(R.rotTot)} rotações)</span><b>${eur(r.taxasANA)}</b></div>
        ${R.inc ? `<div class="srow"><span>Taxas ANA líquidas de incentivo</span><b>${eur(r.liquido)}</b></div><div class="scover"><i style="width:${Math.min(100, r.cobertura * 100).toFixed(1)}%"></i></div><div class="faint" style="font-size:12.5px">O incentivo cobre ${Math.round(r.cobertura * 100)}% das taxas ANA estimadas</div>` : ''}
      </div>
      ${R.inc ? `<div class="ssec"><div class="prep-h">Por época IATA</div><table class="stbl"><thead><tr><th>Época</th><th class="n">Rotações</th><th class="n">Pax</th><th class="n">Incentivo</th></tr></thead><tbody>${R.inc.cols.map((c) => `<tr class="${c.eleg ? '' : 'no'}"><td>${seasonLabel(c.se.id)}<span class="sh">ano ${c.se.ano + 1}</span></td><td class="n">${int0(c.rot)}</td><td class="n">${int0(c.pax)}</td><td class="n">${c.eleg ? eur(c.sub) : '<span class="nochip">não elegível</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${R.cmp.length ? `<div class="ssec"><div class="prep-h">A mesma rotação noutros aeroportos</div>${R.cmp.map((c) => { const d = r.rotTotal ? (c.total - r.rotTotal) / r.rotTotal * 100 : 0; return `<div class="srow"><span>${esc(c.nome)}</span><span>${eur(c.total)} <span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${Math.round(d)}%</span></span></div>`; }).join('')}<div class="faint" style="font-size:12px">Só taxas (sem incentivos), mesma aeronave, passageiros e tempo no solo.</div></div>` : ''}
      ${R.avisos.length ? `<div class="ssec">${R.avisos.map((a) => `<div class="smsg">${esc(a)}</div>`).join('')}</div>` : ''}
      <p class="faint" style="font-size:12px;margin:12px 0 0">Simulação indicativa · ${esc(ref.tarifas.versao || 'Guia de Taxas 2026')} · ${esc(ref.incentivos.versao || '')} · sem IVA. O incentivo é pago por passageiro de partida com os dados de tráfego da ANA.</p>`;
  };
  render();
  root.addEventListener('input', (e) => {
    const el = e.target; const k = el.dataset.sp; if (!k) return;
    p[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value);
    if (k === 'tipo') { const t = ref.aeronaves.types.find((x) => x.icao === el.value); if (t) { p.pmd = t.mtow; p.lugares = t.cap || p.lugares; p.ruido = t.noise || ''; setVals(); } }
    render();
  });
  root.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') e.target.dispatchEvent(new Event('input', { bubbles: true })); }, { once: false });
  root.querySelector('[data-smcopy]').onclick = async () => { const s = { p: { ...p }, r: last.resumo }; await copyText(simText(m, s)); toast('Resumo copiado'); };
  root.querySelector('[data-smsave]').onclick = () => {
    const s = { id: existing?.id || uid(), em: Date.now(), por: Sync.userName || S.settings.ownerName || '', p: { ...p }, r: { ...last.resumo } };
    m.sims = Array.isArray(m.sims) ? m.sims : [];
    const i = m.sims.findIndex((x) => x.id === s.id); if (i >= 0) m.sims[i] = s; else m.sims.push(s);
    sh.close(); toast('Simulação guardada na reunião'); after && after();
  };
}
