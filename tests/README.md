# DariTap — tests and analysis (Endterm)

```bash
# 1. dump the demo data and run the independent analysis (Python 3)
mkdir -p out
node -e "const s=require('../seed').createSeed();console.log(JSON.stringify({products:s.products,pharmacies:s.pharmacies,applications:s.applications.map(a=>({pharmacyId:a.pharmacyId,status:a.status}))}))" > out/seed_dump.json
node -e "require('fs').writeFileSync('out/sample.pdf', require('../seed').demoPdf())"
python3 analysis.py out            # → out/analysis.json, out/dataset.csv
python3 charts.py out              # → out/fig/*.png  (needs matplotlib; create out/fig first)

# 2. start a fresh server in another terminal
cd .. && rm -rf data && PORT=3993 node server.js

# 3. run the 15 end-to-end tests (needs: pip install playwright)
python3 e2e_tests.py http://localhost:3993 out   # → out/test_results.json, out/shots/
```

Final run on 5 November 2026: 15 of 15 passed. The weekly search and order counts in `seed.js` are simulated.
