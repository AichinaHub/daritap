# Independent re-implementation of DariTap's analysis and rules (Python), used as the test oracle.
import json, math, csv, sys, statistics
W = sys.argv[1]
d = json.load(open(f'{W}/seed_dump.json'))
lic = {a['pharmacyId']: a['status'] for a in d['applications']}
ph_name = {p['id']: p['name']['en'] for p in d['pharmacies']}
P = d['products']
def block(p):
    st = lic.get(p['pharmacyId'], 'none')
    if st != 'approved': return 'license_' + st
    if p['stock'] <= 0: return 'out_of_stock'
    return None
same = lambda a, b: a['inn'] == b['inn'] and a['form']['en'] == b['form']['en'] and a['dose']['en'] == b['dose']['en'] and a['pack']['en'] == b['pack']['en']
def alts(p):
    if not block(p): return []
    c = [x for x in P if x['id'] != p['id'] and same(x, p) and not block(x)]
    return sorted(c, key=lambda x: (x['price'], -x['stock']))[:3]
def restock(p):
    daily = p['orders7d'] / 7
    days = p['stock'] / daily if daily > 0 else None
    t = None
    if p['stock'] == 0 and p['searches7d'] >= 10: t = 'out'
    elif p['stock'] > 0 and days is not None and days < 7: t = 'low'
    if not t: return None
    return dict(type=t, days=None if days is None else math.floor(days * 10 + 0.5) / 10, reorder=max(1, math.ceil(daily * 14 - p['stock'])))
S = sum(p['searches7d'] for p in P); O = sum(p['orders7d'] for p in P)
blocked = [p for p in P if block(p)]
lost = sum(p['searches7d'] for p in blocked)
lost_lic = sum(p['searches7d'] for p in blocked if block(p).startswith('license'))
lost_oos = lost - lost_lic
cats = {}
for p in P:
    c = cats.setdefault(p['category'], dict(category=p['category'], listings=0, searches=0, orders=0))
    c['listings'] += 1; c['searches'] += p['searches7d']; c['orders'] += p['orders7d']
cats = sorted(cats.values(), key=lambda c: -c['searches'])
for c in cats: c['conv'] = round(100 * c['orders'] / c['searches'], 1)
r1 = [dict(id=p['id'], name=p['name']['en'], dose=p['dose']['en'], pack=p['pack']['en'], pharmacy=ph_name[p['pharmacyId']], reason=block(p), searches=p['searches7d'], alternatives=[dict(id=a['id'], pharmacy=ph_name[a['pharmacyId']], price=a['price'], diff=a['price'] - p['price']) for a in alts(p)]) for p in blocked]
r2 = []
for p in P:
    if lic.get(p['pharmacyId']) != 'approved': continue
    a = restock(p)
    if a: r2.append(dict(id=p['id'], name=p['name']['en'], dose=p['dose']['en'], pharmacy=ph_name[p['pharmacyId']], stock=p['stock'], orders=p['orders7d'], searches=p['searches7d'], **a))
r3 = [dict(pharmacy=ph_name[ph], demand=sum(p['searches7d'] for p in P if p['pharmacyId'] == ph)) for ph, st in lic.items() if st == 'pending']
# OTC vs Rx conversion on buyable listings
buy = [p for p in P if not block(p)]
conv = lambda L: round(100 * sum(p['orders7d'] for p in L) / sum(p['searches7d'] for p in L), 1)
# same-medicine price spread
groups = {}
for p in P:
    groups.setdefault((p['inn'], p['form']['en'], p['dose']['en'], p['pack']['en']), []).append(p)
spreads = []
for k, g in groups.items():
    if len(g) > 1:
        lo, hi = min(x['price'] for x in g), max(x['price'] for x in g)
        spreads.append(dict(medicine=f"{k[0]} {k[2]} x {k[3]}", n=len(g), min=lo, max=hi, spread_pct=round(100 * (hi - lo) / lo, 1)))
prices = [p['price'] for p in P]
res = dict(
    listings=len(P), pharmacies=len(d['pharmacies']), verified=sum(1 for v in lic.values() if v == 'approved'),
    searches=S, orders=O, conversion=round(100 * O / S, 1),
    lost=lost, lost_pct=round(100 * lost / S, 1), lost_license=lost_lic, lost_oos=lost_oos,
    lost_license_pct=round(100 * lost_lic / S, 1), lost_oos_pct=round(100 * lost_oos / S, 1),
    blocked=len(blocked), blocked_license=sum(1 for p in blocked if block(p).startswith('license')), blocked_oos=sum(1 for p in blocked if block(p) == 'out_of_stock'),
    rule1_with_alt=sum(1 for r in r1 if r['alternatives']), rule1=r1,
    rule2=r2, rule2_out=sum(1 for r in r2 if r['type'] == 'out'), rule2_low=sum(1 for r in r2 if r['type'] == 'low'),
    rule3=r3, categories=cats,
    conv_otc=conv([p for p in buy if not p['rx']]), conv_rx=conv([p for p in buy if p['rx']]),
    spreads=spreads, price_avg=round(statistics.mean(prices)), price_min=min(prices), price_max=max(prices),
    top2_share=round(100 * (cats[0]['searches'] + cats[1]['searches']) / S, 1),
)
json.dump(res, open(f'{W}/analysis.json', 'w'), indent=1, ensure_ascii=False)
with open(f'{W}/dataset.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['listing_id', 'pharmacy', 'license_status', 'medicine', 'dose', 'pack', 'category', 'rx', 'price_kzt', 'stock_units', 'searches_7d', 'orders_7d'])
    for p in P: w.writerow([p['id'], ph_name[p['pharmacyId']], lic[p['pharmacyId']], p['name']['en'], p['dose']['en'], p['pack']['en'], p['category'], 'Rx' if p['rx'] else 'OTC', p['price'], p['stock'], p['searches7d'], p['orders7d']])
print(json.dumps({k: v for k, v in res.items() if k not in ('rule1', 'rule2', 'categories', 'spreads')}, indent=1))
print('categories', [(c['category'], c['searches'], c['orders'], c['conv']) for c in cats])
print('rule1', [(r['id'], r['name'], r['reason'], [(a['pharmacy'], a['price'], a['diff']) for a in r['alternatives']]) for r in r1])
print('rule2', [(r['id'], r['name'], r['type'], r['days'], r['reorder']) for r in r2])
print('spreads', spreads)
