import { useState, useEffect, useRef, useMemo } from 'react';
import {
  computeSurvey, computeTorqueDrag, validateBHA,
  computeStability, computeFatigue,
  DEFAULT_STATIONS, DEFAULT_BHA, DEFAULT_FORMATION, MATERIALS,
} from './physics.js';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, AreaChart, Area,
} from 'recharts';

const C = {
  bg:'#080C12', surface:'#0D1420', panel:'#111827', border:'#1E2D40',
  accent:'#00E5FF', accentDim:'#005F6B', gold:'#FFB800',
  danger:'#FF3B30', warn:'#FF9500', ok:'#30D158',
  text:'#E8EDF2', muted:'#5A6A7A', gridLine:'#1A2535',
};

const statusColor = s =>
  s==='CRITICAL'||s==='VIOLATION'||s==='FAILURE'||s==='COLLISION_RISK' ? C.danger
  : s==='ALERT'||s==='WARNING'||s==='CAUTION'||s==='NARROW' ? C.warn : C.ok;

const globalCSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body,#root{height:100%;width:100%;overflow:hidden;}
  body{background:${C.bg};color:${C.text};font-family:'JetBrains Mono',monospace;font-size:12px;-webkit-font-smoothing:antialiased;}
  ::-webkit-scrollbar{width:4px;height:4px;}
  ::-webkit-scrollbar-track{background:${C.bg};}
  ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
  input[type=number],select{background:${C.bg};border:1px solid ${C.border};color:${C.text};font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 6px;border-radius:3px;outline:none;width:100%;}
  input[type=number]:focus,select:focus{border-color:${C.accent};}
  button{font-family:'JetBrains Mono',monospace;cursor:pointer;border:none;outline:none;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  @keyframes slideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
`;

function Panel({ title, children, accent=false, style={} }) {
  return (
    <div style={{background:C.panel,border:`1px solid ${accent?C.accent:C.border}`,borderRadius:6,overflow:'hidden',...style}}>
      {title && (
        <div style={{padding:'7px 12px',borderBottom:`1px solid ${accent?C.accentDim:C.border}`,display:'flex',alignItems:'center',gap:8}}>
          {accent && <span style={{width:6,height:6,borderRadius:'50%',background:C.accent,display:'inline-block',boxShadow:`0 0 6px ${C.accent}`}}/>}
          <span style={{fontFamily:'Syne,sans-serif',fontWeight:700,fontSize:11,letterSpacing:'0.12em',color:accent?C.accent:C.muted,textTransform:'uppercase'}}>{title}</span>
        </div>
      )}
      <div style={{padding:12}}>{children}</div>
    </div>
  );
}

function StatBadge({ label, value, unit, status }) {
  const col = status ? statusColor(status) : C.accent;
  return (
    <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:'8px 12px',textAlign:'center'}}>
      <div style={{color:C.muted,fontSize:10,letterSpacing:'0.1em',marginBottom:4}}>{label}</div>
      <div style={{color:col,fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:18}}>
        {value}<span style={{fontSize:11,fontWeight:400,color:C.muted}}> {unit}</span>
      </div>
    </div>
  );
}

function AlertBadge({ status, label }) {
  const col = statusColor(status);
  const isAlert = status!=='OK'&&status!=='ADEQUATE'&&status!=='HEALTHY';
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,background:`${col}18`,border:`1px solid ${col}40`,borderRadius:3,padding:'2px 7px',fontSize:10,color:col,letterSpacing:'0.08em',animation:isAlert?'pulse 2s infinite':'none'}}>
      <span style={{width:5,height:5,borderRadius:'50%',background:col}}/>
      {label||status}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,padding:'8px 12px',fontSize:11}}>
      <div style={{color:C.muted,marginBottom:4}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||C.accent}}>
          {p.name}: <strong>{typeof p.value==='number'?p.value.toFixed(3):p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// ─── FIX 1: 3D VIEWER — SVG fallback, no Three.js WebGL issues ───────────────
function TrajectoryViewer3D({ positions, intervals }) {
  const svgRef = useRef(null);
  const [angle, setAngle] = useState({ x: 30, y: -45 });
  const isDrag = useRef(false);
  const last   = useRef({ x:0, y:0 });

  const projected = useMemo(() => {
    if (positions.length < 2) return [];
    const Ns = positions.map(p=>p.north);
    const Es = positions.map(p=>p.east);
    const Ts = positions.map(p=>p.tvd);
    const cx=(Math.min(...Ns)+Math.max(...Ns))/2;
    const cy=(Math.min(...Es)+Math.max(...Es))/2;
    const cz=(Math.min(...Ts)+Math.max(...Ts))/2;
    const ext=Math.max(Math.max(...Ns)-Math.min(...Ns),Math.max(...Es)-Math.min(...Es),Math.max(...Ts)-Math.min(...Ts),100);
    const scale = 360/ext;
    const ax=angle.x*Math.PI/180, ay=angle.y*Math.PI/180;
    return positions.map(p=>{
      const x=(p.north-cx)*scale, y=-(p.tvd-cz)*scale, z=(p.east-cy)*scale;
      const x1=x*Math.cos(ay)+z*Math.sin(ay);
      const z1=-x*Math.sin(ay)+z*Math.cos(ay);
      const y1=y*Math.cos(ax)-z1*Math.sin(ax);
      return { sx:x1+400, sy:y1+240, depth:z1 };
    });
  }, [positions, angle]);

  const dlsVals = [0,...intervals.map(iv=>iv.dls)];
  const maxDLS  = Math.max(...dlsVals,1);

  const onDown = e=>{ isDrag.current=true; last.current={x:e.clientX,y:e.clientY}; };
  const onUp   = ()=>{ isDrag.current=false; };
  const onMove = e=>{
    if(!isDrag.current) return;
    const dx=e.clientX-last.current.x, dy=e.clientY-last.current.y;
    last.current={x:e.clientX,y:e.clientY};
    setAngle(a=>({x:Math.max(-80,Math.min(80,a.x+dy*0.4)),y:a.y+dx*0.4}));
  };

  if (positions.length < 2) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:C.muted,fontSize:11}}>
      Enter survey data to render trajectory
    </div>
  );

  return (
    <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 800 480"
      style={{cursor:'grab',userSelect:'none'}}
      onMouseDown={onDown} onMouseUp={onUp} onMouseLeave={onUp} onMouseMove={onMove}>
      {/* Background grid lines */}
      {[-3,-2,-1,0,1,2,3].map(i=>(
        <line key={`gx${i}`} x1={400+i*60} y1={80} x2={400+i*60} y2={400} stroke={C.gridLine} strokeWidth={0.5}/>
      ))}
      {[-2,-1,0,1,2,3,4].map(i=>(
        <line key={`gy${i}`} x1={80} y1={240+i*40} x2={720} y2={240+i*40} stroke={C.gridLine} strokeWidth={0.5}/>
      ))}
      {/* Depth label */}
      <text x={20} y={100} fill={C.muted} fontSize={9} fontFamily="JetBrains Mono">TVD↓</text>
      <text x={740} y={244} fill={C.muted} fontSize={9} fontFamily="JetBrains Mono">E→</text>
      {/* Trajectory segments */}
      {projected.slice(0,-1).map((p,i)=>{
        const p2=projected[i+1];
        const dls=dlsVals[i+1]||0;
        const t=dls/maxDLS;
        const col=t<0.3?C.accent:t<0.6?C.gold:C.danger;
        return <line key={i} x1={p.sx} y1={p.sy} x2={p2.sx} y2={p2.sy} stroke={col} strokeWidth={2.5} strokeLinecap="round"/>;
      })}
      {/* Key station dots */}
      {projected.map((p,i)=>{
        const dls=dlsVals[i]||0;
        if(i!==0&&i!==projected.length-1&&dls<0.1) return null;
        return <circle key={i} cx={p.sx} cy={p.sy} r={4} fill={C.accent} opacity={0.9}/>;
      })}
      {/* Labels for first and last */}
      {projected.length>0&&<text x={projected[0].sx+6} y={projected[0].sy-6} fill={C.accent} fontSize={9} fontFamily="JetBrains Mono">SURFACE</text>}
      {projected.length>1&&<text x={projected.at(-1).sx+6} y={projected.at(-1).sy+4} fill={C.gold} fontSize={9} fontFamily="JetBrains Mono">TD</text>}
      {/* Legend */}
      <g transform="translate(620,30)">
        <rect x={0} y={0} width={160} height={52} rx={3} fill={C.surface} stroke={C.border}/>
        <circle cx={12} cy={14} r={4} fill={C.accent}/><text x={20} y={18} fill={C.text} fontSize={9} fontFamily="JetBrains Mono">Low DLS</text>
        <circle cx={12} cy={30} r={4} fill={C.gold}/><text x={20} y={34} fill={C.text} fontSize={9} fontFamily="JetBrains Mono">Medium DLS</text>
        <circle cx={12} cy={46} r={4} fill={C.danger}/><text x={20} y={50} fill={C.text} fontSize={9} fontFamily="JetBrains Mono">High DLS</text>
      </g>
      <text x={400} y={470} fill={C.muted} fontSize={9} fontFamily="JetBrains Mono" textAnchor="middle">Drag to rotate · color = DLS severity</text>
    </svg>
  );
}

function SurveyTable({ stations, onChange }) {
  const update = (i,f,v)=> onChange(stations.map((s,j)=>j===i?{...s,[f]:parseFloat(v)||0}:s));
  const addRow = ()=> onChange([...stations,{md:stations.at(-1).md+30,inc:stations.at(-1).inc,az:stations.at(-1).az}]);
  const delRow = i=> stations.length>2&&onChange(stations.filter((_,j)=>j!==i));
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      <div style={{display:'grid',gridTemplateColumns:'24px 1fr 1fr 1fr 20px',gap:3,padding:'0 2px'}}>
        {['#','MD','Inc','Az',''].map(h=><div key={h} style={{color:C.muted,fontSize:9,textAlign:'center',letterSpacing:'0.06em'}}>{h}</div>)}
      </div>
      <div style={{maxHeight:300,overflowY:'auto',display:'flex',flexDirection:'column',gap:2}}>
        {stations.map((s,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'24px 1fr 1fr 1fr 20px',gap:3,alignItems:'center',animation:'slideIn 0.15s ease'}}>
            <div style={{color:C.muted,textAlign:'center',fontSize:9}}>{i}</div>
            {['md','inc','az'].map(f=>(
              <input key={f} type="number" value={s[f]} onChange={e=>update(i,f,e.target.value)} step="0.1"/>
            ))}
            <button onClick={()=>delRow(i)} style={{background:'transparent',color:C.muted,fontSize:13,lineHeight:1,borderRadius:2,width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
          </div>
        ))}
      </div>
      <button onClick={addRow} style={{background:`${C.accent}14`,border:`1px solid ${C.accentDim}`,color:C.accent,fontSize:11,padding:'5px 0',borderRadius:3,letterSpacing:'0.08em',marginTop:4}}>
        + ADD STATION
      </button>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [stations, setStations] = useState(DEFAULT_STATIONS);
  const [wob,  setWob]  = useState(80);
  const [rpm,  setRpm]  = useState(120);
  const [mat,  setMat]  = useState('S-135');
  const [tab,  setTab]  = useState('survey');
  const bha  = DEFAULT_BHA;
  const form = DEFAULT_FORMATION;

  const survey  = useMemo(()=>computeSurvey(stations),[stations]);
  const { intervals, positions } = survey;

  // FIX 2: Von Mises — pass od/id correctly, skip pure-vertical stations in display
  const tdRes = useMemo(()=>computeTorqueDrag(
    stations,positions,intervals,{wob,rpm,odM:0.127,idM:0.109,wBuoyed:0.16,rAvg:0.0635}
  ),[stations,positions,intervals,wob,rpm]);

  const bhaVal  = useMemo(()=>validateBHA(intervals,bha,wob),[intervals,wob]);
  // FIX 3: Stability — skip TVD < 100m to avoid singularity at surface
  const stab    = useMemo(()=>computeStability(stations,positions,form).filter(s=>+s.tvd>=100),[stations,positions]);
  const fatigue = useMemo(()=>computeFatigue(intervals,{material:mat,rpm}),[intervals,mat,rpm]);

  const maxDLS  = Math.max(0,...intervals.map(iv=>iv.dls));
  const critBHA = bhaVal.filter(r=>r.status!=='OK').length;
  const critFat = fatigue.filter(r=>r.status!=='OK').length;

  const alerts = useMemo(()=>{
    const list=[];
    intervals.forEach((iv,i)=>{
      if(iv.dls>15) list.push({level:'CRITICAL',msg:`S${i}→S${i+1} [${iv.from.toFixed(0)}–${iv.to.toFixed(0)}m]: DLS ${iv.dls.toFixed(2)}°/30m — exceeds critical limit (15°/30m)`});
      else if(iv.dls>8) list.push({level:'ALERT',msg:`S${i}→S${i+1} [${iv.from.toFixed(0)}–${iv.to.toFixed(0)}m]: DLS ${iv.dls.toFixed(2)}°/30m — exceeds warning limit (8°/30m)`});
    });
    bhaVal.forEach(r=>{
      if(r.status==='VIOLATION') list.push({level:'CRITICAL',msg:`BHA ${r.interval}: ${r.violations[0]}`});
      else if(r.status==='CAUTION') list.push({level:'ALERT',msg:`BHA ${r.interval}: DLS near operational limit`});
    });
    // FIX 3: No stability alert from surface singularity
    stab.forEach(s=>{
      if(s.status==='CLOSED') list.push({level:'CRITICAL',msg:`MD ${s.md}m (TVD ${s.tvd}m): Mud weight window CLOSED — increase MW above ${s.MWmin} kg/m³`});
    });
    return list;
  },[intervals,bhaVal,stab]);

  const TABS=['survey','trajectory','alerts','t&d','fatigue','stability'];

  // FIX 4: Von Mises chart data — exclude stations where inc=0 AND no side force
  const vmChartData = positions.map((p,i)=>({
    md: p.md.toFixed(0),
    vm: tdRes.vonMises[i]!=null ? +tdRes.vonMises[i].toFixed(2) : 0,
    torque: tdRes.torque[i]!=null ? +tdRes.torque[i].toFixed(3) : 0,
  })).filter((_,i)=> stations[i]?.inc > 0 || i===0);

  return (
    <>
      <style>{globalCSS}</style>
      <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>

        {/* TOPBAR */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px',height:52,background:C.surface,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:22,letterSpacing:'0.05em',color:C.accent,textShadow:`0 0 20px ${C.accent}80`}}>DLSS</div>
            <div style={{fontSize:10,color:C.muted,letterSpacing:'0.15em',borderLeft:`1px solid ${C.border}`,paddingLeft:14}}>
              DOG LEG SEVERITY SIMULATOR · v2.2
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            {alerts.length>0&&<AlertBadge status="ALERT" label={`${alerts.length} ALERT${alerts.length>1?'S':''}`}/>}
            <div style={{fontSize:10,color:C.muted}}>{stations.length} STATIONS · MD {Math.max(...stations.map(s=>s.md)).toFixed(0)}m</div>
            <div style={{background:`${C.ok}18`,border:`1px solid ${C.ok}40`,borderRadius:3,padding:'3px 10px',fontSize:10,color:C.ok,letterSpacing:'0.1em'}}>● LIVE</div>
          </div>
        </div>

        {/* MAIN */}
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>

          {/* SIDEBAR */}
          <div style={{width:290,flexShrink:0,borderRight:`1px solid ${C.border}`,overflowY:'auto',background:C.surface,padding:10,display:'flex',flexDirection:'column',gap:10}}>
            <Panel title="Operational Parameters" accent>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
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
                  <select value={mat} onChange={e=>setMat(e.target.value)}>
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
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:11}}>{c.name}</span>
                  <span style={{color:C.muted,fontSize:10}}>{c.maxDLS}°/30m</span>
                </div>
              ))}
            </Panel>
          </div>

          {/* CENTER */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* KPI BAR */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:1,padding:'10px 12px',borderBottom:`1px solid ${C.border}`,background:C.surface,flexShrink:0}}>
              <StatBadge label="MAX DLS" value={maxDLS.toFixed(2)} unit="°/30m" status={maxDLS>15?'CRITICAL':maxDLS>8?'ALERT':'OK'}/>
              <StatBadge label="HOOK LOAD OUT" value={(tdRes.summary.hookLoadOut/9.81).toFixed(1)} unit="ton"/>
              <StatBadge label="SURFACE TORQUE" value={tdRes.summary.surfaceTorque.toFixed(2)} unit="kN·m"/>
              <StatBadge label="MAX VON MISES" value={tdRes.summary.maxVonMises.toFixed(1)} unit="MPa"/>
              <StatBadge label="BHA ALERTS" value={critBHA} unit="" status={critBHA>0?'CRITICAL':'OK'}/>
              <StatBadge label="FATIGUE ALERTS" value={critFat} unit="" status={critFat>0?'CRITICAL':'OK'}/>
            </div>

            {/* TABS */}
            <div style={{display:'flex',gap:1,padding:'8px 12px 0',background:C.surface,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)} style={{
                  padding:'6px 14px',borderRadius:'4px 4px 0 0',
                  background:tab===t?C.panel:'transparent',
                  color:tab===t?C.accent:C.muted,
                  borderBottom:tab===t?`2px solid ${C.accent}`:'2px solid transparent',
                  fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',transition:'all 0.15s',
                }}>{t}</button>
              ))}
            </div>

            {/* TAB CONTENT */}
            <div style={{flex:1,overflow:'auto',padding:12}}>

              {/* SURVEY */}
              {tab==='survey'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <Panel title="Survey Results">
                    <div style={{maxHeight:420,overflowY:'auto'}}>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4}}>
                        {['MD','Inc','Az','DLS','TVD','N','E'].map(h=>(
                          <div key={h} style={{color:C.muted,fontSize:9,textAlign:'center',letterSpacing:'0.06em'}}>{h}</div>
                        ))}
                      </div>
                      {positions.map((p,i)=>{
                        const dls=intervals[i-1]?.dls??null;
                        const dc=dls==null?C.text:dls>15?C.danger:dls>8?C.warn:C.text;
                        return (
                          <div key={i} style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,padding:'3px 0',borderBottom:`1px solid ${C.gridLine}`}}>
                            {[p.md.toFixed(0),stations[i]?.inc?.toFixed(1),stations[i]?.az?.toFixed(1),
                              dls!=null?dls.toFixed(3):'-',p.tvd.toFixed(1),p.north.toFixed(1),p.east.toFixed(1)
                            ].map((v,j)=>(
                              <div key={j} style={{textAlign:'center',fontSize:10,color:j===3?dc:C.text,fontWeight:j===3&&dls>8?700:400}}>{v}</div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                  <Panel title="DLS Profile [°/30m]">
                    <ResponsiveContainer width="100%" height={380}>
                      <BarChart data={intervals.map(iv=>({md:`${iv.from.toFixed(0)}`,dls:+iv.dls.toFixed(3)}))}>
                        <CartesianGrid stroke={C.gridLine} vertical={false}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd"/>
                        <YAxis tick={{fill:C.muted,fontSize:9}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <ReferenceLine y={8}  stroke={C.warn}   strokeDasharray="4 3" label={{value:'Alert 8',  fill:C.warn,  fontSize:9,position:'right'}}/>
                        <ReferenceLine y={15} stroke={C.danger} strokeDasharray="4 3" label={{value:'Crit 15',  fill:C.danger,fontSize:9,position:'right'}}/>
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

              {/* TRAJECTORY — FIX 1: SVG 3D viewer */}
              {tab==='trajectory'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:12,height:'calc(100vh - 220px)'}}>
                  <Panel title="3D Wellbore Trajectory — drag to rotate · color = DLS" style={{height:'100%'}}>
                    <div style={{height:'calc(100% - 32px)',minHeight:380}}>
                      <TrajectoryViewer3D positions={positions} intervals={intervals}/>
                    </div>
                  </Panel>
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    <Panel title="Vertical Section">
                      <ResponsiveContainer width="100%" height={190}>
                        <LineChart data={positions.map(p=>({horiz:Math.sqrt(p.north**2+p.east**2).toFixed(1),tvd:+p.tvd.toFixed(1)}))}>
                          <CartesianGrid stroke={C.gridLine}/>
                          <XAxis dataKey="horiz" tick={{fill:C.muted,fontSize:9}} label={{value:'Horiz [m]',fill:C.muted,fontSize:8,dy:10}}/>
                          <YAxis reversed tick={{fill:C.muted,fontSize:9}} label={{value:'TVD [m]',fill:C.muted,fontSize:8,angle:-90,dx:-8}}/>
                          <Tooltip content={<CustomTooltip/>}/>
                          <Line type="monotone" dataKey="tvd" stroke={C.accent} dot={false} strokeWidth={2} name="TVD [m]"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </Panel>
                    <Panel title="Plan View (N vs E)">
                      <ResponsiveContainer width="100%" height={190}>
                        <LineChart data={positions.map(p=>({east:+p.east.toFixed(1),north:+p.north.toFixed(1)}))}>
                          <CartesianGrid stroke={C.gridLine}/>
                          <XAxis dataKey="east" tick={{fill:C.muted,fontSize:9}} label={{value:'East [m]',fill:C.muted,fontSize:8,dy:10}}/>
                          <YAxis tick={{fill:C.muted,fontSize:9}} label={{value:'North [m]',fill:C.muted,fontSize:8,angle:-90,dx:-8}}/>
                          <Tooltip content={<CustomTooltip/>}/>
                          <Line type="monotone" dataKey="north" stroke={C.gold} dot={false} strokeWidth={2} name="North [m]"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </Panel>
                  </div>
                </div>
              )}

              {/* ALERTS */}
              {tab==='alerts'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <Panel title="System Alerts" accent={alerts.length>0}>
                    {alerts.length===0?(
                      <div style={{color:C.ok,fontSize:12,textAlign:'center',padding:20,letterSpacing:'0.05em'}}>
                        ✓ All systems nominal
                      </div>
                    ):(
                      <div style={{display:'flex',flexDirection:'column',gap:6}}>
                        {alerts.map((a,i)=>(
                          <div key={i} style={{background:`${statusColor(a.level)}10`,border:`1px solid ${statusColor(a.level)}30`,borderRadius:4,padding:'8px 12px',display:'flex',gap:10,alignItems:'flex-start'}}>
                            <span style={{color:statusColor(a.level),fontWeight:700,flexShrink:0,fontSize:10}}>{a.level}</span>
                            <span style={{color:C.text,lineHeight:1.6,fontSize:11}}>{a.msg}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                  <Panel title="BHA Status by Interval">
                    <div style={{maxHeight:400,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                      {bhaVal.map((r,i)=>(
                        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',borderRadius:3,background:`${statusColor(r.status)}08`,border:`1px solid ${statusColor(r.status)}20`}}>
                          <span style={{fontSize:10}}>{r.interval}: {r.from.toFixed(0)}→{r.to.toFixed(0)}m · {r.dls.toFixed(2)}°/30m</span>
                          <AlertBadge status={r.status}/>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

              {/* T&D — FIX 2 & 4: clean charts */}
              {tab==='t&d'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <Panel title="Hook Load vs MD [kN]">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={positions.map((p,i)=>({
                        md:p.md.toFixed(0),
                        out:+tdRes.tripOut[i]?.toFixed(1),
                        in:+tdRes.tripIn[i]?.toFixed(1),
                        rot:+tdRes.rotating[i]?.toFixed(1),
                      }))}>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd"/>
                        <YAxis tick={{fill:C.muted,fontSize:9}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line dataKey="out" name="Trip Out [kN]" stroke={C.danger} dot={false} strokeWidth={2}/>
                        <Line dataKey="in"  name="Trip In [kN]"  stroke={C.ok}    dot={false} strokeWidth={2}/>
                        <Line dataKey="rot" name="Rotating [kN]" stroke={C.accent} dot={false} strokeWidth={2}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                  <Panel title="Von Mises Stress [MPa] — build & horizontal sections">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={vmChartData}>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd" label={{value:'MD [m]',fill:C.muted,fontSize:9,dy:12}}/>
                        <YAxis tick={{fill:C.muted,fontSize:9}} label={{value:'MPa',fill:C.muted,fontSize:9,angle:-90,dx:-8}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line dataKey="vm"     name="Von Mises [MPa]" stroke={C.gold}   dot={false} strokeWidth={2}/>
                        <Line dataKey="torque" name="Torque [kN·m]"   stroke={C.accent} dot={false} strokeWidth={1} strokeDasharray="4 2"/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                </div>
              )}

              {/* FATIGUE */}
              {tab==='fatigue'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <Panel title="Cumulative Damage — Palmgren-Miner Rule">
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={fatigue.map(r=>({md:r.from.toFixed(0),damage:+(r.Dcum*100).toFixed(4)}))}>
                        <defs>
                          <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={C.danger} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={C.danger} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd"/>
                        <YAxis tick={{fill:C.muted,fontSize:9}} domain={[0,100]} label={{value:'Damage %',fill:C.muted,fontSize:9,angle:-90,dx:-8}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <ReferenceLine y={20} stroke={C.warn}   strokeDasharray="3 2" label={{value:'Caution 20%', fill:C.warn,  fontSize:9,position:'right'}}/>
                        <ReferenceLine y={80} stroke={C.danger} strokeDasharray="3 2" label={{value:'Critical 80%',fill:C.danger,fontSize:9,position:'right'}}/>
                        <Area dataKey="damage" name="Damage %" stroke={C.danger} fill="url(#fatGrad)" strokeWidth={2}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </Panel>
                  <Panel title="Bending Stress per Interval [MPa]">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={fatigue.map(r=>({md:r.from.toFixed(0),stress:+r.Sbend.toFixed(2)}))}>
                        <CartesianGrid stroke={C.gridLine} vertical={false}/>
                        <XAxis dataKey="md" tick={{fill:C.muted,fontSize:9}} interval="preserveStartEnd"/>
                        <YAxis tick={{fill:C.muted,fontSize:9}} label={{value:'MPa',fill:C.muted,fontSize:9,angle:-90,dx:-8}}/>
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

              {/* STABILITY — FIX 3: clean data, no surface singularity */}
              {tab==='stability'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <Panel title="Mud Weight Window [kg/m³] vs TVD">
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={stab.map(s=>({tvd:+s.tvd,MWmin:+s.MWmin,MWmax:+s.MWmax,MWpore:+s.MWpore}))}>
                        <CartesianGrid stroke={C.gridLine}/>
                        <XAxis dataKey="tvd" tick={{fill:C.muted,fontSize:9}} label={{value:'TVD [m]',fill:C.muted,fontSize:8,dy:10}}/>
                        <YAxis tick={{fill:C.muted,fontSize:9}} domain={[900,4500]} label={{value:'kg/m³',fill:C.muted,fontSize:8,angle:-90,dx:-8}}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line dataKey="MWmin"  name="MW Min [kg/m³]" stroke={C.danger} dot={false} strokeWidth={2}/>
                        <Line dataKey="MWmax"  name="MW Max [kg/m³]" stroke={C.ok}    dot={false} strokeWidth={2}/>
                        <Line dataKey="MWpore" name="Pore Pressure EQ" stroke={C.gold} dot={false} strokeWidth={1} strokeDasharray="4 2"/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                  <Panel title="Formation Status">
                    <div style={{maxHeight:320,overflowY:'auto',display:'flex',flexDirection:'column',gap:3}}>
                      <div style={{display:'grid',gridTemplateColumns:'70px 70px 70px 60px 80px',gap:4,padding:'3px 6px'}}>
                        {['MD [m]','MW min','MW max','Window','Status'].map(h=>(
                          <div key={h} style={{color:C.muted,fontSize:9,letterSpacing:'0.06em'}}>{h}</div>
                        ))}
                      </div>
                      {stab.map((s,i)=>(
                        <div key={i} style={{display:'grid',gridTemplateColumns:'70px 70px 70px 60px 80px',gap:4,padding:'4px 6px',borderRadius:3,background:`${statusColor(s.status)}06`,borderBottom:`1px solid ${C.gridLine}`}}>
                          <span style={{fontSize:10}}>{s.md}</span>
                          <span style={{fontSize:10}}>{s.MWmin}</span>
                          <span style={{fontSize:10}}>{s.MWmax}</span>
                          <span style={{fontSize:10,color:+s.window<150?C.warn:C.ok}}>Δ{s.window}</span>
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

        {/* STATUS BAR */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',height:26,background:C.surface,borderTop:`1px solid ${C.border}`,flexShrink:0}}>
          <div style={{display:'flex',gap:16}}>
            {['Minimum Curvature (SPE-84246)','T&D: Johancsik-Dawson-Talbot (SPE-11380)','Fatigue: API RP 7G + DNV-RP-C203','Stability: Kirsch + Mohr-Coulomb'].map(t=>(
              <span key={t} style={{fontSize:9,color:C.muted}}>{t}</span>
            ))}
          </div>
          <div style={{fontSize:9,color:C.muted}}>DLSS © 2025 · WEATHERFORD CONFIDENTIAL</div>
        </div>

      </div>
    </>
  );
}
