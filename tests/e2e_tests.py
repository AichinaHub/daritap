"""DariTap end-to-end tests (Playwright + Chromium).

Each test starts from a fresh browser context. The server is started once on a fresh
demo database; tests run in the order below because later tests change shared state
(an order, a restock, a license approval). Expected values come from analysis.json,
which is produced by an independent Python implementation of the rules (analysis.py).
"""
import json, sys, time, traceback, datetime, re
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
W = sys.argv[2]
EXP = json.load(open(f'{W}/analysis.json'))
PH_EN = {p['id']: p['name']['en'] for p in json.load(open(f'{W}/seed_dump.json'))['pharmacies']}
RESULTS = []
SHOTS = f'{W}/shots'

def record(tid, scenario, expected, fn):
    t0 = time.time()
    try:
        actual = fn()
        status = 'PASS'
    except AssertionError as e:
        actual, status = f'FAIL: {e}', 'FAIL'
    except Exception as e:
        actual, status = f'ERROR: {e.__class__.__name__}: {e}', 'FAIL'
        traceback.print_exc()
    RESULTS.append(dict(id=tid, scenario=scenario, expected=expected, actual=actual, status=status, seconds=round(time.time() - t0, 2)))
    print(f'{tid} {status}: {actual}')

class Clicks:
    def __init__(self): self.n = 0
    def click(self, loc):
        self.n += 1
        loc.click()

def new_page(browser, w=1280, h=900):
    ctx = browser.new_context(viewport={'width': w, 'height': h})
    ctx.add_init_script("try{localStorage.setItem('daritap_lang', JSON.stringify('en'))}catch(e){}")
    page = ctx.new_page()
    page.errors = []
    page.dialogs = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    def on_dialog(d):
        page.dialogs.append(d.message)
        d.accept()
    page.on('dialog', on_dialog)
    return ctx, page

def login(page, user, pw='demo123'):
    page.goto(f'{BASE}/#/login')
    page.fill('#f_username', user)
    page.fill('#f_password', pw)
    page.click('#loginForm button[type=submit]')

def api_status(page, path):
    return page.evaluate("p => fetch(p, {credentials:'same-origin'}).then(r => r.status)", path)

def run(browser):
    # ---------------- T1 ----------------
    def t1():
        ctx, page = new_page(browser)
        login(page, 'customer', 'wrong-password')
        page.wait_for_function("() => document.querySelector('#loginForm .form-alert').innerText.trim().length > 0", timeout=5000)
        msg = page.locator('#loginForm .form-alert').inner_text()
        assert msg.strip() == 'Wrong username or password.', msg
        page.fill('#f_password', 'demo123')
        page.click('#loginForm button[type=submit]')
        page.wait_for_url('**/#/account', timeout=5000)
        head = page.locator('h1').first.inner_text()
        ctx.close()
        return f'Error "{msg.strip()}" shown; correct password opens "{head}"'
    record('T1', 'Login with a wrong password, then the correct one', 'Wrong password rejected with an error; correct password opens the customer account', t1)

    # ---------------- T2 ----------------
    def t2():
        ctx, page = new_page(browser)
        page.goto(f'{BASE}/#/login')
        for i in range(5):
            page.fill('#f_username', 'seller3'); page.fill('#f_password', f'bad{i}')
            page.click('#loginForm button[type=submit]')
            page.wait_for_function("() => document.querySelector('#loginForm .form-alert').innerText.trim().length > 0")
            page.wait_for_timeout(150)
        page.fill('#f_password', 'demo123')
        page.click('#loginForm button[type=submit]')
        page.wait_for_function("() => /Too many/.test(document.querySelector('#loginForm .form-alert').innerText)", timeout=5000)
        msg = page.locator('#loginForm .form-alert').inner_text()
        assert '#/login' in page.url
        ctx.close()
        return f'Correct password refused while locked: "{msg.strip()}"'
    record('T2', 'Brute-force protection', 'After 5 wrong passwords the account is locked for 30 s, even for the correct password', t2)

    # ---------------- T3 ----------------
    def t3():
        ctx, page = new_page(browser)
        page.goto(f'{BASE}/#/seller/alerts')
        page.wait_for_url('**/#/login**', timeout=5000)
        guest = api_status(page, '/api/reviewer/insights')
        login(page, 'customer'); page.wait_for_url('**/#/account')
        cust = api_status(page, '/api/reviewer/audit')
        page.goto(f'{BASE}/#/reviewer/insights')
        txt = page.locator('#app .alert-error').inner_text(timeout=5000)
        ctx.close()
        assert guest == 401 and cust == 403, (guest, cust)
        return f'Guest redirected to login, API {guest}; customer API {cust}; page shows "{txt.strip()[:60]}…"'
    record('T3', 'Access control: guest and customer try seller/reviewer functions', 'Guest is sent to login (401); a customer gets 403 for reviewer data', t3)

    # ---------------- T4 ----------------
    def t4():
        ctx, page = new_page(browser)
        page.goto(f'{BASE}/')
        page.fill('#searchForm input[name=q]', 'Paracetamol')
        page.press('#searchForm input[name=q]', 'Enter')
        page.wait_for_timeout(800)
        n_all = page.locator('.card').count()
        page.select_option('#filterForm select[name=avail]', 'purchasable')
        page.wait_for_timeout(800)
        n_buy = page.locator('.card').count()
        ctx.close()
        dump = json.load(open(f'{W}/seed_dump.json'))
        lic = {a['pharmacyId']: a['status'] for a in dump['applications']}
        hits = [x for x in dump['products'] if any('paracetamol' in n.lower() for n in (x['name']['kk'], x['name']['en'], x['inn']))]
        exp_all = len(hits); exp_buy = sum(1 for x in hits if lic[x['pharmacyId']] == 'approved' and x['stock'] > 0)
        assert n_all == exp_all and n_buy == exp_buy, (n_all, n_buy, exp_all, exp_buy)
        return f'"Paracetamol": {n_all} listings; "Can be bought" filter: {n_buy}'
    record('T4', 'Search and availability filter', 'The number of listings and buyable listings equals a direct count in the dataset', t4)

    # ---------------- T5 ----------------
    def t5():
        ctx, page = new_page(browser)
        page.goto(f'{BASE}/#/product/p-66')
        box = page.locator('#smartAlternatives')
        box.wait_for(timeout=5000)
        assert page.locator('.buy-box .alert-warn').count() == 1, 'buy not blocked'
        first = box.locator('.alt-item').first
        ph = first.locator('.card-title').inner_text(); price = first.locator('.price-sm').inner_text()
        exp = next(r for r in EXP['rule1'] if r['id'] == 'p-66')['alternatives'][0]
        assert first.get_attribute('data-alt') == exp['id'], first.get_attribute('data-alt')
        page.screenshot(path=f'{SHOTS}/rule1_license.png', full_page=False)
        ctx.close()
        return f'Purchase blocked (license under review); first option: {ph}, {price.strip()} ({exp["diff"]:+d} ₸)'
    record('T5', 'Rule 1: listing of a pharmacy whose license is under review (Paracetamol 500 mg ×20, Pharmacy C)', 'Purchase blocked; Smart alternatives shows the same medicine at Pharmacy A, 590 ₸', t5)

    # ---------------- T6 ----------------
    def t6():
        ctx, page = new_page(browser)
        page.goto(f'{BASE}/#/product/p-4')
        page.locator('#smartAlternatives').wait_for(timeout=5000)
        ids = [x.get_attribute('data-alt') for x in page.locator('#smartAlternatives .alt-item').all()]
        ctx.close()
        assert ids == ['p-63'], ids
        assert 'p-67' not in ids
        return f'Offered {ids} (Pharmacy A, 1 010 ₸); Pharmacy C at 930 ₸ not offered because its license is not verified'
    record('T6', 'Rule 1: out-of-stock listing (Ibuprofen 400 mg, Pharmacy B)', 'Only the verified, in-stock listing (A, 1 010 ₸) is offered; the cheaper unverified listing (C, 930 ₸) is excluded', t6)

    # ---------------- T7 ----------------
    def t7():
        ctx, page = new_page(browser)
        page.goto(f'{BASE}/#/product/p-2'); page.locator('.buy-box').wait_for()
        none_on_buyable = page.locator('#smartAlternatives').count()
        page.goto(f'{BASE}/#/product/p-70'); page.locator('#smartAlternatives').wait_for()
        title = page.locator('#altTitle').inner_text()
        items = page.locator('#smartAlternatives .alt-item').count()
        ctx.close()
        assert none_on_buyable == 0 and items == 0 and 'No verified' in title, (none_on_buyable, items, title)
        return f'Buyable listing: no block; Diosmectite (C): "{title}", 0 options'
    record('T7', 'Rule 1 boundary: buyable listing, and a blocked listing with no equivalent', 'Rule 1 does not fire for a buyable listing; when no verified equivalent exists, an honest "none" message is shown', t7)

    # ---------------- T8 ----------------
    def t8():
        ctx, page = new_page(browser)
        login(page, 'reviewer'); page.wait_for_url('**/#/reviewer')
        page.goto(f'{BASE}/#/reviewer/insights'); page.locator('#kpis').wait_for()
        conv = page.locator('[data-kpi=conversion]').inner_text(); lost = page.locator('[data-kpi=lost]').inner_text()
        r1 = page.locator('[data-rule="1"]').inner_text(); r2 = page.locator('[data-rule="2"]').inner_text()
        page.screenshot(path=f'{SHOTS}/insights.png', full_page=True)
        ctx.close()
        assert conv == f"{EXP['conversion']}%" and lost == f"{EXP['lost_pct']}%", (conv, lost)
        assert f"{EXP['blocked']} listings" in r1 and f"for {EXP['rule1_with_alt']}" in r1, r1
        assert f"{EXP['rule2_out']} “out" in r2 and f"{EXP['rule2_low']} “low" in r2, r2
        return f'Conversion {conv}, lost demand {lost}; Rule 1: {r1}; Rule 2: {r2}'
    record('T8', 'Insights screen vs. the Python analysis', f"KPIs equal the analysis: {EXP['conversion']}% conversion, {EXP['lost_pct']}% lost searches, {EXP['blocked']} blocked / {EXP['rule1_with_alt']} with alternative, {EXP['rule2_out']} out + {EXP['rule2_low']} low", t8)

    # ---------------- T9 ----------------
    def t9():
        ctx, page = new_page(browser)
        login(page, 'seller2'); page.wait_for_url('**/#/seller/license')
        page.goto(f'{BASE}/#/seller/alerts'); page.locator('#alertsTable').wait_for()
        rows = page.locator('#alertsTable tbody tr').all()
        got = {r.get_attribute('data-alert'): (r.get_attribute('data-type'), r.locator('td').nth(5).inner_text().strip(), r.locator('td').nth(6).inner_text().strip()) for r in rows}
        exp = {r['id']: (r['type'], '—' if r['type'] == 'out' and r['orders'] == 0 else (str(r['days']) if r['days'] is not None else '—'), f"+{r['reorder']}") for r in EXP['rule2'] if r['pharmacy'] == PH_EN['ph-b']}
        # out-of-stock rows show 0 days left when orders > 0
        exp = {k: (v[0], '0' if v[0] == 'out' and v[1] == '0.0' else v[1].rstrip('0').rstrip('.') if '.' in v[1] else v[1], v[2]) for k, v in exp.items()}
        page.screenshot(path=f'{SHOTS}/seller_alerts.png', full_page=True)
        ctx.close()
        assert got == exp, (got, exp)
        p20 = got['p-20']
        return f'{len(got)} alerts, all equal to the analysis; e.g. Paracetamol (children): {p20[1]} days left, reorder {p20[2]}'
    record('T9', 'Rule 2: restock alerts in the Pharmacy B seller cabinet', 'Alert list, days left and reorder amounts equal the Python analysis', t9)

    # ---------------- T10 ----------------
    def t10():
        ctx, page = new_page(browser)
        login(page, 'seller2'); page.wait_for_url('**/#/seller/license')
        page.goto(f'{BASE}/#/seller/alerts'); page.locator('#alertsTable').wait_for()
        before = page.locator('#alertsTable tbody tr').count()
        page.goto(f'{BASE}/#/seller/product/p-20'); page.locator('#basicForm').wait_for()
        page.fill('#basicForm #f_stock', '40'); page.click('#basicForm button[type=submit]')
        page.wait_for_timeout(700)
        page.goto(f'{BASE}/#/seller/alerts'); page.locator('#alertsTable').wait_for()
        after = page.locator('#alertsTable tbody tr').count()
        still = page.locator('[data-alert="p-20"]').count()
        ctx.close()
        assert after == before - 1 and still == 0, (before, after, still)
        return f'Stock of Paracetamol (children) 3 → 40: alerts {before} → {after}; the item left the list'
    record('T10', 'Live update: the seller restocks an item', 'After saving a new stock level the alert disappears (days left ≥ 7)', t10)

    # ---------------- T11 ----------------
    def t11():
        ctx, page = new_page(browser)
        c = Clicks()
        login(page, 'customer'); page.wait_for_url('**/#/account')
        page.goto(f'{BASE}/#/product/p-66'); page.locator('#smartAlternatives').wait_for()
        c.click(page.locator('#smartAlternatives .alt-item').first.locator('button[data-add]'))
        page.wait_for_function("() => document.querySelector('#cartCount').innerText.trim() === '1'")
        c.click(page.locator('a[href="#/cart"]').first)
        page.wait_for_url('**/#/cart')
        c.click(page.locator('#toCheckout'))
        page.wait_for_url('**/#/checkout')
        page.fill('#f_customerName', 'Demo Customer'); page.fill('#f_phone', '+7 701 000 00 00')
        page.select_option('#f_pickup_ph-a', index=1)
        c.click(page.locator('#checkoutForm button[type=submit]'))
        page.wait_for_url('**/#/order-success', timeout=8000)
        num = re.search(r'DT-\d{8}-\d{4}', page.locator('#app').inner_text()).group(0)
        page.screenshot(path=f'{SHOTS}/order_success.png')
        ctx.close()
        return f'Order {num} created at {PH_EN["ph-a"]} in {c.n} clicks from the blocked product page (+2 fields, 1 select)'
    record('T11', 'Customer buys through a smart alternative', 'From the blocked listing the customer adds the alternative and places a pickup order', t11)

    # ---------------- T12 ----------------
    def t12():
        ctx, page = new_page(browser)
        login(page, 'customer'); page.wait_for_url('**/#/account')
        page.goto(f'{BASE}/#/product/p-5'); page.locator('.buy-box button[data-add]').click()
        page.goto(f'{BASE}/#/checkout'); page.locator('#checkoutForm').wait_for()
        page.fill('#f_customerName', 'Demo Customer'); page.fill('#f_phone', '87010000000')
        page.select_option('#f_pickup_ph-a', index=1)
        page.click('#checkoutForm button[type=submit]'); page.wait_for_timeout(500)
        e1 = page.locator('[data-err="rx_ph-a"]').inner_text().strip()
        page.set_input_files('#f_rx_ph-a', files=[{'name': 'fake.pdf', 'mimeType': 'application/pdf', 'buffer': b'this is not a pdf'}])
        page.click('#checkoutForm button[type=submit]'); page.wait_for_timeout(900)
        e2 = page.locator('[data-err="rx_ph-a"]').inner_text().strip()
        pdf = open(f'{W}/sample.pdf', 'rb').read()
        page.set_input_files('#f_rx_ph-a', files=[{'name': 'prescription.pdf', 'mimeType': 'application/pdf', 'buffer': pdf}])
        page.click('#checkoutForm button[type=submit]')
        page.wait_for_url('**/#/order-success', timeout=8000)
        txt = page.locator('#app').inner_text()
        ctx.close()
        assert e1 and e2 and 'PDF' in e2, (e1, e2)
        status = 'awaiting prescription check' if re.search(r'prescription', txt, re.I) else txt[:80]
        return f'No file: "{e1}"; text file named .pdf: "{e2}"; real PDF accepted → order {status}'
    record('T12', 'Prescription medicine (Amoxicillin): missing and fake prescription file', 'Order is refused without a file and with a non-PDF renamed to .pdf (checked by file content); a real PDF is accepted and the order waits for the seller’s check', t12)

    # ---------------- T13 ----------------
    def t13():
        ctx, page = new_page(browser)
        login(page, 'reviewer'); page.wait_for_url('**/#/reviewer')
        first = page.locator('tbody tr').first
        pr = first.get_attribute('data-priority'); txt = first.inner_text()
        assert pr == 'high' and f"{EXP['rule3'][0]['demand']} searches" in txt, (pr, txt)
        page.screenshot(path=f'{SHOTS}/reviewer_queue.png')
        first.locator('a.btn').click(); page.locator('[data-decision=approve]').wait_for()
        page.click('[data-decision=approve]'); page.wait_for_timeout(900)
        page.goto(f'{BASE}/#/product/p-66'); page.locator('.buy-box').wait_for()
        buyable = page.locator('.buy-box button[data-add]').count(); alt = page.locator('#smartAlternatives').count()
        ctx.close()
        assert buyable == 1 and alt == 0, (buyable, alt)
        return f'Pharmacy C first in queue: High, {EXP["rule3"][0]["demand"]} searches/week blocked; after approval its Paracetamol can be bought and Rule 1 no longer fires'
    record('T13', 'Rule 3: reviewer queue priority, then approval', 'Pending Pharmacy C is listed first with High priority (210 blocked searches/week); after approval its listings become buyable', t13)

    # ---------------- T14 ----------------
    def t14():
        ctx, page = new_page(browser)
        login(page, 'customer'); page.wait_for_url('**/#/account')
        page.goto(f'{BASE}/#/product/p-7'); page.locator('.buy-box button[data-add]').click()
        page.goto(f'{BASE}/#/checkout'); page.locator('#checkoutForm').wait_for()
        payload = '<img src=x onerror="alert(1)">Aibek'
        page.fill('#f_customerName', payload); page.fill('#f_phone', '+77010000000')
        page.select_option('#f_pickup_ph-a', index=1)
        page.click('#checkoutForm button[type=submit]'); page.wait_for_url('**/#/order-success', timeout=8000)
        ctx.close()
        ctx, page = new_page(browser)
        login(page, 'seller1'); page.wait_for_url('**/#/seller/license')
        page.goto(f'{BASE}/#/seller/orders'); page.wait_for_timeout(1200)
        shown = payload in page.locator('#app').inner_text()
        injected = page.locator('#app img[src="x"]').count()
        dialogs = len(page.dialogs)
        ctx.close()
        ctx, page = new_page(browser)
        login(page, 'reviewer'); page.wait_for_url('**/#/reviewer')
        page.goto(f'{BASE}/#/reviewer/audit'); page.locator('#auditTable').wait_for()
        acts = set(x.get_attribute('data-action') for x in page.locator('#auditTable tbody tr').all())
        page.screenshot(path=f'{SHOTS}/audit.png')
        ctx.close()
        need = {'LOGIN_FAILED', 'LOGIN_LOCKED', 'ACCESS_DENIED', 'LICENSE_APPROVED', 'ORDER_CREATED', 'STOCK_UPDATE'}
        assert shown and injected == 0 and dialogs == 0, (shown, injected, dialogs)
        assert need <= acts, need - acts
        return f'HTML in the name shown as plain text, 0 injected elements, 0 dialogs; audit log has {", ".join(sorted(need))}'
    record('T14', 'Input sanitisation and audit log', 'A name containing HTML/JS is displayed as text and never runs; the reviewer’s audit log lists failed logins, lockout, denied access, approval, order and stock events', t14)

    # ---------------- T15 ----------------
    def t15():
        ctx, page = new_page(browser, 390, 844)
        overflow = []
        for h in ['/', '/#/product/p-4', '/#/cart', '/#/login']:
            page.goto(f'{BASE}{h}'); page.wait_for_timeout(700)
            overflow.append(page.evaluate('document.documentElement.scrollWidth - window.innerWidth'))
        page.goto(f'{BASE}/#/product/p-4'); page.wait_for_timeout(500)
        page.screenshot(path=f'{SHOTS}/mobile_product.png', full_page=True)
        errs = list(page.errors)
        ctx.close()
        ctx, page = new_page(browser)
        login(page, 'reviewer'); page.wait_for_url('**/#/reviewer')
        page.goto(f'{BASE}/#/reviewer/insights'); page.locator('[data-rule=ms]').wait_for()
        ms = float(page.locator('[data-rule=ms]').inner_text().split()[0])
        ctx.close()
        assert max(overflow) <= 0 and not errs and ms < 100, (overflow, errs, ms)
        return f'Horizontal overflow {max(overflow)} px on 4 screens; {len(errs)} JS errors; all three rules for {len(json.load(open(f"{W}/seed_dump.json"))["products"])} listings in {ms} ms (average of 1 000 runs)'
    record('T15', 'Mobile layout (390×844) and rule-engine speed', 'No horizontal scrolling and no JavaScript errors on a phone screen; evaluating all rules takes well under 100 ms', t15)

if __name__ == '__main__':
    import os
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        run(browser)
        browser.close()
    out = dict(date=datetime.date.today().isoformat(), tool='Playwright (Python) with Chromium', viewport='1280x900 (T15: 390x844)', base=BASE,
               passed=sum(r['status'] == 'PASS' for r in RESULTS), total=len(RESULTS), results=RESULTS)
    json.dump(out, open(f'{W}/test_results.json', 'w'), indent=1, ensure_ascii=False)
    print(f"\n{out['passed']} of {out['total']} passed")
