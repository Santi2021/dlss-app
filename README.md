# DLSS — Dog Leg Severity Simulator
## Directional Drilling Digital Twin v2.2
### Weatherford International — Confidential

---

## Deploy to Vercel (free, ~3 minutes)

### Option A — Vercel CLI (fastest)
```bash
npm install -g vercel
cd dlss-app
npm install
vercel --prod
```

### Option B — GitHub + Vercel UI
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import from GitHub
3. Select the repo — Vercel auto-detects Vite
4. Click Deploy → done

---

## Local development
```bash
npm install
npm run dev
# Open http://localhost:5173
```

---

## Modules active (all run in-browser, zero backend)

| Module | Description | Reference |
|--------|-------------|-----------|
| M1 | Survey Calculator — Minimum Curvature | SPE-84246 |
| M2 | ISCWSA MWD Uncertainty (local coords) | SPE-67616 Rev4 |
| M3 | Anti-Collision (SF + C-to-C) | IADC Well Integrity |
| M4 | Torque & Drag + Von Mises | SPE-11380 |
| M5 | BHA Constraints Validator | API RP 7G |
| M6 | Wellbore Stability (Kirsch + Mohr-Coulomb) | Aadnoy & Looyeh |
| M8 | Fatigue (Miner + S-N bilinear) | API RP 7G + DNV-RP-C203 |
| M9 | Fracture Mechanics (Paris + Liebowitz-Eftis) | Paris-Erdogan (1963) |

---

## Calibration inputs needed from Weatherford
- MWD tool model (specific error coefficients)
- Drill pipe grade confirmation (S-135 / G-105 / E-75)
- Real survey data from target well
- Formation properties (UCS, gradients) from well log

These are input fields in the UI — no code changes required.
