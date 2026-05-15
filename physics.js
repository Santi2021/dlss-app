/**
 * DLSS Physics Engine — JavaScript port of Python v2.2
 * Dog Leg Severity Simulator — Directional Drilling Digital Twin
 *
 * Modules:
 *   M1  Survey Calculator (Minimum Curvature — ISCWSA/API SPE-84246)
 *   M2  ISCWSA MWD Uncertainty (Williamson 2000 SPE-67616 Rev4)
 *   M3  Anti-Collision (Separation Factor + C-to-C)
 *   M4  Torque & Drag + Von Mises (Johancsik-Dawson-Talbot SPE-11380)
 *   M5  BHA Constraints Validator
 *   M6  Wellbore Stability (Kirsch + Mohr-Coulomb)
 *   M8  Fatigue (Palmgren-Miner + S-N bilinear API RP 7G)
 *   M9  Fracture Mechanics (Paris-Erdogan + Liebowitz-Eftis)
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DLS_REF = 30.0;       // m
const G_ACC   = 9.81;       // m/s²
const E_STEEL = 207000.0;   // MPa
const RHO_STEEL = 7850.0;   // kg/m³

// ─── M1: MINIMUM CURVATURE ───────────────────────────────────────────────────

function doglegAngle(i1r, a1r, i2r, a2r) {
  const dI = i2r - i1r;
  const dA = a2r - a1r;
  let cosB = Math.cos(dI) - Math.sin(i1r) * Math.sin(i2r) * (1 - Math.cos(dA));
  cosB = Math.max(-1, Math.min(1, cosB));
  return Math.acos(cosB) * RAD2DEG;
}

function ratioFactor(betaDeg) {
  const b = betaDeg * DEG2RAD;
  if (Math.abs(b) < 1e-8) return 1.0;
  return (2.0 / b) * Math.tan(b / 2.0);
}

function calcDLS(betaDeg, deltaMD) {
  if (deltaMD < 0.1) return 0;
  return betaDeg * (DLS_REF / deltaMD);
}

function positionDeltas(i1r, a1r, i2r, a2r, dmd, rf) {
  const h = dmd / 2.0;
  const dtvd  = h * (Math.cos(i1r) + Math.cos(i2r)) * rf;
  const dnorth = h * (Math.sin(i1r)*Math.cos(a1r) + Math.sin(i2r)*Math.cos(a2r)) * rf;
  const deast  = h * (Math.sin(i1r)*Math.sin(a1r) + Math.sin(i2r)*Math.sin(a2r)) * rf;
  return { dtvd, dnorth, deast };
}

function toolface(i1r, a1r, i2r, a2r) {
  const dI = i2r - i1r, dA = a2r - a1r;
  const s = Math.sin(i1r) * Math.sin(dA);
  const c = dI;
  if (Math.abs(s) < 1e-9 && Math.abs(c) < 1e-9) return 0;
  let tf = Math.atan2(s, c) * RAD2DEG;
  return ((tf % 360) + 360) % 360;
}

export function computeSurvey(stations, sNorth = 0, sEast = 0) {
  if (stations.length < 2) return { intervals: [], positions: [] };

  const positions = [{ md: stations[0].md, tvd: 0, north: sNorth, east: sEast }];
  const intervals  = [];

  let tvd = 0, north = sNorth, east = sEast;

  for (let i = 0; i < stations.length - 1; i++) {
    const s1 = stations[i], s2 = stations[i + 1];
    const i1r = s1.inc * DEG2RAD, a1r = s1.az * DEG2RAD;
    const i2r = s2.inc * DEG2RAD, a2r = s2.az * DEG2RAD;
    const dmd = s2.md - s1.md;

    const beta = doglegAngle(i1r, a1r, i2r, a2r);
    const rf   = ratioFactor(beta);
    const dls  = calcDLS(beta, dmd);
    const roc  = Math.abs(beta * DEG2RAD) > 1e-9 ? dmd / (beta * DEG2RAD) : Infinity;
    const tf   = toolface(i1r, a1r, i2r, a2r);
    const { dtvd, dnorth, deast } = positionDeltas(i1r, a1r, i2r, a2r, dmd, rf);

    tvd   += dtvd;
    north += dnorth;
    east  += deast;

    positions.push({ md: s2.md, tvd, north, east });

    const warn = dls > 15 ? 'CRITICAL' : dls > 8 ? 'ALERT' : 'OK';
    intervals.push({
      from: s1.md, to: s2.md, dmd,
      beta, dls, rf, roc: isFinite(roc) ? roc : null,
      tf, dtvd, dnorth, deast,
      inc1: s1.inc, inc2: s2.inc,
      az1: s1.az, az2: s2.az,
      status: warn,
    });
  }

  return { intervals, positions };
}

// ─── M2: ISCWSA UNCERTAINTY (coordenadas locales) ────────────────────────────

function rotationMatrix(incR, azR) {
  const si = Math.sin(incR), ci = Math.cos(incR);
  const sa = Math.sin(azR),  ca = Math.cos(azR);
  // [eH | eC | eL] columns
  return [
    [ ci*ca, -sa,  si*ca ],
    [ ci*sa,  ca,  si*sa ],
    [-si,     0,   ci    ],
  ];
}

function matMul3x3(A, B) {
  const C = Array.from({length:3}, () => [0,0,0]);
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++)
    C[i][j] += A[i][k]*B[k][j];
  return C;
}

function matT(A) {
  return [[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]];
}

function addMat(A, B) {
  return A.map((row,i) => row.map((v,j) => v + B[i][j]));
}

const ISCWSA_COEFFS = [
  ['ABXY_TI1H',0.004],['ABXY_TI2H',0.004],['ABZ',0.004],
  ['ASXY_TI2H',0.0005],['ASZ',0.0005],
  ['MBXY_TI2H',70.0],['MBZ',70.0],
  ['MSXY_TI2H',0.0016],['MSZ',0.0016],
  ['DECG',0.36],['DBHG',0.36],['DBG',130.0],['AMIL',0.00175],
];

function localErrors(name, mag, incR, Bh, Bv, B) {
  const si  = Math.max(Math.sin(incR), 1e-4);
  const ci  = Math.cos(incR);
  const g   = G_ACC;
  const eps = 1e-9;

  switch(name) {
    case 'ABXY_TI1H': return [mag/g, 0, 0];
    case 'ABXY_TI2H': return [mag/g, mag/(g*Bh/B+eps), 0];
    case 'ABZ':       return [mag*Math.abs(ci)/g, 0, mag*Math.abs(si)/g];
    case 'ASXY_TI2H': return [mag*Math.abs(ci), mag*Bv/(Bh+eps), 0];
    case 'ASZ':       return [mag*Math.abs(si), 0, mag*Math.abs(ci)];
    case 'MBXY_TI2H': return [0, mag/(Bh+eps), 0];
    case 'MBZ':       return [0, mag*Bv/(Bh*B+eps), 0];
    case 'MSXY_TI2H': return [0, mag, 0];
    case 'MSZ':       return [0, mag*Bv/(Bh+eps), 0];
    case 'DECG':      return [0, mag*DEG2RAD, 0];
    case 'DBHG':      return [mag*DEG2RAD*Bv/(g+eps), mag*DEG2RAD*Bv/(Bh+eps), 0];
    case 'DBG':       return [0, mag/(Bh+eps), 0];
    case 'AMIL':      return [mag, mag, 0];
    default:          return [0, 0, 0];
  }
}

export function computeISCWSA(stations, intervals,
  { B=52000, dipDeg=38, sigmaLevel=2 } = {}) {
  const dip = Math.abs(dipDeg) * DEG2RAD;
  const Bh  = B * Math.cos(dip);
  const Bv  = B * Math.sin(dip);

  let Cacc = [[0,0,0],[0,0,0],[0,0,0]];
  const Clist = [Cacc.map(r=>[...r])];

  for (const intv of intervals) {
    const incMid = ((intv.inc1 || 0) + (intv.inc2 || 0)) / 2;
    const azMid  = ((intv.az1  || 0) + (intv.az2  || 0)) / 2;
    const iR = incMid * DEG2RAD;
    const aR = azMid  * DEG2RAD;
    const dmd = intv.dmd;
    const R  = rotationMatrix(iR, aR);
    const Rt = matT(R);

    let DC = [[0,0,0],[0,0,0],[0,0,0]];
    for (const [name, mag] of ISCWSA_COEFFS) {
      const [sH, sC, sL] = localErrors(name, mag, iR, Bh, Bv, B);
      const Cloc = [
        [(sH*dmd)**2, 0, 0],
        [0, (sC*dmd)**2, 0],
        [0, 0, (sL*dmd)**2],
      ];
      DC = addMat(DC, matMul3x3(R, matMul3x3(Cloc, Rt)));
    }
    Cacc = addMat(Cacc, DC);
    Clist.push(Cacc.map(r=>[...r]));
  }

  return stations.map((st, j) => {
    const C = Clist[j];
    // Semi-axes approximation: sqrt of diagonal elements scaled by sigmaLevel
    const a = sigmaLevel * Math.sqrt(Math.max(C[0][0]+C[1][1], 0));
    const b = sigmaLevel * Math.sqrt(Math.max(C[2][2], 0));
    const c = sigmaLevel * Math.sqrt(Math.max(Math.min(C[0][0],C[1][1]), 0));
    return { md: st.md, inc: st.inc, az: st.az, a2s: a, b2s: b, c2s: c };
  });
}

// ─── M3: ANTI-COLLISION ──────────────────────────────────────────────────────

export function computeAntiCollision(refPos, refUnc, offPos, offUnc) {
  return refPos.map((rp, j) => {
    let minDist = Infinity, minIdx = 0;
    for (let k = 0; k < offPos.length; k++) {
      const d = Math.sqrt(
        (rp.north - offPos[k].north)**2 +
        (rp.east  - offPos[k].east )**2 +
        (rp.tvd   - offPos[k].tvd  )**2);
      if (d < minDist) { minDist = d; minIdx = k; }
    }
    const aRef = refUnc[j]?.a2s || 0;
    const aOff = offUnc[minIdx]?.a2s || 0;
    const sumA = aRef + aOff;
    const sf   = sumA > 1e-6 ? minDist / sumA : 999;
    const ctc  = minDist;
    const status = ctc < 10 ? 'CRITICAL' : ctc < 30 ? 'ALERT' : 'OK';
    return { md: rp.md, ctc, aRef, aOff, sf, status };
  });
}

// ─── M4: TORQUE & DRAG + VON MISES ──────────────────────────────────────────

export function computeTorqueDrag(stations, positions, intervals, {
  wob = 80, muSliding = 0.25, muRotating = 0.15,
  wBuoyed = 0.16, rAvg = 0.0635, rpm = 120,
  odM = 0.127, idM = 0.109
} = {}) {
  const n   = stations.length;
  const Fout = new Array(n).fill(0);
  const Fin  = new Array(n).fill(0);
  const Frot = new Array(n).fill(0);
  const Torq = new Array(n).fill(0);
  const Nf   = new Array(n).fill(0);

  Fout[n-1] = Fin[n-1] = Frot[n-1] = wob;

  for (let k = n-2; k >= 0; k--) {
    const intv = intervals[k];
    const i1r  = stations[k].inc * DEG2RAD;
    const i2r  = stations[k+1].inc * DEG2RAD;
    const a1r  = stations[k].az * DEG2RAD;
    const a2r  = stations[k+1].az * DEG2RAD;
    const dmd  = intv.dmd;
    const dI   = i2r - i1r;
    const dA   = a2r - a1r;
    const Iavg = (i1r + i2r) / 2;

    const Favg = (Frot[k+1] + wob) / 2;
    const Nrot = Math.sqrt((Favg*dI)**2 + (Favg*Math.sin(Iavg)*dA)**2);
    const Nout = Math.sqrt(((Fout[k+1]+wob)/2*dI)**2 + ((Fout[k+1]+wob)/2*Math.sin(Iavg)*dA)**2);
    const Nin  = Math.sqrt(((Fin[k+1]+wob)/2*dI)**2  + ((Fin[k+1]+wob)/2*Math.sin(Iavg)*dA)**2);

    Nf[k] = Nrot;
    const Wax = wBuoyed * Math.cos(Iavg) * dmd;

    Fout[k] = Fout[k+1] + Wax + muSliding * Nout;
    Fin[k]  = Fin[k+1]  + Wax - muSliding * Nin;
    Frot[k] = Frot[k+1] + Wax;
    Torq[k] = Torq[k+1] + muRotating * Nrot * rAvg;
  }

  // Von Mises
  const A = Math.PI/4 * (odM**2 - idM**2);
  const I = Math.PI/64 * (odM**4 - idM**4);
  const c = odM/2;
  const vm = stations.map((_, k) => {
    const F = Frot[k] * 1e3;
    const T = Torq[k] * 1e3;
    const N = Nf[k] * 1e3;
    const sAx   = F / A / 1e6;
    const sBend = N * c / I / 1e6;
    const tau   = T * c / (2*I) / 1e6;
    return Math.sqrt(sAx**2 + sBend**2 - sAx*sBend + 3*tau**2);
  });

  return {
    tripOut: Fout, tripIn: Fin, rotating: Frot,
    torque: Torq, normalForce: Nf, vonMises: vm,
    summary: {
      hookLoadOut: Fout[0], hookLoadIn: Fin[0],
      surfaceTorque: Torq[0], maxVonMises: Math.max(...vm)
    }
  };
}

// ─── M5: BHA VALIDATOR ───────────────────────────────────────────────────────

export function validateBHA(intervals, bhaComponents, wobApplied) {
  return intervals.map((intv, i) => {
    const violations = [];
    let status = 'OK';

    for (const comp of bhaComponents) {
      if (intv.dls > comp.maxDLS) {
        violations.push(`${comp.name}: DLS ${intv.dls.toFixed(2)} > ${comp.maxDLS}°/30m`);
        status = 'VIOLATION';
      } else if (intv.dls > comp.maxDLS * 0.85) {
        violations.push(`${comp.name}: DLS near limit (${comp.maxDLS}°/30m)`);
        if (status === 'OK') status = 'CAUTION';
      }
      if (comp.maxWOB && wobApplied > comp.maxWOB) {
        violations.push(`${comp.name}: WOB ${wobApplied.toFixed(0)} > ${comp.maxWOB} kN`);
        status = 'VIOLATION';
      }
    }

    return {
      interval: `S${i}→S${i+1}`,
      from: intv.from, to: intv.to,
      dls: intv.dls, status, violations,
    };
  });
}

// ─── M6: WELLBORE STABILITY ──────────────────────────────────────────────────

export function computeStability(stations, positions, formation) {
  const { UCS, frictionDeg, tensile, gradSv, gradSH, gradSh, gradPp, azSH } = formation;
  const phi = frictionDeg * DEG2RAD;
  const Nphi = (1 + Math.sin(phi)) / (1 - Math.sin(phi));

  return stations.map((st, j) => {
    const tvd = Math.max(positions[j]?.tvd || 1, 1);
    const Sv = gradSv * tvd, SH = gradSH * tvd;
    const Sh = gradSh * tvd, Pp = gradPp * tvd;
    const incR = st.inc * DEG2RAD;
    const daz  = st.az * DEG2RAD - azSH * DEG2RAD;

    const sigX = (SH*Math.cos(daz)**2 + Sh*Math.sin(daz)**2)*Math.sin(incR)**2 + Sv*Math.cos(incR)**2;
    const sigY =  SH*Math.sin(daz)**2 + Sh*Math.cos(daz)**2;

    const sttMin = 3*sigY - sigX - 2*Pp;
    const sttMax = 3*sigX - sigY - 2*Pp;

    const PwMin = Math.max((sttMin + UCS) / (1 + Nphi), Pp);
    const PwMax = sttMax + tensile;

    const k = G_ACC * tvd / 1000;
    const MWmin   = k > 0 ? PwMin / k * 1000 : 1070;
    const MWmax   = k > 0 ? PwMax / k * 1000 : 3000;
    const MWpore  = k > 0 ? Pp    / k * 1000 : 1070;
    const window  = Math.max(0, MWmax - MWmin);

    return {
      md: st.md, tvd, inc: st.inc,
      Pp: Pp.toFixed(2), MWpore: MWpore.toFixed(0),
      MWmin: MWmin.toFixed(0), MWmax: MWmax.toFixed(0),
      window: window.toFixed(0),
      status: window < 50 ? 'CLOSED' : window < 150 ? 'NARROW' : 'ADEQUATE',
    };
  });
}

// ─── M8: FATIGUE (S-N bilinear API RP 7G + Holford) ─────────────────────────

const MATERIALS = {
  'S-135': { yield: 930, UTS: 1000, SN_loga: 11.764, SN_m: 3.0, fatLimit: 160, E: E_STEEL },
  'G-105': { yield: 724, UTS:  793, SN_loga: 11.610, SN_m: 3.0, fatLimit: 140, E: E_STEEL },
  'E-75':  { yield: 517, UTS:  690, SN_loga: 11.455, SN_m: 3.0, fatLimit: 120, E: E_STEEL },
};

function snCyclesToFailure(S, mat) {
  if (S <= 0) return Infinity;
  const Kt = 1.6;
  const Slimit = mat.fatLimit / Kt;
  if (S <= Slimit) return Infinity;
  const logN1 = mat.SN_loga - mat.SN_m * Math.log10(S);
  const N1 = 10**logN1;
  if (N1 <= 1e6) return N1;
  const Sknee = 10**((mat.SN_loga - 6) / mat.SN_m);
  const m2 = 5.0;
  const loga2 = 6 + m2 * Math.log10(Sknee);
  return 10**(loga2 - m2 * Math.log10(S));
}

function bendingStress(dlsDeg30m, odM) {
  const kappa = dlsDeg30m * DEG2RAD / DLS_REF;
  return E_STEEL * (odM/2) * kappa;
}

export function computeFatigue(intervals, { material='S-135', odM=0.127, rpm=120, rop=15, nTransits=1 } = {}) {
  const mat = MATERIALS[material] || MATERIALS['S-135'];
  let Dcum  = 0;
  return intervals.map(intv => {
    const S    = bendingStress(intv.dls, odM);
    const Nf   = snCyclesToFailure(S, mat);
    const tHr  = DLS_REF / Math.max(rop, 0.1);
    const nCyc = rpm * 60 * tHr * nTransits;
    const d    = isFinite(Nf) ? nCyc / Nf : 0;
    Dcum += d;
    const lifeRem = Math.max(0, (1 - Dcum) * 100);
    const status  = Dcum >= 1 ? 'FAILURE'
                  : Dcum >= 0.8 ? 'CRITICAL'
                  : Dcum >= 0.5 ? 'WARNING'
                  : Dcum >= 0.2 ? 'CAUTION' : 'OK';
    return {
      from: intv.from, to: intv.to, dls: intv.dls,
      Sbend: S, Nf: isFinite(Nf) ? Nf : null,
      dMiner: d, Dcum, lifeRem, status,
    };
  });
}

// ─── M9: FRACTURE MECHANICS ──────────────────────────────────────────────────

export function computeFracturePropagation(deltaS, {
  a0=0.001, aCrit=0.006, Cparis=1.5e-11, mParis=3.0,
  KIc=50, Cchat=0.92, Y=1.12, maxCycles=5e6
} = {}) {
  let a = a0, n = 0;
  const records = [];
  const step = Math.max(1, maxCycles / 500);

  while (a < aCrit && n < maxCycles) {
    const dK   = Y * deltaS * Math.sqrt(Math.PI * a);
    const dadN = Cparis * dK**mParis;
    if (dadN <= 0) break;

    const frac = a / aCrit;
    const cs   = step * (frac > 0.8 ? 0.1 : 1);
    a = Math.min(a + dadN * cs, aCrit);
    n += cs;

    const stage = frac < 0.1 ? 'I_Formation'
                : frac < 1.0 ? 'II_Propagation' : 'III_Fracture';

    if (records.length < 200) {
      records.push({ cycles: n, a_mm: a*1000, dK, dadN_mm: dadN*1000, stage });
    }
  }

  const KFinal = Y * deltaS * Math.sqrt(Math.PI * aCrit);
  const GcHat  = Cchat * KFinal**2 / E_STEEL;

  return { records, N_fracture: n, GcHat, KFinal };
}

// ─── DEFAULT CONFIG ──────────────────────────────────────────────────────────

export const DEFAULT_STATIONS = [
  { md: 0,    inc: 0,  az: 270 },
  { md: 500,  inc: 0,  az: 270 },
  { md: 1000, inc: 0,  az: 270 },
  { md: 1500, inc: 0,  az: 270 },
  { md: 2000, inc: 0,  az: 270 },
  { md: 2500, inc: 0,  az: 270 },
  { md: 2530, inc: 4,  az: 270 },
  { md: 2560, inc: 8,  az: 270 },
  { md: 2590, inc: 12, az: 270 },
  { md: 2620, inc: 16, az: 270 },
  { md: 2650, inc: 20, az: 270 },
  { md: 2680, inc: 24, az: 270 },
  { md: 2710, inc: 28, az: 270 },
  { md: 2740, inc: 32, az: 270 },
  { md: 2770, inc: 36, az: 270 },
  { md: 2800, inc: 40, az: 270 },
  { md: 2830, inc: 44, az: 270 },
  { md: 2860, inc: 48, az: 270 },
  { md: 2890, inc: 52, az: 270 },
  { md: 2920, inc: 56, az: 270 },
  { md: 2950, inc: 60, az: 270 },
  { md: 2980, inc: 64, az: 270 },
  { md: 3010, inc: 68, az: 270 },
  { md: 3040, inc: 72, az: 270 },
  { md: 3070, inc: 76, az: 270 },
  { md: 3100, inc: 80, az: 270 },
  { md: 3130, inc: 84, az: 270 },
  { md: 3160, inc: 88, az: 270 },
  { md: 3175, inc: 90, az: 270 },
  { md: 3425, inc: 90, az: 270 },
  { md: 3675, inc: 90, az: 270 },
  { md: 3925, inc: 90, az: 270 },
  { md: 4175, inc: 90, az: 270 },
  { md: 4675, inc: 90, az: 270 },
];

export const DEFAULT_BHA = [
  { name: 'PDC Bit 6"',       maxDLS: 12, maxWOB: 150 },
  { name: 'Mud Motor 6.75"',  maxDLS: 8,  maxWOB: 120 },
  { name: 'MWD 6.75"',        maxDLS: 10, maxWOB: null },
  { name: 'LWD 6.75"',        maxDLS: 10, maxWOB: null },
  { name: 'NMDC 6.75"',       maxDLS: 6,  maxWOB: null },
  { name: 'HWDP 5"',          maxDLS: 10, maxWOB: 200 },
];

export const DEFAULT_FORMATION = {
  UCS: 60, frictionDeg: 28, tensile: 4, poisson: 0.25,
  gradSv: 0.0245, gradSH: 0.021, gradSh: 0.0175, gradPp: 0.0105,
  azSH: 45,
};

export { MATERIALS };
