import json, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
W = sys.argv[1]
A = json.load(open(f'{W}/analysis.json'))
d = json.load(open(f'{W}/seed_dump.json'))
for f in font_manager.findSystemFonts():
    if '/inter/' in f.lower(): font_manager.fontManager.addfont(f)
plt.rcParams.update({'font.family': 'Inter', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.edgecolor': '#B9C8BF', 'axes.labelcolor': '#33473D', 'xtick.color': '#4F6158', 'ytick.color': '#33473D'})
INK, GREEN, GREEN_L, DARK, AMBER, RED, GRID = '#0F2A1F', '#0E9F5B', '#9FD8B8', '#0A7A45', '#D99A0B', '#C8372D', '#E3E9E6'
CAT = {'pain': 'Pain & fever', 'cold': 'Cold & cough', 'allergy': 'Allergy', 'digestive': 'Digestive', 'antibiotic': 'Antibiotics', 'vitamins': 'Vitamins',
       'cardio': 'Heart & vessels', 'endocrine': 'Endocrinology', 'skin': 'Skin & antiseptics', 'solutions': 'Solutions'}

# Fig A: where searches land
S = A['searches']; buy = S - A['lost']
parts = [(buy, 'Listing can be bought', GREEN), (A['lost_license'], 'Pharmacy license under review', AMBER), (A['lost_oos'], 'Out of stock', RED)]
fig, ax = plt.subplots(figsize=(8, 1.9), dpi=220)
x = 0
for v, lab, c in parts:
    ax.barh(0, v, left=x, color=c, height=0.55, edgecolor='white', linewidth=2)
    ax.text(x + v / 2, 0, f'{100 * v / S:.1f}%\n{v}', ha='center', va='center', color='white', fontsize=10, fontweight='bold')
    x += v
ax.set_xlim(0, S); ax.set_yticks([]); ax.set_xticks([]); ax.spines['left'].set_visible(False); ax.spines['bottom'].set_visible(False)
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for _, _, c in parts]
ax.legend(handles, [l for _, l, _ in parts], loc='upper center', bbox_to_anchor=(0.5, -0.05), ncol=3, frameon=False, fontsize=9)
ax.set_title(f'Where {S:,} searches in 7 days land — {A["lost_pct"]}% reach a listing nobody can buy', loc='left', fontsize=11, color=INK, fontweight='bold')
fig.tight_layout(); fig.savefig(f'{W}/fig/c_lost.png', bbox_inches='tight'); plt.close(fig)

# Fig B: demand by category
cats = A['categories'][::-1]
fig, ax = plt.subplots(figsize=(8, 4.2), dpi=220)
y = range(len(cats))
ax.barh(y, [c['searches'] for c in cats], color=GREEN_L, height=0.7, label='Searches (7 days)')
ax.barh(y, [c['orders'] for c in cats], color=DARK, height=0.7, label='Orders (7 days)')
for i, c in enumerate(cats):
    ax.text(c['searches'] + 8, i, f"{c['searches']} / {c['orders']}  ·  {c['conv']}%", va='center', fontsize=8.5, color='#33473D')
ax.set_yticks(list(y)); ax.set_yticklabels([CAT[c['category']] for c in cats])
ax.set_xlim(0, max(c['searches'] for c in cats) * 1.32); ax.xaxis.grid(True, color=GRID); ax.set_axisbelow(True)
ax.set_xlabel('Searches and orders in 7 days (label: searches / orders · conversion)')
ax.legend(frameon=False, loc='lower right', fontsize=9)
ax.set_title(f'Pain & fever and Cold & cough carry {A["top2_share"]}% of demand', loc='left', fontsize=11, color=INK, fontweight='bold')
fig.tight_layout(); fig.savefig(f'{W}/fig/c_category.png', bbox_inches='tight'); plt.close(fig)

# Fig C: days of stock left (verified, in stock, < 14 days) + empty count
lic = {a['pharmacyId']: a['status'] for a in d['applications']}
phn = {p['id']: p['name']['en'][-1] for p in d['pharmacies']}
rows = []
for p in d['products']:
    if lic[p['pharmacyId']] != 'approved' or p['stock'] == 0 or p['orders7d'] == 0: continue
    days = p['stock'] / (p['orders7d'] / 7)
    if days < 14: rows.append((f"{p['name']['en']} {p['dose']['en']} ({phn[p['pharmacyId']]})", days))
rows.sort(key=lambda r: -r[1])
fig, ax = plt.subplots(figsize=(8, 0.33 * len(rows) + 1.2), dpi=220)
ax.barh(range(len(rows)), [r[1] for r in rows], color=[AMBER if r[1] < 7 else GREEN for r in rows], height=0.65)
import math
hu = lambda v: math.floor(v * 10 + 0.5) / 10
for i, r in enumerate(rows): ax.text(r[1] + 0.15, i, f'{hu(r[1]):.1f} d', va='center', fontsize=8.5, color='#33473D')
ax.axvline(7, color=RED, linestyle='--', linewidth=1.2); ax.text(7.12, -0.9, 'Rule 2 threshold: under 7 days', color=RED, fontsize=8.5, va='bottom')
ax.set_yticks(range(len(rows))); ax.set_yticklabels([r[0] for r in rows], fontsize=8.5)
ax.set_xlabel('Days of stock left = stock ÷ (orders in 7 days ÷ 7)'); ax.xaxis.grid(True, color=GRID); ax.set_axisbelow(True)
empty = [r for r in A['rule2'] if r['type'] == 'out']
ax.set_title(f'{A["rule2_low"]} listings run out within 7 days; {len(empty)} empty ones are still searched', loc='left', fontsize=11, color=INK, fontweight='bold')
fig.tight_layout(); fig.savefig(f'{W}/fig/c_stock.png', bbox_inches='tight'); plt.close(fig)
print('empty searches', sum(r['searches'] for r in empty), 'low rows', len(rows))
