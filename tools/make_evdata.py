#!/usr/bin/env python3
"""Rebuild js/evdata/*.js from the HORSE+ EV tables.

    python3 tools/make_evdata.py "/path/to/HORSE+ Master" http://your-horse-server

Razz comes from the HORSE+ server (/api/ev/data — the same numbers the HORSE+
app shows); Stud Hi, Stud Hi/Lo and Omaha Hi/Lo come from the JSON tables in
the HORSE+ folder.  Hold'em (js/evdata/holdem.js) is this app's own heads-up
table and is not rebuilt here.
"""
import json, os, sys, urllib.request, collections
H = sys.argv[1]
SERVER = sys.argv[2].rstrip('/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'evdata')
def write(game, label, players, note):
    body = json.dumps({'label': label, 'note': note, 'players': players}, separators=(',', ':'))
    p = os.path.join(OUT, game + '.js')
    open(p, 'w').write('/* generated from the HORSE+ EV tables (' + label + ') — equity = expected share of the pot against random hands, by number of players */\nPSEV.add(' + json.dumps(game) + ',' + body + ');\n')
    print(game, {k: len(v) for k, v in players.items()}, os.path.getsize(p))
r4 = lambda x: round(x, 4)

# Razz: the same numbers the HORSE+ app shows (its server's in-memory tables)
pl = {}
for n in range(2, 9):
    d = json.load(urllib.request.urlopen(f'{SERVER}/api/ev/data?players={n}&cards=3', timeout=30))
    pl[str(n)] = {x['hand']: r4(x['winRate'] / 100) for x in d['results']}
write('razz', 'Razz', pl, '3 cards, all-in to the end against random hands')

# Stud Hi — older files key "AAA" / "55A" / "KQJ_ss"; newer ones "AAA_trips" / "55A_pair" and split
# two-suited hands by which two cards share the suit.  Normalised to one form: trips, pair, suited, ss, rainbow.
def stud_key(k):
    if '_' not in k:
        return k + ('_trips' if k[0] == k[1] == k[2] else '_pair')
    r, pat = k.split('_', 1)
    return r + '_' + ('ss' if pat.startswith('semi_suited') else pat)
pl = {}
for n in range(2, 8):
    d = json.load(open(f'{H}/EV_Tables_Stud/stud-high-ev-{n}p-3card.json'))
    rows = d.get('results') or []
    raw = {x['rawHand']: x['totalEV'] for x in rows} if rows else d['evTable']
    acc = collections.defaultdict(list)
    for k, v in raw.items(): acc[stud_key(k)].append(v)
    pl[str(n)] = {k: r4(sum(v) / len(v)) for k, v in acc.items()}
write('stud', 'Stud Hi', pl, '3 cards, all-in to the end against random hands')

# Stud Hi/Lo
pl = {}
for n in range(2, 8):
    d = json.load(open(f'{H}/EV_Tables_Stud8/stud8-ev-{n}p-3card.json'))
    pl[str(n)] = {k: r4(v['ev']) for k, v in d['hands'].items()}
write('stud8', 'Stud Hi/Lo', pl, '3 cards, all-in to the end against random hands; split pots counted as half')

# Omaha Hi/Lo: ranks + suit shape; several double-suited layouts share a label, so they are averaged
pl = {}
for n in range(2, 10):
    f = f'{H}/EV_Tables_Omaha8/omaha8-ev-{n}p.json'
    if not os.path.exists(f): continue
    d = json.load(open(f))
    acc = collections.defaultdict(list)
    for p in d['patterns']:
        acc[p['ranks'] + '|' + p['suitPattern']].append(p['equity'] / 100)
    pl[str(n)] = {k: r4(sum(v) / len(v)) for k, v in acc.items()}
write('omaha8', 'Omaha Hi/Lo', pl, '4 cards, all-in to the river against random hands; split pots counted as half')
