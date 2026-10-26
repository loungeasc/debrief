#!/usr/bin/env python3
"""Debrief — Schedule: lê o relatório «Schedule Report By Day» (xlsx) e resume-o por destino e companhia.

Uso:  python3 -I tools/schedule.py <relatorio.xlsx> <época, ex.: W26> <início AAAA-MM-DD> <fim AAAA-MM-DD> > schedule.json

O resultado (JSON) vai para a tabela crm_referencia (chave 'schedule'), só com login.
Os dados do schedule NÃO ficam neste repositório público: só este script e os nomes de aeroportos e companhias.
"""
import collections
import datetime as dt
import json
import sys

import openpyxl

# Companhias: código ICAO → (nome, código IATA)
AIRLINES = {
    'AEA': ('Air Europa', 'UX'), 'AEE': ('Aegean Airlines', 'A3'), 'AFR': ('Air France', 'AF'),
    'ANE': ('Air Nostrum', 'YW'), 'AWC': ('Titan Airways', 'ZT'), 'AZU': ('Azul', 'AD'),
    'BEL': ('Brussels Airlines', 'SN'), 'CCM': ('Air Corsica', 'XK'), 'DAL': ('Delta Air Lines', 'DL'),
    'DLH': ('Lufthansa', 'LH'), 'DTA': ('TAAG Angola Airlines', 'DT'), 'EFW': ('British Airways (BA Euroflyer)', 'BA'),
    'EJU': ('easyJet Europe', 'U2'), 'ELY': ('El Al', 'LY'), 'ENT': ('Enter Air', 'E4'),
    'ETH': ('Ethiopian Airlines', 'ET'), 'EWG': ('Eurowings', 'EW'), 'EXS': ('Jet2', 'LS'),
    'EZS': ('easyJet Switzerland', 'DS'), 'EZY': ('easyJet UK', 'U2'), 'IBE': ('Iberia', 'IB'),
    'ISR': ('Israir', '6H'), 'KLM': ('KLM', 'KL'), 'LGL': ('Luxair', 'LG'), 'LOT': ('LOT Polish Airlines', 'LO'),
    'NMA': ('Nesma Airlines', 'NE'), 'NOS': ('Neos', 'NO'), 'PVG': ('Privilege Style', 'P6'),
    'RAM': ('Royal Air Maroc', 'AT'), 'RUK': ('Ryanair UK', 'RK'), 'RYR': ('Ryanair', 'FR'),
    'RZO': ('Azores Airlines', 'S4'), 'SAS': ('SAS', 'SK'), 'SWR': ('SWISS', 'LX'), 'TAP': ('TAP Air Portugal', 'TP'),
    'THY': ('Turkish Airlines', 'TK'), 'TOM': ('TUI Airways', 'BY'), 'TRA': ('Transavia', 'HV'),
    'TSC': ('Air Transat', 'TS'), 'TVF': ('Transavia France', 'TO'), 'TVS': ('Smartwings', 'QS'),
    'UAL': ('United Airlines', 'UA'), 'VLG': ('Vueling', 'VY'), 'VOE': ('Volotea', 'V7'),
    'WMT': ('Wizz Air Malta', 'W4'), 'WZZ': ('Wizz Air', 'W6'),
}
# Aeroportos: IATA → (cidade, aeroporto quando a cidade tem mais do que um, nomes extra para a pesquisa)
AIRPORTS = {
    'AAR': ('Aarhus', '', ''), 'ADD': ('Adis Abeba', '', 'Addis Ababa'), 'AEY': ('Akureyri', '', ''),
    'AGP': ('Málaga', '', ''), 'AJA': ('Ajaccio', '', 'Corsica Córsega'), 'ALC': ('Alicante', '', ''),
    'AMS': ('Amesterdão', 'Schiphol', 'Amsterdam'), 'ARN': ('Estocolmo', 'Arlanda', 'Stockholm'),
    'ATH': ('Atenas', '', 'Athens'), 'BCN': ('Barcelona', '', ''), 'BER': ('Berlim', '', 'Berlin'),
    'BFS': ('Belfast', '', ''), 'BGO': ('Bergen', '', ''), 'BGY': ('Milão', 'Bergamo', 'Milan Bergamo'),
    'BHX': ('Birmingham', '', ''), 'BIO': ('Bilbau', '', 'Bilbao'), 'BLQ': ('Bolonha', '', 'Bologna'),
    'BOD': ('Bordéus', '', 'Bordeaux'), 'BOS': ('Boston', '', ''), 'BRS': ('Bristol', '', ''),
    'BRU': ('Bruxelas', 'Zaventem', 'Brussels'), 'BSL': ('Basileia-Mulhouse', '', 'Basel Mulhouse Freiburg'),
    'BUD': ('Budapeste', '', 'Budapest'), 'BVA': ('Paris', 'Beauvais', ''), 'BVC': ('Boa Vista', '', 'Cabo Verde'),
    'BVE': ('Brive', '', ''), 'CDG': ('Paris', 'Charles de Gaulle', ''), 'CFE': ('Clermont-Ferrand', '', ''),
    'CGN': ('Colónia', '', 'Cologne Köln Bonn'), 'CMN': ('Casablanca', '', ''), 'CPH': ('Copenhaga', '', 'Copenhagen'),
    'CRL': ('Bruxelas', 'Charleroi', 'Brussels'), 'CTA': ('Catânia', '', 'Catania Sicília'), 'CWL': ('Cardiff', '', ''),
    'DLE': ('Dole', '', ''), 'DUB': ('Dublin', '', ''), 'DUS': ('Düsseldorf', '', ''), 'EDI': ('Edimburgo', '', 'Edinburgh'),
    'EIN': ('Eindhoven', '', ''), 'EVN': ('Erevan', '', 'Yerevan'), 'EWR': ('Nova Iorque', 'Newark', 'New York'),
    'FAO': ('Faro', '', ''), 'FCO': ('Roma', 'Fiumicino', 'Rome'), 'FKB': ('Karlsruhe/Baden-Baden', '', ''),
    'FMM': ('Memmingen', '', 'Munique Munich'), 'FNC': ('Funchal', '', 'Madeira'), 'FRA': ('Frankfurt', '', ''),
    'GDN': ('Gdansk', '', 'Gdańsk'), 'GIG': ('Rio de Janeiro', 'Galeão', ''), 'GLA': ('Glasgow', '', ''),
    'GOT': ('Gotemburgo', '', 'Gothenburg Göteborg'), 'GRU': ('São Paulo', 'Guarulhos', ''), 'GRX': ('Granada', '', ''),
    'GVA': ('Genebra', '', 'Geneva Genève'), 'HAM': ('Hamburgo', '', 'Hamburg'), 'HHN': ('Frankfurt', 'Hahn', ''),
    'IST': ('Istambul', '', 'Istanbul'), 'JFK': ('Nova Iorque', 'JFK', 'New York'), 'KRK': ('Cracóvia', '', 'Krakow Kraków'),
    'KTW': ('Katowice', '', ''), 'LAD': ('Luanda', '4 de Fevereiro', ''), 'LBA': ('Leeds Bradford', '', ''),
    'LEN': ('León', '', 'Leon'), 'LGW': ('Londres', 'Gatwick', 'London'), 'LIL': ('Lille', '', ''),
    'LIN': ('Milão', 'Linate', 'Milan'), 'LIS': ('Lisboa', '', 'Lisbon'), 'LPL': ('Liverpool', '', ''),
    'LTN': ('Londres', 'Luton', 'London'), 'LUX': ('Luxemburgo', '', 'Luxembourg'), 'LWN': ('Gyumri', '', 'Arménia'),
    'LYS': ('Lyon', '', 'Lião'), 'MAD': ('Madrid', '', ''), 'MAN': ('Manchester', '', ''), 'MLA': ('Malta', '', ''),
    'MRS': ('Marselha', '', 'Marseille'), 'MUC': ('Munique', '', 'Munich München'), 'MXP': ('Milão', 'Malpensa', 'Milan'),
    'NBJ': ('Luanda', 'Dr. António Agostinho Neto', ''), 'NCE': ('Nice', '', ''), 'NCL': ('Newcastle', '', ''),
    'NRN': ('Düsseldorf', 'Weeze', ''), 'NTE': ('Nantes', '', ''), 'NUE': ('Nuremberga', '', 'Nuremberg Nürnberg'),
    'ORY': ('Paris', 'Orly', ''), 'OTP': ('Bucareste', '', 'Bucharest'), 'OVD': ('Astúrias', '', 'Asturias Oviedo'),
    'PDL': ('Ponta Delgada', '', 'Açores Azores'), 'PMI': ('Palma de Maiorca', '', 'Palma Mallorca'), 'POZ': ('Poznan', '', 'Poznań'),
    'PRG': ('Praga', '', 'Prague'), 'PSA': ('Pisa', '', ''), 'QSR': ('Salerno', '', ''), 'RAI': ('Praia', '', 'Cabo Verde'),
    'RAK': ('Marraquexe', '', 'Marrakech'), 'RBA': ('Rabat', '', ''), 'REC': ('Recife', '', ''), 'RTM': ('Roterdão', '', 'Rotterdam'),
    'SID': ('Sal', '', 'Cabo Verde'), 'SSH': ('Sharm el-Sheikh', '', ''), 'STN': ('Londres', 'Stansted', 'London'),
    'STR': ('Estugarda', '', 'Stuttgart'), 'SVQ': ('Sevilha', '', 'Sevilla Seville'), 'SXB': ('Estrasburgo', '', 'Strasbourg'),
    'TER': ('Terceira', 'Lajes', 'Açores Azores'), 'TFS': ('Tenerife', 'Sul', 'Canárias'), 'TLS': ('Toulouse', '', ''),
    'TLV': ('Telavive', '', 'Tel Aviv'), 'TNG': ('Tânger', '', 'Tangier'), 'TRN': ('Turim', '', 'Turin Torino'),
    'TSF': ('Veneza', 'Treviso', 'Venice'), 'TUF': ('Tours', '', ''), 'VCP': ('Campinas', 'Viracopos', 'São Paulo'),
    'VIE': ('Viena', '', 'Vienna Wien'), 'VLC': ('Valência', '', 'Valencia'), 'VXE': ('São Vicente', '', 'Cabo Verde Mindelo'),
    'WAW': ('Varsóvia', 'Chopin', 'Warsaw'), 'WMI': ('Varsóvia', 'Modlin', 'Warsaw'), 'WRO': ('Wroclaw', '', 'Wrocław'),
    'XCR': ('Paris', 'Vatry', ''), 'YYZ': ('Toronto', '', ''), 'ZAG': ('Zagreb', '', ''), 'ZRH': ('Zurique', '', 'Zurich'),
}
COUNTRIES = {
    'Angola': 'Angola', 'Armenia': 'Arménia', 'Austria': 'Áustria', 'Belgium': 'Bélgica', 'Brazil': 'Brasil',
    'Canada': 'Canadá', 'Cape Verde': 'Cabo Verde', 'Croatia': 'Croácia', 'Czech Republic': 'Chéquia',
    'Denmark': 'Dinamarca', 'Egypt': 'Egito', 'Ethiopia': 'Etiópia', 'France': 'França', 'Germany': 'Alemanha',
    'Greece': 'Grécia', 'Hungary': 'Hungria', 'Iceland': 'Islândia', 'Ireland': 'Irlanda', 'Israel': 'Israel',
    'Italy': 'Itália', 'Luxembourg': 'Luxemburgo', 'Malta': 'Malta', 'Morocco': 'Marrocos', 'Netherlands': 'Países Baixos',
    'Norway': 'Noruega', 'Poland': 'Polónia', 'Portugal': 'Portugal', 'Romania': 'Roménia', 'Spain': 'Espanha',
    'Sweden': 'Suécia', 'Switzerland': 'Suíça', 'Turkey': 'Turquia', 'United Kingdom': 'Reino Unido',
    'United States of America': 'Estados Unidos',
}
COUNTRY_FIX = {'LWN': 'Armenia'}


def main(path, season, d0, d1):
    d0 = dt.date.fromisoformat(d0); d1 = dt.date.fromisoformat(d1)
    wk0 = d0 - dt.timedelta(days=d0.weekday())          # segunda-feira da semana do início
    nw = (d1 - wk0).days // 7 + 1
    full = [w for w in range(nw) if wk0 + dt.timedelta(days=7 * w) >= d0 and wk0 + dt.timedelta(days=7 * w + 6) <= d1]
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    h = rows[0]; ix = {k: i for i, k in enumerate(h)}
    mov = collections.defaultdict(lambda: {'D': [], 'A': []})
    country = {}
    for r in rows[1:]:
        day = r[ix['DOP']]
        if not isinstance(day, dt.datetime): continue
        day = day.date()
        if day < d0 or day > d1: continue
        ap = (r[ix['Origin/Destination']] or '').strip(); al = (r[ix['Airline']] or '').strip()
        if not ap or not al: continue
        t = r[ix['STA/STD']]; hhmm = t.strftime('%H:%M') if isinstance(t, (dt.datetime, dt.time)) else ''
        country.setdefault(ap, r[ix['Country']] or COUNTRY_FIX.get(ap, ''))
        mov[(ap, al)][(r[ix['Mov Type']] or 'D')[0]].append({
            'd': day, 'h': hhmm, 'ac': r[ix['AC']] or '', 'cap': int(r[ix['Capacity']] or 0),
            'st': r[ix['Service Type']] or '', 'via': (r[ix['Stop/Via']] or '').strip(),
        })
    routes = []
    for (ap, al), m in mov.items():
        fl = m['D'] or m['A']                                 # conta as partidas; se só houver chegadas, as chegadas
        wkc = [0] * nw; per = collections.defaultdict(lambda: [0] * 7)
        for f in fl:
            w = (f['d'] - wk0).days // 7; wkc[w] += 1; per[w][f['d'].weekday()] += 1
        opw = [w for w in range(nw) if wkc[w]]
        base = [w for w in opw if w in full] or opw
        def mode(vals):
            c = collections.Counter(vals); top = max(c.values()); return max(v for v in c if c[v] == top)
        days = []
        for wd in range(7):
            cnts = [per[w][wd] for w in base]; share = sum(1 for x in cnts if x) / len(base)
            nz = [x for x in cnts if x]
            days.append([round(share, 2), mode(nz) if nz else 0])
        tot = [wkc[w] for w in base]
        hc = collections.Counter(f['h'] for f in m['D'] if f['h']) or collections.Counter(f['h'] for f in fl if f['h'])
        top = max(hc.values()) if hc else 0
        times = sorted([t for t, c in hc.most_common(4) if c >= 0.3 * top])
        acc = collections.Counter(f['ac'] for f in fl if f['ac'])
        capc = collections.Counter(f['cap'] for f in fl if f['cap'])
        st = collections.Counter(f['st'] for f in fl)
        via = collections.Counter(f['via'] for f in fl if f['via'])
        r = {
            'a': ap, 'c': al, 'w': mode(tot), 'lo': min(tot), 'hi': max(tot), 'd': days, 'n': len(opw),
            't': len(fl), 's': sum(f['cap'] for f in fl), 'f': min(f['d'] for f in fl).isoformat(),
            'l': max(f['d'] for f in fl).isoformat(), 'wk': wkc, 'h': times,
            'ac': [a for a, _ in acc.most_common(3)], 'cap': capc.most_common(1)[0][0] if capc else 0,
        }
        if not m['D']: r['arr'] = 1
        if len(opw) < 3: r['p'] = 1; r['dt'] = sorted({f['d'].isoformat() for f in fl})
        if st.get('C', 0) + st.get('G', 0) > len(fl) / 2: r['ch'] = 1
        if via: r['via'] = via.most_common(1)[0][0]
        routes.append(r)
    routes.sort(key=lambda r: (r['a'], -r['t']))
    used_al = {r['c'] for r in routes}; used_ap = {r['a'] for r in routes}
    out = {
        'v': 1, 'season': season, 'from': d0.isoformat(), 'to': d1.isoformat(), 'wk0': wk0.isoformat(), 'nw': nw,
        'file': path.rsplit('/', 1)[-1], 'at': dt.datetime.now().isoformat(timespec='seconds'),
        'al': {c: list(AIRLINES.get(c, (c, ''))) for c in sorted(used_al)},
        'ap': {a: [*AIRPORTS.get(a, (a, '', '')), COUNTRIES.get(country.get(a, ''), country.get(a, ''))] for a in sorted(used_ap)},
        'r': routes,
    }
    missing = sorted(used_al - AIRLINES.keys()) + sorted(used_ap - AIRPORTS.keys())
    if missing: print('sem nome:', missing, file=sys.stderr)
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:5])
