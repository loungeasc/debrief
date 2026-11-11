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
    'ASL': ('Air Serbia', 'JU'), 'AUA': ('Austrian Airlines', 'OS'), 'AXE': ('AirExplore', 'ED'), 'BGH': ('BH Air', '8H'),
    'BTI': ('airBaltic', 'BT'), 'CND': ('Corendon Dutch Airlines', 'CD'), 'HFY': ('Hi Fly', '5K'), 'JTD': ('Jettime', 'JP'),
    'NOZ': ('Norwegian', 'DY'), 'OAE': ('Omni Air International', 'X9'), 'RYS': ('Buzz (Ryanair)', 'RR'),
    'SXS': ('SunExpress', 'XQ'), 'TDR': ('Trade Air', 'C3'), 'VKG': ('Sunclass Airlines', 'DK'),
    'ACA': ('Air Canada', 'AC'), 'AVA': ('Avianca', 'AV'), 'BAW': ('British Airways', 'BA'), 'FPO': ('ASL Airlines France', '5O'),
    'JBU': ('JetBlue', 'B6'), 'KLJ': ('Klasjet', ''), 'LAV': ('AlbaStar', 'AP'), 'LBT': ('Nouvelair', 'BJ'),
    'LZB': ('Bulgaria Air', 'FB'), 'MMZ': ('euroAtlantic airways', 'YU'), 'MSC': ('Air Cairo', 'SM'), 'NSZ': ('Norwegian', 'D8'),
    'OCN': ('Discover Airlines', '4Y'), 'SDR': ('Sundair', 'SR'), 'TUI': ('TUIfly', 'X3'),
    'AAL': ('American Airlines', 'AA'), 'CFG': ('Condor', 'DE'), 'FHY': ('Freebird Airlines', 'FH'), 'FIN': ('Finnair', 'AY'),
    'ICE': ('Icelandair', 'FI'), 'LMU': ('AlMasria Universal Airlines', 'UJ'),
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
    'ACE': ('Lanzarote', '', 'Canárias'), 'ADB': ('Esmirna', '', 'Izmir'), 'BEG': ('Belgrado', '', 'Belgrade'),
    'BLL': ('Billund', '', ''), 'CAG': ('Cagliari', '', 'Sardenha'), 'CUN': ('Cancún', '', 'Cancun'),
    'EMA': ('East Midlands', '', 'Nottingham'), 'FEZ': ('Fez', '', ''), 'FUE': ('Fuerteventura', '', 'Canárias'),
    'GRQ': ('Groningen', '', ''), 'LGG': ('Liège', '', 'Liege'), 'LJU': ('Liubliana', '', 'Ljubljana'),
    'LPA': ('Gran Canária', '', 'Las Palmas Canárias'), 'LRH': ('La Rochelle', '', ''), 'MCZ': ('Maceió', '', 'Maceio'),
    'MMX': ('Malmö', '', 'Malmo'), 'OSL': ('Oslo', 'Gardermoen', ''), 'PXO': ('Porto Santo', '', 'Madeira'),
    'RDZ': ('Rodez', '', ''), 'RIX': ('Riga', '', ''), 'SNN': ('Shannon', '', ''), 'SPC': ('La Palma', '', 'Canárias'),
    'SSA': ('Salvador', '', 'Bahia'), 'TRF': ('Oslo', 'Torp', 'Sandefjord'), 'ZAZ': ('Saragoça', '', 'Zaragoza'),
    'AGA': ('Agadir', '', ''), 'BDS': ('Brindisi', '', ''), 'BES': ('Brest', '', ''), 'BRI': ('Bari', '', ''),
    'CAI': ('Cairo', '', ''), 'CCF': ('Carcassonne', '', ''), 'CDT': ('Castellón', '', 'Castellon'), 'CFU': ('Corfu', '', 'Kerkyra'),
    'DBB': ('El Alamein', '', 'Dabaa'), 'DJE': ('Djerba', '', ''), 'DSS': ('Dacar', '', 'Dakar'), 'EGS': ('Egilsstaðir', '', 'Egilsstadir'),
    'FMO': ('Münster/Osnabrück', '', 'Munster'), 'FNI': ('Nîmes', '', 'Nimes'), 'HAJ': ('Hanôver', '', 'Hannover Hanover'),
    'HRG': ('Hurghada', '', ''), 'IBZ': ('Ibiza', '', ''), 'KEF': ('Reiquiavique', 'Keflavík', 'Reykjavik Keflavik'),
    'LEI': ('Almería', '', 'Almeria'), 'LHR': ('Londres', 'Heathrow', 'London'), 'MAH': ('Menorca', '', 'Minorca Mahón'),
    'MIR': ('Monastir', '', ''), 'NAP': ('Nápoles', '', 'Naples Napoli'), 'NBE': ('Enfidha', '', 'Hammamet'),
    'OLB': ('Olbia', '', 'Sardenha'), 'OST': ('Ostende', '', 'Oostende Bruges'), 'OUD': ('Oujda', '', ''),
    'PDV': ('Plovdiv', '', ''), 'PGF': ('Perpignan', '', ''), 'PMO': ('Palermo', '', 'Sicília'), 'REU': ('Reus', '', 'Tarragona'),
    'RNS': ('Rennes', '', ''), 'SCQ': ('Santiago de Compostela', '', 'Galiza'), 'SOF': ('Sófia', '', 'Sofia'),
    'SPU': ('Split', '', ''), 'TIA': ('Tirana', '', ''), 'TPS': ('Trapani', '', 'Sicília'), 'VIT': ('Vitória', '', 'Vitoria Gasteiz'),
    'VRN': ('Verona', '', ''), 'YUL': ('Montreal', '', 'Montréal'),
    'ATL': ('Atlanta', '', ''), 'AYT': ('Antália', '', 'Antalya'), 'BOH': ('Bournemouth', '', ''), 'CMF': ('Chambéry', '', 'Chambery'),
    'DOL': ('Deauville', '', 'Normandia'), 'DTM': ('Dortmund', '', ''), 'EXT': ('Exeter', '', ''), 'FDH': ('Friedrichshafen', '', ''),
    'HEL': ('Helsínquia', '', 'Helsinki'), 'IAD': ('Washington', 'Dulles', ''), 'KLU': ('Klagenfurt', '', ''),
    'PHL': ('Filadélfia', '', 'Philadelphia'), 'TRS': ('Trieste', '', ''),
}
COUNTRIES = {
    'Angola': 'Angola', 'Armenia': 'Arménia', 'Austria': 'Áustria', 'Belgium': 'Bélgica', 'Brazil': 'Brasil',
    'Canada': 'Canadá', 'Cape Verde': 'Cabo Verde', 'Croatia': 'Croácia', 'Czech Republic': 'Chéquia',
    'Denmark': 'Dinamarca', 'Egypt': 'Egito', 'Ethiopia': 'Etiópia', 'France': 'França', 'Germany': 'Alemanha',
    'Greece': 'Grécia', 'Hungary': 'Hungria', 'Iceland': 'Islândia', 'Ireland': 'Irlanda', 'Israel': 'Israel',
    'Italy': 'Itália', 'Luxembourg': 'Luxemburgo', 'Malta': 'Malta', 'Morocco': 'Marrocos', 'Netherlands': 'Países Baixos',
    'Norway': 'Noruega', 'Poland': 'Polónia', 'Portugal': 'Portugal', 'Romania': 'Roménia', 'Spain': 'Espanha',
    'Sweden': 'Suécia', 'Switzerland': 'Suíça', 'Turkey': 'Turquia', 'United Kingdom': 'Reino Unido',
    'United States of America': 'Estados Unidos', 'Latvia': 'Letónia', 'Mexico': 'México', 'Serbia': 'Sérvia',
    'Slovenia': 'Eslovénia', 'Finland': 'Finlândia', 'Albania': 'Albânia', 'Bulgaria': 'Bulgária', 'Senegal': 'Senegal', 'Tunisia': 'Tunísia',
}
COUNTRY_FIX = {'LWN': 'Armenia'}
OCS_COUNTRY = {
    'ATL': 'United States of America', 'IAD': 'United States of America', 'PHL': 'United States of America', 'AYT': 'Turkey',
    'BOH': 'United Kingdom', 'EXT': 'United Kingdom', 'CMF': 'France', 'DOL': 'France', 'DTM': 'Germany', 'FDH': 'Germany',
    'HEL': 'Finland', 'KLU': 'Austria', 'TRS': 'Italy',
}


# Relatório OCS (pedidos/atribuição de slots, CSV): companhia em IATA ("VY 54") ou ICAO ("EJU1743")
IATA2ICAO = {
    '4Y': 'OCN', 'A0': 'EFW', 'A3': 'AEE', 'AA': 'AAL', 'AC': 'ACA', 'AD': 'AZU', 'AF': 'AFR', 'AT': 'RAM', 'AY': 'FIN',
    'BJ': 'LBT', 'BT': 'BTI', 'CS': 'CSW', 'D8': 'NSZ', 'DE': 'CFG', 'DL': 'DAL', 'DY': 'NOZ', 'ET': 'ETH', 'EW': 'EWG',
    'FH': 'FHY', 'FI': 'ICE', 'FR': 'RYR', 'HV': 'TRA', 'IB': 'IBE', 'JU': 'ASL', 'KL': 'KLM', 'LG': 'LGL', 'LH': 'DLH',
    'LO': 'LOT', 'LS': 'EXS', 'LX': 'SWR', 'LY': 'ELY', 'NE': 'NMA', 'OS': 'AUA', 'QS': 'TVS', 'RK': 'RUK', 'S4': 'RZO',
    'SK': 'SAS', 'SM': 'MSC', 'SN': 'BEL', 'TK': 'THY', 'TO': 'TVF', 'TP': 'TAP', 'UA': 'UAL', 'UJ': 'LMU', 'UX': 'AEA',
    'VY': 'VLG', 'W4': 'WMT', 'W6': 'WZZ', 'X3': 'TUI', 'YW': 'ANE', 'U2': 'EZY', 'EC': 'EJU', 'DS': 'EZS', 'BA': 'BAW',
}
# tipos de avião: código IATA → ICAO (como no Schedule Report By Day)
AC_IATA = {
    '73H': 'B738', '32A': 'A320', '32Q': 'A21N', '320': 'A320', '7M8': 'B38M', '32N': 'A20N', '321': 'A321', '319': 'A319',
    'CRK': 'CRJX', '339': 'A339', '7S8': 'B38M', '76W': 'B763', 'E90': 'E190', '223': 'BCS3', '75W': 'B752', '332': 'A332',
    '734': 'B734', 'E95': 'E195', '73W': 'B737', '789': 'B789', '32B': 'A321', '295': 'E295', 'ER4': 'E145', 'E7W': 'E75L',
    '221': 'BCS1', '738': 'B738', '359': 'A359', '333': 'A333', '788': 'B788', '763': 'B763', 'AT7': 'AT76',
}
MON = {m: i + 1 for i, m in enumerate(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'])}


def ocs_date(s):
    s = s.strip(); return dt.date(2000 + int(s[5:7]), MON[s[2:5]], int(s[:2]))


def read_ocs(path, d0, d1):
    import csv
    for r in csv.DictReader(open(path, encoding='utf-8-sig')):
        sn = (r.get('SERVICE NUMBER') or '').strip()
        if not sn: continue
        al = IATA2ICAO.get(sn[:2], sn[:2]) if (len(sn) > 2 and sn[2] == ' ') or sn[2:3].isdigit() else sn[:3]
        st = (r.get('TY OP') or 'J').strip().upper()[:1]
        if st not in 'JCG': continue                       # só regulares, charters e desdobramentos (sem carga nem posicionamento)
        t = (r.get('TIME') or '').strip()
        if not t or t == '9999': t = (r.get('REQ TIME') or '').strip()     # sem slot atribuído: hora pedida
        hhmm = f'{t[:2]}:{t[2:4]}' if len(t) == 4 and t.isdigit() else ''
        a, b = ocs_date(r['START DATE']), ocs_date(r['END DATE'])
        freq = (r.get('FREQ') or '').strip()
        ac = (r.get('AC') or '').strip()
        base = {'al': al, 'ap': (r.get('O/D') or '').strip(), 'mov': (r.get('A/D') or 'D').strip()[:1], 'h': hhmm,
                'ac': AC_IATA.get(ac, ac), 'cap': int((r.get('SEAT') or '0').strip() or 0), 'st': st,
                'via': '' if (r.get('L/N') or '').strip() == (r.get('O/D') or '').strip() else (r.get('L/N') or '').strip(), 'country': ''}
        day = max(a, d0)
        while day <= min(b, d1):
            if str(day.isoweekday()) in freq: yield {**base, 'd': day}
            day += dt.timedelta(days=1)


def ocs_slots(path, d0, d1):
    # partidas por estado do slot: confirmado (OK), hora alternativa proposta, ainda sem slot (9999)
    import csv
    c = {'ok': 0, 'alt': 0, 'none': 0}
    for r in csv.DictReader(open(path, encoding='utf-8-sig')):
        if (r.get('TY OP') or '').strip()[:1] not in ('J', 'C', 'G') or (r.get('A/D') or '').strip() != 'D': continue
        a, b = ocs_date(r['START DATE']), ocs_date(r['END DATE']); day = max(a, d0); n = 0
        while day <= min(b, d1):
            if str(day.isoweekday()) in (r.get('FREQ') or ''): n += 1
            day += dt.timedelta(days=1)
        k = 'ok' if (r.get('CLEAR CODE') or '').strip() == 'OK' else 'none' if (r.get('TIME') or '').strip() == '9999' else 'alt'
        c[k] += n
    return c


def read_xlsx(path, d0, d1):
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = wb.active.iter_rows(values_only=True)
    h = next(rows); ix = {k: i for i, k in enumerate(h)}
    for r in rows:
        day = r[ix['DOP']]
        if not isinstance(day, dt.datetime): continue
        day = day.date()
        if day < d0 or day > d1: continue
        t = r[ix['STA/STD']]
        yield {'al': (r[ix['Airline']] or '').strip(), 'ap': (r[ix['Origin/Destination']] or '').strip(),
               'mov': (r[ix['Mov Type']] or 'D')[0], 'd': day, 'h': t.strftime('%H:%M') if isinstance(t, (dt.datetime, dt.time)) else '',
               'ac': r[ix['AC']] or '', 'cap': int(r[ix['Capacity']] or 0),
               'st': (r[ix['Service Type']] or 'J').strip().upper()[:1] or 'J', 'via': (r[ix['Stop/Via']] or '').strip(),
               'country': r[ix['Country']] or ''}


def main(path, season, d0, d1, *refs):
    d0 = dt.date.fromisoformat(d0); d1 = dt.date.fromisoformat(d1)
    wk0 = d0 - dt.timedelta(days=d0.weekday())          # segunda-feira da semana do início
    nw = (d1 - wk0).days // 7 + 1
    full = [w for w in range(nw) if wk0 + dt.timedelta(days=7 * w) >= d0 and wk0 + dt.timedelta(days=7 * w + 6) <= d1]
    mov = collections.defaultdict(lambda: {'D': [], 'A': []})
    country = {}
    # países conhecidos de épocas anteriores (JSON já resumidos), para o OCS, que não traz o país
    known = {}
    for ref in refs:
        for a, v in json.load(open(ref)).get('ap', {}).items(): known.setdefault(a, v[3])
    src = read_ocs(path, d0, d1) if path.lower().endswith('.csv') else read_xlsx(path, d0, d1)
    for f in src:
        ap, al = f['ap'], f['al']
        if not ap or not al or ap == 'OPO': continue          # OPO = regresso ao Porto (divergência)
        country.setdefault(ap, f['country'] or COUNTRY_FIX.get(ap, '') or OCS_COUNTRY.get(ap, ''))
        mov[(ap, al, f['st'])][f['mov']].append({'d': f['d'], 'h': f['h'], 'ac': f['ac'], 'cap': f['cap'], 'via': f['via']})
    routes = []
    for (ap, al, k), m in mov.items():
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
        via = collections.Counter(f['via'] for f in fl if f['via'])
        r = {
            'a': ap, 'c': al, 'w': mode(tot), 'lo': min(tot), 'hi': max(tot), 'd': days, 'n': len(opw),
            't': len(fl), 's': sum(f['cap'] for f in fl), 'f': min(f['d'] for f in fl).isoformat(),
            'l': max(f['d'] for f in fl).isoformat(), 'wk': wkc, 'h': times,
            'ac': [a for a, _ in acc.most_common(3)], 'cap': capc.most_common(1)[0][0] if capc else 0,
        }
        if not m['D']: r['arr'] = 1
        if len(opw) < 3: r['p'] = 1; r['dt'] = sorted({f['d'].isoformat() for f in fl})
        r['k'] = k
        if k == 'C': r['ch'] = 1
        if via: r['via'] = via.most_common(1)[0][0]
        routes.append(r)
    routes.sort(key=lambda r: (r['a'], r['c'], r['k'], -r['t']))
    used_al = {r['c'] for r in routes}; used_ap = {r['a'] for r in routes}
    out = {
        'v': 1, 'k': 1, 'season': season, 'from': d0.isoformat(), 'to': d1.isoformat(), 'wk0': wk0.isoformat(), 'nw': nw,
        'file': path.rsplit('/', 1)[-1], 'at': dt.datetime.now().isoformat(timespec='seconds'),
        'al': {c: list(AIRLINES.get(c, (c, ''))) for c in sorted(used_al)},
        'ap': {a: [*AIRPORTS.get(a, (a, '', '')), COUNTRIES.get(country.get(a, ''), country.get(a, '')) or known.get(a, '')] for a in sorted(used_ap)},
        'r': routes,
    }
    if path.lower().endswith('.csv'): out['prov'] = 1; out['src'] = 'OCS'; out['slots'] = ocs_slots(path, d0, d1)
    missing = sorted(used_al - AIRLINES.keys()) + sorted(used_ap - AIRPORTS.keys())
    if missing: print('sem nome:', missing, file=sys.stderr)
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:])
