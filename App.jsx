import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  computeSurvey, computeISCWSA, computeAntiCollision,
  computeTorqueDrag, validateBHA, computeStability,
  computeFatigue, computeFracturePropagation,
  DEFAULT_STATIONS, DEFAULT_BHA, DEFAULT_FORMATION, MATERIALS,
} from './engine/physics.js';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, AreaChart, Area,
} from 'recharts';
import * as THREE from 'three';

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg:       '#080C12',
  surface:  '#0D1420',
  panel:    '#111827',
  border:   '#1E2D40',
  accent:   '#00E5FF',
  accentDim:'#005F6B',
  gold:     '#FFB800',
  danger:   '#FF3B30',
  warn:     '#FF9500',
  ok:       '#30D158',
  text:     '#E8EDF2',
  muted:    '#5A6A7A',
  gridLine: '#1A2535',
};

const statusColor = s =>
  s === 'CRITICAL' || s === 'VIOLATION' || s === 'FAILURE' || s === 'COLLISION_RISK' ? C.danger
  : s === 'ALERT' || s === 'WARNING'  || s === 'CAUTION'  || s === 'NARROW' ? C.warn
  : C.ok;

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; width: 100%; overflow: hidden; }
  body {
    background: ${C.bg};
    color: ${C.text};
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
  input[type=number], input[type=text], select {
    background: ${C.bg};
    border: 1px solid ${C.border};
    color: ${C.text};
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    padding: 4px 6px;
    border-radius: 3px;
    outline: none;
    width: 100%;
  }
  input[type=number]:focus, input[type=text]:focus, select:focus {
    border-color: ${C.accent};
  }
  button {
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
    border: none;
    outline: none;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes slideIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
`;

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function Panel({ title, children, accent = false, style = {} }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${accent ? C.accent : C.border}`,
      borderRadius: 6, overflow: 'hidden', ...style,
    }}>
      {title && (
        <div style={{
          padding: '7px 12px', borderBottom: `1px solid ${accent ? C.accentDim : C.border}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {accent && <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: C.accent, display: 'inline-block',
            boxShadow: `0 0 6px ${C.accent}`,
          }}/>}
          <span style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 700,
            fontSize: 11, letterSpacing: '0.12em',
            color: accent ? C.accent : C.muted, textTransform: 'uppercase',
          }}>{title}</span>
        </div>
      )}
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function StatBadge({ label, value, unit, status }) {
  const col = status ? statusColor(status) : C.accent;
  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 4, padding: '8px 12px', textAlign: 'center',
    }}>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.1em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ color: col, fontFamily: 'Syne', fontWeight: 800, fontSize: 18 }}>
        {value}<span style={{ fontSize: 11, fontWeight: 400, color: C.muted }}> {unit}</span>
      </div>
    </div>
  );
}

function AlertBadge({ status, label }) {
  const col = statusColor(status);
  const isAlert = status !== 'OK' && status !== 'ADEQUATE' && status !== 'HEALTHY';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${col}18`, border: `1px solid ${col}40`,
      borderRadius: 3, padding: '2px 7px', fontSize: 10,
      color: col, letterSpacing: '0.08em',
      animation: isAlert ? 'pulse 2s infinite' : 'none',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: col }}/>
      {label || status}
    </span>
  );
}

// ─── 3D TRAJECTORY VIEWER ─────────────────────────────────────────────────────

function TrajectoryViewer({ positions, intervals }) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animRef = useRef(null);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const spherical = useRef({ theta: -0.8, phi: 1.1, radius: 1 });

  useEffect(() => {
    if (!mountRef.current || positions.length < 2) return;
    const el = mountRef.current;
    const W = el.clientWidth, H = el.clientHeight;

    // Scene
    const scene    = new THREE.Scene();
    sceneRef.current = scene;
    const camera   = new THREE.PerspectiveCamera(45, W/H, 0.1, 50000);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current = renderer;
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    // Compute bounds
    const Ns = positions.map(p => p.north);
    const Es = positions.map(p => p.east);
    const Ts = positions.map(p => p.tvd);
    const cx = (Math.min(...Ns)+Math.max(...Ns))/2;
    const cy = (Math.min(...Es)+Math.max(...Es))/2;
    const cz = (Math.min(...Ts)+Math.max(...Ts))/2;
    const ext = Math.max(
      Math.max(...Ns)-Math.min(...Ns),
      Math.max(...Es)-Math.min(...Es),
      Math.max(...Ts)-Math.min(...Ts), 100);
    spherical.current.radius = ext * 2;

    // Grid
    const gridSize = ext * 2;
    const gridDiv  = 20;
    const gridMat  = new THREE.LineBasicMaterial({ color: 0x1A2535, transparent: true, opacity: 0.6 });
    const gridGeo  = new THREE.BufferGeometry();
    const gpts = [];
    for (let i = 0; i <= gridDiv; i++) {
      const t = -gridSize/2 + i * gridSize/gridDiv;
      gpts.push(t, 0, -gridSize/2, t, 0, gridSize/2);
      gpts.push(-gridSize/2, 0, t, gridSize/2, 0, t);
    }
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gpts, 3));
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.set(cx-cx, -cz, cy-cy);
    scene.add(grid);

    // Trajectory tube
    const pts = positions.map(p =>
      new THREE.Vector3(p.north - cx, -(p.tvd - cz), p.east - cy));

    const dlsVals = [0, ...intervals.map(iv => iv.dls)];
    const maxDLS  = Math.max(...dlsVals, 1);

    for (let i = 0; i < pts.length - 1; i++) {
      const dls = dlsVals[i+1] || 0;
      const t   = dls / maxDLS;
      const col = new THREE.Color(
        t < 0.3  ? 0x00E5FF :
        t < 0.6  ? 0xFFB800 : 0xFF3B30);
      const geo  = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([pts[i], pts[i+1]]), 4, ext*0.008, 6, false);
      const mat  = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 });
      scene.add(new THREE.Mesh(geo, mat));
    }

    // Station spheres (key only)
    const keyIdx = new Set([0, positions.length-1]);
    intervals.forEach((iv, i) => { if (iv.dls > 0.1) { keyIdx.add(i); keyIdx.add(i+1); } });
    keyIdx.forEach(i => {
      if (!pts[i]) return;
      const sg = new THREE.SphereGeometry(ext*0.015, 8, 8);
      const sm = new THREE.MeshPhongMaterial({
        color: 0xffffff, emissive: 0x00E5FF, emissiveIntensity: 0.8 });
      const s  = new THREE.Mesh(sg, sm);
      s.position.copy(pts[i]);
      scene.add(s);
    });

    // Lights
    scene.add(new THREE.AmbientLight(0x334455, 1));
    const dl = new THREE.DirectionalLight(0x00E5FF, 0.5);
    dl.position.set(1, 2, 1);
    scene.add(dl);

    // Camera init
    const updateCamera = () => {
      const { theta, phi, radius } = spherical.current;
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta) + (cx-cx),
        radius * Math.cos(phi) - (cz),
        radius * Math.sin(phi) * Math.cos(theta) + (cy-cy));
      camera.lookAt(cx-cx, -cz, cy-cy);
    };
    updateCamera();

    // Animation loop
    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Mouse controls
    const onDown = e => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; };
    const onUp   = () => { isDragging.current = false; };
    const onMove = e => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      spherical.current.theta -= dx * 0.005;
      spherical.current.phi    = Math.max(0.1, Math.min(Math.PI-0.1, spherical.current.phi + dy*0.005));
      updateCamera();
    };
    const onWheel = e => {
      spherical.current.radius = Math.max(ext*0.5, spherical.current.radius * (1 + e.deltaY*0.001));
      updateCamera();
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      cancelAnimationFrame(animRef.current);
      el.removeChild(renderer.domElement);
      renderer.dispose();
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
    };
  }, [positions, intervals]);

  return (
    <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab' }}>
      {positions.length < 2 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
          height:'100%', color: C.muted, fontSize: 11 }}>
          Enter survey data to render trajectory
        </div>
      )}
    </div>
  );
}

// ─── SURVEY INPUT TABLE ────────────────────────────────────────────────────────

function SurveyTable({ stations, onChange }) {
  const update = (i, field, val) => {
    const next = stations.map((s, j) => j === i ? { ...s, [field]: parseFloat(val) || 0 } : s);
    onChange(next);
  };
  const addRow = () => onChange([...stations, { md: stations.at(-1).md + 30, inc: stations.at(-1).inc, az: stations.at(-1).az }]);
  const delRow = i => stations.length > 2 && onChange(stations.filter((_, j) => j !== i));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 28px',
        gap: 4, padding: '0 2px',
      }}>
        {['#','MD [m]','Inc [°]','Az [°]',''].map(h => (
          <div key={h} style={{ color: C.muted, fontSize: 10, letterSpacing:'0.08em', textAlign:'center' }}>{h}</div>
        ))}
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', display:'flex', flexDirection:'column', gap: 3 }}>
        {stations.map((s, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 28px',
            gap: 4, alignItems: 'center', animation: 'slideIn 0.15s ease',
          }}>
            <div style={{ color: C.muted, textAlign:'center', fontSize: 10 }}>{i}</div>
            {['md','inc','az'].map(f => (
              <input key={f} type="number" value={s[f]}
                onChange={e => update(i, f, e.target.value)} step="0.1" />
            ))}
            <button onClick={() => delRow(i)} style={{
              background: 'transparent', color: C.muted, fontSize: 14,
              lineHeight: 1, borderRadius: 3, width: 24, height: 24,
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>×</button>
          </div>
        ))}
      </div>
      <button onClick={addRow} style={{
        background: `${C.accent}14`, border: `1px solid ${C.accentDim}`,
        color: C.accent, fontSize: 11, padding: '5px 0', borderRadius: 3,
        letterSpacing: '0.08em', marginTop: 4,
      }}>+ ADD STATION</button>
    </div>
  );
}

// ─── CUSTOM TOOLTIP ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 4, padding: '8px 12px', fontSize: 11,
    }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.accent }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toFixed(3) : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [stations, setStations] = useState(DEFAULT_STATIONS);
  const [bha]      = useState(DEFAULT_BHA);
  const [form]     = useState(DEFAULT_FORMATION);
  const [wob, setWob] = useState(80);
  const [material, setMaterial] = useState('S-135');
  const [rpm, setRpm] = useState(120);
  const [activeTab, setActiveTab] = useState('survey');

  // Compute everything reactively
  const survey  = useMemo(() => computeSurvey(stations), [stations]);
  const { intervals, positions } = survey;

  const unc     = useMemo(() =>
    computeISCWSA(stations, intervals), [stations, intervals]);

  const tdRes   = useMemo(() =>
    computeTorqueDrag(stations, positions, intervals, { wob, rpm }), [stations, positions, intervals, wob, rpm]);

  const bhaVal  = useMemo(() =>
    validateBHA(intervals, bha, wob), [intervals, bha, wob]);

  const stab    = useMemo(() =>
    computeStability(stations, positions, form), [stations, positions, form]);

  const fatigue = useMemo(() =>
    computeFatigue(intervals, { material, rpm }), [intervals, material, rpm]);

  const maxDLS  = useMemo(() => Math.max(0, ...intervals.map(iv => iv.dls)), [intervals]);
  const critBHA = bhaVal.filter(r => r.status !== 'OK').length;
  const critFat = fatigue.filter(r => r.status !== 'OK').length;

  // Alert summary
  const alerts = useMemo(() => {
    const list = [];
    intervals.forEach((iv, i) => {
      if (iv.dls > 15) list.push({ level:'CRITICAL', msg:`Interval S${i}→S${i+1}: DLS ${iv.dls.toFixed(2)}°/30m exceeds critical limit (15°/30m)` });
      else if (iv.dls > 8) list.push({ level:'ALERT', msg:`Interval S${i}→S${i+1}: DLS ${iv.dls.toFixed(2)}°/30m exceeds warning limit (8°/30m)` });
    });
    bhaVal.forEach(r => {
      if (r.status === 'VIOLATION') list.push({ level:'CRITICAL', msg:`BHA ${r.interval}: ${r.violations[0]}` });
      else if (r.status === 'CAUTION') list.push({ level:'ALERT', msg:`BHA ${r.interval}: near operational limit` });
    });
    stab.forEach(s => {
      if (s.status === 'CLOSED') list.push({ level:'CRITICAL', msg:`MD ${s.md}m: Mud weight window CLOSED` });
    });
    return list;
  }, [intervals, bhaVal, stab]);

  const TABS = ['survey','trajectory','alerts','t&d','fatigue','stability'];

  return (
    <>
      <style>{globalCSS}</style>
      <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>

        {/* ── TOPBAR ─────────────────────────────────────────────────────── */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'0 20px', height: 52,
          background: C.surface, borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap: 14 }}>
            <div style={{
              fontFamily:'Syne', fontWeight:800, fontSize:22, letterSpacing:'0.05em',
              color: C.accent, textShadow:`0 0 20px ${C.accent}80`,
            }}>DLSS</div>
            <div style={{
              fontSize: 10, color: C.muted, letterSpacing:'0.15em',
              borderLeft:`1px solid ${C.border}`, paddingLeft: 14,
            }}>DOG LEG SEVERITY SIMULATOR · v2.2</div>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            {alerts.length > 0 && (
              <AlertBadge status="ALERT" label={`${alerts.length} ALERT${alerts.length>1?'S':''}`}/>
            )}
            <div style={{ fontSize:10, color: C.muted }}>
              {stations.length} STATIONS · MD {Math.max(...stations.map(s=>s.md)).toFixed(0)}m
            </div>
            <div style={{
              background:`${C.ok}18`, border:`1px solid ${C.ok}40`,
              borderRadius:3, padding:'3px 10px', fontSize:10, color: C.ok,
              letterSpacing:'0.1em',
            }}>● LIVE</div>
          </div>
        </div>

        {/* ── MAIN LAYOUT ────────────────────────────────────────────────── */}
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

          {/* LEFT SIDEBAR — inputs */}
          <div style={{
            width: 300, flexShrink:0, borderRight:`1px solid ${C.border}`,
            overflowY:'auto', background: C.surface, padding: 12,
            display:'flex', flexDirection:'column', gap: 10,
          }}>
            <Panel title="Operational Parameters" accent>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div>
                  <div style={{color:C.muted,fontSize:10,marginBottom:3}}>WOB [kN]</div>
                  <input type="number" value={wob} onChange={e=>setWob(+e.target.value)} min={0} max={300} step={5}/>
                </div>
                <div>
                  <div style={{color:C.muted,fontSize:10,marginBottom:3}}>RPM</div>
                  <input type="number" value={rpm} onChange={e=>setRpm(+e.target.value)} min={0} max={300} step={10}/>
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <div style={{color:C.muted,fontSize:10,marginBottom:3}}>Drill Pipe Grade</div>
                  <select value={material} onChange={e=>setMaterial(e.target.value)}>
                    {Object.keys(MATERIALS).map(m=><option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            </Panel>

            <Panel title="Survey Stations" accent>
              <SurveyTable stations={stations} onChange={setStations}/>
            </Panel>

            <Panel title="BHA Configuration">
              {bha.map((c,i)=>(
                <div key={i} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'5px 0', borderBottom:`1px solid ${C.border}`,
                }}>
                  <span style={{fontSize:11}}>{c.name}</span>
                  <span style={{color:C.muted,fontSize:10}}>{c.maxDLS}°/30m</span>
                </div>
              ))}
            </Panel>
          </div>

          {/* CENTER — main content */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

            {/* KPI bar */}
            <div style={{
              display:'grid', gridTemplateColumns:'repeat(6,1fr)',
              gap:1, padding:'10px 12px', borderBottom:`1px solid ${C.border}`,
              background: C.surface, flexShrink:0,
            }}>
              <StatBadge label="MAX DLS" value={maxDLS.toFixed(2)} unit="°/30m"
                status={maxDLS>15?'CRITICAL':maxDLS>8?'ALERT':'OK'}/>
              <StatBadge label="HOOK LOAD OUT" value={(tdRes.summary.hookLoadOut/9.81).toFixed(1)} unit="ton"/>
              <StatBadge label="SURFACE TORQUE" value={tdRes.summary.surfaceTorque.toFixed(2)} unit="kN·m"/>
              <StatBadge label="MAX VON MISES" value={tdRes.summary.maxVonMises.toFixed(1)} unit="MPa"/>
              <StatBadge label="BHA ALERTS" value={critBHA} unit="" status={critBHA>0?'CRITICAL':'OK'}/>
              <StatBadge label="FATIGUE ALERTS" value={critFat} unit="" status={critFat>0?'CRITICAL':'OK'}/>
            </div>

            {/* Tab bar */}
            <div style={{
              display:'flex', gap:1, padding:'8px 12px 0',
              background: C.surface, borderBottom:`1px solid ${C.border}`,
              flexShrink:0,
            }}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setActiveTab(t)} style={{
                  padding:'6px 14px', borderRadius:'4px 4px 0 0',
                  background: activeTab===t ? C.panel : 'transparent',
                  color: activeTab===t ? C.accent : C.muted,
                  borderBottom: activeTab===t ? `2px solid ${C.accent}` : '2px solid transparent',
                  fontSize: 10, letterSpacing:'0.1em', textTransform:'uppercase',
                  transition:'all 0.15s',
                }}>{t}</button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex:1, overflow:'auto', padding:12 }}>

              {/* SURVEY TAB */}
              {activeTab==='survey' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Panel title="Survey Results">
                    <div style={{ maxHeight:400, overflowY:'auto' }}>
                      <div style={{
                        display:'grid', gridTemplateColumns:'repeat(7,1fr)',
                        gap:2, marginBottom:4,
                      }}>
                        {['MD','Inc','Az','DLS','TVD','N','E'].map(h=>(
                          <div key={h} style={{color:C.muted,fontSize:9,textAlign:'center',letterSpacing:'0.06em'}}>{h}</div>
                        ))}
                      </div>
                      {positions.map((p,i)=>{
                        const intv = intervals[i-1];
                        const dls  = intv ? intv.dls : null;
                        const dCol = dls == null ? C.text : dls>15?C.danger:dls>8?C.warn:C.text;
                        return (
                          <div key={i} style={{
                            display:'grid', gridTemplateColumns:'repeat(7,1fr)',
                            gap:2, padding:'3px 0',
                            borderBottom:`1px solid ${C.gridLine}`,
                          }}>
                            {[p.md, stations[i]?.inc, stations[i]?.az,
                              dls!=null?dls.toFixed(3):'-',
                              p.tvd.toFixed(2), p.north.toFixed(2), p.east.toFixed(2)
                            ].map((v,j)=>(
                              <div key={j} style={{
                                textAlign:'center', fontSize:10,
                                color: j===3 ? dCol : C.text,
                                fontWeight: j===3 && dls>8 ? 700 : 400,
                              }}>{v}</div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </Panel>

                  <Panel title="DLS Profile">
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart data={intervals.map(iv=>({
                        md: `${iv.from.toFixed(0)}`, dls: +iv.dls.toFixed(3),
                      }))}>
                        <CartesianGrid stroke={C.gridLine} vertical={false}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd"/>
                        <YAxis tick={{fill:C.muted,fontSize:9}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <ReferenceLine y={8}  stroke={C.warn}   strokeDasharray="4 3" label={{value:'Alert',fill:C.warn,fontSize:9}}/>
                        <ReferenceLine y={15} stroke={C.danger} strokeDasharray="4 3" label={{value:'Critical',fill:C.danger,fontSize:9}}/>
                        <Bar dataKey="dls" name="DLS °/30m" radius={[2,2,0,0]}>
                          {intervals.map((iv,i)=>(
                            <Cell key={i} fill={iv.dls>15?C.danger:iv.dls>8?C.warn:iv.dls>0?C.ok:C.border}/>
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Panel>
                </div>
              )}

              {/* TRAJECTORY TAB */}
              {activeTab==='trajectory' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:12, height:'100%' }}>
                  <Panel title="3D Wellbore Trajectory — drag to rotate · scroll to zoom" style={{height:'100%',minHeight:480}}>
                    <div style={{ height:'calc(100% - 32px)', minHeight:440 }}>
                      <TrajectoryViewer positions={positions} intervals={intervals}/>
                    </div>
                  </Panel>
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    <Panel title="Vertical Section">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={positions.map(p=>({
                          horiz: Math.sqrt(p.north**2+p.east**2).toFixed(1),
                          tvd: p.tvd.toFixed(1),
                        }))}>
                          <CartesianGrid stroke={C.gridLine}/>
                          <XAxis dataKey="horiz" tick={{fill:C.muted,fontSize:9}} label={{value:'Horiz [m]',fill:C.muted,fontSize:9,dy:10}}/>
                          <YAxis reversed tick={{fill:C.muted,fontSize:9}} label={{value:'TVD [m]',fill:C.muted,fontSize:9,angle:-90,dx:-10}}/>
                          <Tooltip content={<CustomTooltip/>}/>
                          <Line type="monotone" dataKey="tvd" stroke={C.accent} dot={false} strokeWidth={2} name="TVD"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </Panel>
                    <Panel title="Plan View">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={positions.map(p=>({east:p.east.toFixed(1),north:p.north.toFixed(1)}))}>
                          <CartesianGrid stroke={C.gridLine}/>
                          <XAxis dataKey="east" tick={{fill:C.muted,fontSize:9}} label={{value:'East [m]',fill:C.muted,fontSize:9,dy:10}}/>
                          <YAxis tick={{fill:C.muted,fontSize:9}} label={{value:'North [m]',fill:C.muted,fontSize:9,angle:-90,dx:-10}}/>
                          <Tooltip content={<CustomTooltip/>}/>
                          <Line type="monotone" dataKey="north" stroke={C.gold} dot={false} strokeWidth={2} name="North"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </Panel>
                  </div>
                </div>
              )}

              {/* ALERTS TAB */}
              {activeTab==='alerts' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Panel title="System Alerts" accent={alerts.length>0}>
                    {alerts.length === 0 ? (
                      <div style={{ color:C.ok, fontSize:12, textAlign:'center', padding:20 }}>
                        ✓ All systems nominal
                      </div>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {alerts.map((a,i)=>(
                          <div key={i} style={{
                            background:`${statusColor(a.level)}10`,
                            border:`1px solid ${statusColor(a.level)}30`,
                            borderRadius:4, padding:'8px 12px',
                            display:'flex', gap:10, alignItems:'flex-start',
                          }}>
                            <span style={{color:statusColor(a.level),fontWeight:700,flexShrink:0}}>{a.level}</span>
                            <span style={{color:C.text,lineHeight:1.5}}>{a.msg}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>

                  <Panel title="BHA Status by Interval">
                    <div style={{maxHeight:400, overflowY:'auto', display:'flex', flexDirection:'column', gap:3}}>
                      {bhaVal.map((r,i)=>(
                        <div key={i} style={{
                          display:'flex', justifyContent:'space-between', alignItems:'center',
                          padding:'5px 8px', borderRadius:3,
                          background:`${statusColor(r.status)}08`,
                          border:`1px solid ${statusColor(r.status)}20`,
                        }}>
                          <span style={{fontSize:10}}>{r.interval}: {r.from.toFixed(0)}→{r.to.toFixed(0)}m</span>
                          <AlertBadge status={r.status}/>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

              {/* T&D TAB */}
              {activeTab==='t&d' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Panel title="Hook Load vs MD">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={positions.map((p,i)=>({
                        md: p.md.toFixed(0),
                        tripOut: tdRes.tripOut[i]?.toFixed(1),
                        tripIn:  tdRes.tripIn[i]?.toFixed(1),
                        rotating:tdRes.rotating[i]?.toFixed(1),
                      }))}>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}}/>
                        <YAxis tick={{fill:C.muted,fontSize:9}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line dataKey="tripOut"  name="Trip Out [kN]"  stroke={C.danger} dot={false} strokeWidth={2}/>
                        <Line dataKey="tripIn"   name="Trip In [kN]"   stroke={C.ok}     dot={false} strokeWidth={2}/>
                        <Line dataKey="rotating" name="Rotating [kN]"  stroke={C.accent} dot={false} strokeWidth={2}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                  <Panel title="Von Mises Stress + Torque">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={positions.map((p,i)=>({
                        md: p.md.toFixed(0),
                        vm:    tdRes.vonMises[i]?.toFixed(2),
                        torque:tdRes.torque[i]?.toFixed(3),
                      }))}>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}}/>
                        <YAxis tick={{fill:C.muted,fontSize:9}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line dataKey="vm"     name="Von Mises [MPa]" stroke={C.gold}   dot={false} strokeWidth={2}/>
                        <Line dataKey="torque" name="Torque [kN·m]"   stroke={C.accent} dot={false} strokeWidth={1} strokeDasharray="4 2"/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                </div>
              )}

              {/* FATIGUE TAB */}
              {activeTab==='fatigue' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Panel title="Cumulative Damage (Palmgren-Miner)">
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={fatigue.map(r=>({
                        md: r.from.toFixed(0),
                        damage: +(r.Dcum*100).toFixed(3),
                      }))}>
                        <defs>
                          <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={C.danger} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={C.danger} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}}/>
                        <YAxis tick={{fill:C.muted,fontSize:9}} domain={[0,100]}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <ReferenceLine y={20} stroke={C.warn}   strokeDasharray="3 2" label={{value:'Caution 20%',fill:C.warn,fontSize:9}}/>
                        <ReferenceLine y={80} stroke={C.danger} strokeDasharray="3 2" label={{value:'Critical 80%',fill:C.danger,fontSize:9}}/>
                        <Area dataKey="damage" name="Damage %" stroke={C.danger} fill="url(#fatGrad)" strokeWidth={2}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </Panel>
                  <Panel title="Bending Stress per Interval">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={fatigue.map(r=>({
                        md: r.from.toFixed(0), stress: +r.Sbend.toFixed(2),
                      }))}>
                        <CartesianGrid stroke={C.gridLine} vertical={false}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd"/>
                        <YAxis tick={{fill:C.muted,fontSize:9}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Bar dataKey="stress" name="σ_bend [MPa]" radius={[2,2,0,0]}>
                          {fatigue.map((r,i)=>(
                            <Cell key={i} fill={r.Sbend>200?C.danger:r.Sbend>100?C.warn:C.ok}/>
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Panel>
                </div>
              )}

              {/* STABILITY TAB */}
              {activeTab==='stability' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Panel title="Mud Weight Window [kg/m³]">
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={stab.filter(s=>+s.tvd>100).map(s=>({
                        tvd: +s.tvd, MWmin: +s.MWmin, MWmax: +s.MWmax, MWpore: +s.MWpore,
                      }))}>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="tvd" tick={{fill:C.muted,fontSize:9}} label={{value:'TVD [m]',fill:C.muted,fontSize:9,dy:10}}/>
                        <YAxis tick={{fill:C.muted,fontSize:9}} domain={[900,4000]}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line dataKey="MWmin"  name="MW Min [kg/m³]"  stroke={C.danger} dot={false} strokeWidth={2}/>
                        <Line dataKey="MWmax"  name="MW Max [kg/m³]"  stroke={C.ok}     dot={false} strokeWidth={2}/>
                        <Line dataKey="MWpore" name="Pore Press EQ"   stroke={C.gold}   dot={false} strokeWidth={1} strokeDasharray="4 2"/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                  <Panel title="Formation Status">
                    <div style={{maxHeight:320, overflowY:'auto', display:'flex', flexDirection:'column', gap:3}}>
                      {stab.filter(s=>+s.tvd>100).map((s,i)=>(
                        <div key={i} style={{
                          display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 80px',
                          gap:4, padding:'5px 6px', borderRadius:3,
                          background:`${statusColor(s.status)}06`,
                          borderBottom:`1px solid ${C.gridLine}`,
                        }}>
                          {[`${s.md}m`,`${s.MWmin}`,`${s.MWmax}`,`Δ${s.window}`].map((v,j)=>(
                            <span key={j} style={{fontSize:10,color:j===3&&+s.window<150?C.warn:C.text}}>{v}</span>
                          ))}
                          <AlertBadge status={s.status}/>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* BOTTOM STATUS BAR */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'0 16px', height:28,
          background: C.surface, borderTop:`1px solid ${C.border}`,
          flexShrink:0,
        }}>
          <div style={{display:'flex',gap:16}}>
            <span style={{fontSize:9,color:C.muted}}>
              METHOD: Minimum Curvature (ISCWSA/API SPE-84246)
            </span>
            <span style={{fontSize:9,color:C.muted}}>
              UNCERTAINTY: ISCWSA MWD Rev4 (Williamson 2000 SPE-67616)
            </span>
            <span style={{fontSize:9,color:C.muted}}>
              T&D: Johancsik-Dawson-Talbot (SPE-11380)
            </span>
            <span style={{fontSize:9,color:C.muted}}>
              FATIGUE: API RP 7G + DNV-RP-C203 + Holford (1992)
            </span>
          </div>
          <div style={{fontSize:9,color:C.muted}}>
            DLSS © 2025 · WEATHERFORD CONFIDENTIAL
          </div>
        </div>
      </div>
    </>
  );
}
