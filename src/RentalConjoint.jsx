import React, { useState, useRef, useEffect } from "react";

// ── 属性定義 ──────────────────────────────────
const ATTRS = [
  { id:"walk", label:"駅徒歩",   short:"駅徒歩分",  levels:["5分以内","10分","15分","20分以上"], pref:-1 },
  { id:"age",  label:"築年数",   short:"築年数",    levels:["新築〜5年","6〜15年","16〜25年","26年以上"], pref:-1 },
  { id:"area", label:"専有面積", short:"専有面積",  levels:["〜25㎡","26〜35㎡","36〜50㎡","51〜70㎡","71㎡〜"], pref:+1 },
];

const BTYPE_OPTIONS = [
  { id:"mansion",   label:"マンション" },
  { id:"apartment", label:"アパート" },
  { id:"house",     label:"一戸建て" },
];

const BYO_ITEMS = [
  { id:"pet",      label:"ペット可" },
  { id:"parking",  label:"駐車場あり" },
  { id:"washer",   label:"室内洗濯機置場" },
  { id:"aircon",   label:"エアコン付" },
  { id:"bath",     label:"バス・トイレ別" },
  { id:"autolock", label:"オートロック" },
];

const BYO_OPTIONS = [
  { value:"must", label:"必須",       bg:"#2B5EA7", fg:"#fff" },
  { value:"any",  label:"条件にしない", bg:"#4A7C59", fg:"#fff" },
];

// ── カラートークン ─────────────────────────────
const C = {
  bg:"#F5F0E8", card:"#FFFFFF", ink:"#1C1814", muted:"#7A7470",
  accent:"#2B5EA7", accentL:"#EBF0FA", line:"#E5DDD0",
  green:"#4A7C59", red:"#C94040",
};
const btnStyle = (bg, fg="#fff", ex={}) => ({
  background:bg, color:fg, border:"none", borderRadius:8,
  padding:"14px 28px", fontSize:15, fontWeight:700, cursor:"pointer", ...ex,
});

// ── タスク生成（支配ペア除去）─────────────────
function buildTasks() {
  // シード付き乱数
  let s = 73819;
  const rnd = () => { s=(s*1664525+1013904223)>>>0; return s/4294967295; };

  // Fisher-Yates shuffle
  function shuffle(arr) {
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(rnd()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  // 支配チェック（xがyを支配するか）
  function dominates(x,y) {
    let better=false;
    for(const at of ATTRS){
      const xv=x[at.id], yv=y[at.id];
      if(at.pref===-1){ if(xv>yv) return false; if(xv<yv) better=true; }
      else             { if(xv<yv) return false; if(xv>yv) better=true; }
    }
    return better;
  }

  // プロファイルプール
  const pool=[];
  for(let w=0;w<4;w++)
    for(let a=0;a<4;a++)
      for(let s2=0;s2<5;s2++)
        pool.push({walk:w,age:a,area:s2});

  const tasks=[];
  let tries=0;
  while(tasks.length<15 && tries<5000){
    tries++;
    const [p0,p1,p2]=shuffle(pool).slice(0,3);
    const trio=[p0,p1,p2];

    // 支配ペアがあればスキップ
    if(dominates(p0,p1)||dominates(p1,p0)) continue;
    if(dominates(p0,p2)||dominates(p2,p0)) continue;
    if(dominates(p1,p2)||dominates(p2,p1)) continue;

    // 2属性以上同じペアがあれば退屈なのでスキップ
    const tooClose = trio.some((a,i)=>trio.some((b,j)=>{
      if(i>=j) return false;
      return ATTRS.filter(at=>a[at.id]===b[at.id]).length>=2;
    }));
    if(tooClose) continue;

    // 重複タスクチェック
    const key=trio.map(p=>`${p.walk}${p.age}${p.area}`).sort().join("-");
    if(tasks.some(t=>t.key===key)) continue;

    tasks.push({id:tasks.length+1, profiles:trio, key});
  }

  // 万が一足りなければ無条件で追加
  while(tasks.length<15){
    const [p0,p1,p2]=shuffle(pool).slice(0,3);
    tasks.push({id:tasks.length+1, profiles:[p0,p1,p2], key:"fallback"});
  }

  return tasks;
}

const TASKS = buildTasks();

const STORAGE_KEY = "rentalConjoint:lastResult:v1";


function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}
function saveResult(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}


// ── 相場取得（現在は無効化・手入力誘導）──────────
// TODO: サーバ側プロキシ実装後に復帰
// 直接外部AI APIをブラウザから叩くと、APIキー漏洩・CORSのリスクがあるため停止中
async function fetchRentFloor(area, btypes) {
  return null;
}

// ── CBC エンジン ──────────────────────────────
function effectCode(lvl,n){
  const c=new Array(n-1).fill(0);
  if(lvl<n-1) c[lvl]=1; else c.fill(-1);
  return c;
}
function toVec(p){
  return [...effectCode(p.walk,4),...effectCode(p.age,4),...effectCode(p.area,5)];
}
function softmax(u){
  const m=Math.max(...u),e=u.map(x=>Math.exp(x-m)),s=e.reduce((a,b)=>a+b,0);
  return e.map(x=>x/s);
}
function dot(a,b){return a.reduce((s,x,i)=>s+x*b[i],0);}

function runMAP(responses,iters=150,lr=0.08,lam=0.05){
  const b=new Array(10).fill(0);
  for(let it=0;it<iters;it++){
    const g=new Array(10).fill(0);
    for(const r of responses){
      const vecs=r.profiles.map(toVec),probs=softmax(vecs.map(v=>dot(b,v)));
      for(let k=0;k<10;k++){
        const ex=probs.reduce((s,p,j)=>s+p*vecs[j][k],0);
        g[k]+=vecs[r.chosen][k]-ex;
      }
    }
    for(let k=0;k<10;k++) b[k]+=lr*(g[k]-lam*b[k]);
  }
  return b;
}

function calcPartworths(betas){
  const specs=[{id:"walk",n:4,off:0},{id:"age",n:4,off:3},{id:"area",n:5,off:6}];
  const pw={};
  for(const{id,n,off}of specs){
    const v=[];let s=0;
    for(let i=0;i<n-1;i++){v.push(betas[off+i]);s+=betas[off+i];}
    v.push(-s);pw[id]=v;
  }
  return pw;
}

function calcImportance(pw){
  let tot=0;const ranges={};
  for(const[id,v]of Object.entries(pw)){const r=Math.max(...v)-Math.min(...v);ranges[id]=r;tot+=r;}
  const imp={};
  for(const[id,r]of Object.entries(ranges))imp[id]=tot>0?r/tot*100:33.3;
  return imp;
}

function getMidFeedback(responses){
  const b=runMAP(responses,60,0.1,0.05),pw=calcPartworths(b),imp=calcImportance(pw);
  const topId=Object.entries(imp).sort(([,a],[,b])=>b-a)[0][0];
  const attr=ATTRS.find(a=>a.id===topId),best=pw[topId].indexOf(Math.max(...pw[topId]));
  return{attr,level:attr.levels[best]};
}

function getRecommendation(pw,btypes){
  const bw=pw.walk.indexOf(Math.max(...pw.walk));
  const ba=pw.age.indexOf(Math.max(...pw.age));
  const bs=pw.area.indexOf(Math.max(...pw.area));
  const hasHouse=btypes.includes("house"),hasMansion=btypes.includes("mansion");
  if(hasHouse&&bs>=3)return{icon:"🏡",name:"ファミリー向け賃貸一戸建て",tags:["一戸建て","広め","郊外OK"],desc:"広さとプライバシーを最重視するタイプ。庭付きや駐車場ありの郊外物件が最適です。"};
  if(bw<=1&&ba<=1&&bs>=2&&hasMansion)return{icon:"🏙",name:"都市型高スペックマンション",tags:["マンション","駅近","築浅","広め"],desc:"駅近・築浅・広さの3拍子を求めるこだわり派。利便性と居住性を両立したいタイプ。"};
  if(bw<=1)return{icon:"🚉",name:"駅近優先マンション・アパート",tags:["駅近","立地優先","コンパクト可"],desc:"何よりも立地と通勤利便性を優先するタイプ。築年数や広さより「場所」で選ぶスタイルです。"};
  if(bs>=3)return{icon:"🏠",name:"広さ重視ファミリー物件",tags:["広め","ファミリー向け","郊外OK"],desc:"居住空間の広さを最優先。駅距離は多少あっても、ゆとりある生活を重視するタイプ。"};
  if(ba>=2)return{icon:"🔑",name:"コスパ重視リノベ物件",tags:["築古OK","コスパ重視","リノベ向き"],desc:"築年数を許容してコストを抑えるタイプ。リノベ済み・デザイナーズ系と相性が良いです。"};
  return{icon:"⚖️",name:"バランス重視スタンダード",tags:["バランス型","選択肢広め"],desc:"特定条件への偏りが小さく、総合バランスで判断するタイプ。エリアや予算に合わせて柔軟に対応できます。"};
}

// ─────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────
export default function App(){
  const[stage,   setStage]   =useState("landing");
  const[saved,  setSaved]  =useState(()=>loadSaved());

  // landing に戻った時も localStorage から再読込（再診断で state をリセットしても「前回レポート」を出す）
  useEffect(() => {
    if (stage !== "landing") return;
    const s = loadSaved();
    if (s) setSaved(s);
  }, [stage]);
  const[prereqs, setPrereqs] =useState({rentMin:"",rentMax:"",area:""});
  const[btypes,  setBtypes]  =useState([]);
  const[byo,     setByo]     =useState({});
  const[taskIdx, setTaskIdx] =useState(0);
  const[resps,   setResps]   =useState([]);
  const[feedback,setFeedback]=useState(null);
  
  const [midShown, setMidShown] = useState(false);
const[results, setResults] =useState(null);

  const progress=(taskIdx/TASKS.length)*100;

  function handleChoice(chosenIdx){
    const nr=[...resps,{profiles:TASKS[taskIdx].profiles,chosen:chosenIdx}];
    setResps(nr);
    if(taskIdx===7 && !midShown){setMidShown(true);setFeedback(getMidFeedback(nr));return;}
    if(taskIdx<TASKS.length-1)setTaskIdx(taskIdx+1);
    else finalize(nr);
  }
  function goBack(){
    setTaskIdx(prev => {
      const nextIdx = Math.max(0, prev - 1);
      setResps(rp => rp.slice(0, nextIdx));
      return nextIdx;
    });
  }
  function afterFeedback(){
    setFeedback(null);
    setTaskIdx(prev => {
      const next = prev + 1;
      if (next < TASKS.length) return next;
      finalize(resps);
      return prev;
    });
  }
  function finalize(rs){
    const b=runMAP(rs),pw=calcPartworths(b),imp=calcImportance(pw);
    const payload = {
      savedAt: new Date().toISOString(),
      prereqs,
      btypes,
      byo,
      results: { pw, imp, rec: getRecommendation(pw, btypes) },
    };
    setResults(payload.results);
    saveResult(payload);
    setSaved(payload);
    setStage("result");
  }
  function restart(){
    setMidShown(false);
    setStage("landing");setPrereqs({rentMin:"",rentMax:"",area:""});
    setBtypes([]);setByo({});setTaskIdx(0);setResps([]);setFeedback(null);setResults(null);
  }


const openSaved = () => {
  const s = saved || loadSaved();
  if (!s) return;
  if (s.prereqs) setPrereqs(s.prereqs);
  if (s.btypes) setBtypes(s.btypes);
  if (s.byo) setByo(s.byo);
  if (s.results) setResults(s.results);
  setSaved(s);
  setStage("result");
};

const importSaved = (payload) => {
  if (!payload || typeof payload !== "object") return;
  try {
    if (payload.prereqs) setPrereqs(payload.prereqs);
    if (payload.btypes) setBtypes(payload.btypes);
    if (payload.byo) setByo(payload.byo);
    if (payload.results) setResults(payload.results);
    saveResult(payload);
    setSaved(payload);
    setStage("result");
  } catch {}
};

  if(feedback)          return <FeedbackPage msg={feedback} onContinue={afterFeedback}/>;  if(stage==="landing") return (
    <LandingPage
      onStart={()=>{ setMidShown(false); setStage("prereqs"); }}
      hasSaved={!!saved}
      onOpenSaved={openSaved}
      onImportSaved={importSaved}
    />
  ); setStage("prereqs"); }} hasSaved={!!saved} onOpenSaved={()=>{ if(saved){ if(saved.prereqs) setPrereqs(saved.prereqs); if(saved.btypes) setBtypes(saved.btypes); if(saved.byo) setByo(saved.byo); if(saved.results) setResults(saved.results); setStage("result"); } }} onImportSaved={(payload)=>{ if(!payload) return; try{ if(payload.prereqs) setPrereqs(payload.prereqs); if(payload.btypes) setBtypes(payload.btypes); if(payload.byo) setByo(payload.byo); if(payload.results) setResults(payload.results); saveResult(payload); setSaved(payload); setStage("result"); }catch{}} }}/>;
  if(stage==="prereqs") return <PrereqsPage  prereqs={prereqs} setPrereqs={setPrereqs} btypes={btypes} setBtypes={setBtypes} onNext={()=>setStage("byo")}/>;
  if(stage==="byo")     return <BYOPage      byo={byo} setByo={setByo} btypes={btypes} onNext={()=>setStage("cbc")} onBack={()=>setStage("prereqs")}/>;
  if(stage==="cbc")     return <CBCPage      task={TASKS[taskIdx]} taskIdx={taskIdx} progress={progress} onChoice={handleChoice} onBack={goBack}/>;
  if(stage==="result")  return <ResultPage   results={results} prereqs={prereqs} btypes={btypes} byo={byo} savedPayload={saved} onClearSaved={()=>{ try{ localStorage.removeItem(STORAGE_KEY);}catch{} setSaved(null); }} onRestart={restart}/>;
  return null;
}

// ─────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────
function Header({taskNum,total}){
  return(
    <div style={{borderBottom:`1px solid ${C.line}`,background:C.card}}>
      <div style={{maxWidth:960,margin:"0 auto",padding:"14px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontWeight:900,fontSize:17,letterSpacing:"-0.5px",color:C.ink}}>住まい優先度診断</div>
          <div style={{fontSize:10,color:C.muted,marginTop:1,letterSpacing:0.5}}>Your Home Preference Analysis</div>
        </div>
        {taskNum!=null&&<div style={{fontFamily:"monospace",fontSize:13,color:C.muted,fontWeight:600}}>Q {taskNum} / {total}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LANDING
// ─────────────────────────────────────────────
function LandingPage({onStart, hasSaved, onOpenSaved, onImportSaved}){
  return(
    <div style={{minHeight:"100vh",background:C.bg}}>
      <Header/>
      <div style={{maxWidth:700,margin:"0 auto",padding:"72px 24px 80px"}}>
        <div style={{display:"inline-block",background:C.accentL,color:C.accent,fontSize:11,fontWeight:700,padding:"4px 14px",borderRadius:20,letterSpacing:1,marginBottom:28}}>
          所要時間 約4〜6分
        </div>
        <h1 style={{fontSize:"clamp(28px,5.5vw,48px)",fontWeight:900,lineHeight:1.2,color:C.ink,marginBottom:20,letterSpacing:"-1px"}}>
          あなたが<span style={{color:C.accent}}>本当に求める</span><br/>住まいの条件を知る
        </h1>
        <p style={{fontSize:15,color:C.muted,lineHeight:1.8,marginBottom:44}}>
          「駅近か、広さか」「新築か、コスパか」——住まい探しでは、全部は叶わないものです。
          15回の比較選択に答えるだけで、あなたが重視する傾向（優先順位）を数値化し、ぴったりな物件タイプを提案します。
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:48}}>
          {[
            {n:"01",t:"基本条件の設定",     d:"エリア・建物タイプ・賃料の前提を入力"},
            {n:"02",t:"設備のこだわり確認",  d:"ペット可・駐車場など設備の希望を選択"},
            {n:"03",t:"15問の比較選択",     d:"3つの物件を比べてより好みのものを選ぶ"},
            {n:"04",t:"優先度レポート",      d:"重視度スコアとぴったりな物件タイプを表示"},
          ].map(item=>(
            <div key={item.n} style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:12,padding:"20px"}}>
              <div style={{fontFamily:"monospace",fontSize:10,color:C.accent,marginBottom:6,fontWeight:700}}>{item.n}</div>
              <div style={{fontWeight:700,fontSize:13,color:C.ink,marginBottom:4}}>{item.t}</div>
              <div style={{fontSize:12,color:C.muted}}>{item.d}</div>
            </div>
          ))}
        </div>
        <button onClick={onStart} style={btnStyle(C.ink,"#fff",{fontSize:16,padding:"16px 44px"})}>診断を始める →</button>
        {hasSaved&&(
          <button onClick={onOpenSaved} style={btnStyle("transparent",C.accent,{marginTop:14,border:`1px solid ${C.accent}`,padding:"12px 18px",borderRadius:10,fontWeight:800})}>
            前回のレポートを開く
          </button>
        )}
        <div style={{marginTop:14,fontSize:12,color:C.muted,lineHeight:1.6}}>
          ※保存は「このURL × このブラウザ」に保持されます（プレビューURLや別ブラウザだと引き継がれません）
        </div>
        <div style={{marginTop:14}}>
          <ImportBox onImport={onImportSaved}/>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PREREQS（エリア＋建物タイプ＋賃料）
// ─────────────────────────────────────────────
function PrereqsPage({prereqs,setPrereqs,btypes,setBtypes,onNext}){
  const[foc,setFoc]=useState({});
  const[loading,setLoading]=useState(false);
  const[suggested,setSuggested]=useState(null);
  const[suggestErr,setSuggestErr]=useState(false);
  const[userEditedMin,setUserEditedMin]=useState(false);
  const debRef=useRef(null);
  const btRef=useRef(btypes);
  btRef.current=btypes;

  const fo=id=>setFoc(p=>({...p,[id]:true}));
  const fb=id=>setFoc(p=>({...p,[id]:false}));
  const inp=id=>({
    width:"100%",padding:"12px 14px",
    border:`1.5px solid ${foc[id]?C.accent:C.line}`,
    borderRadius:8,fontSize:14,outline:"none",
    boxSizing:"border-box",background:"#FAFAF8",
  });

  function doFetch(area,types){
    if(!area.trim()||types.length===0)return;
    clearTimeout(debRef.current);
    debRef.current=setTimeout(async()=>{
      setLoading(true);setSuggestErr(false);
      try{
        const floor=await fetchRentFloor(area,types);
        if(floor!=null){
          setSuggested(floor);
          setUserEditedMin(prev=>{
            if(!prev) setPrereqs(p=>({...p,rentMin:String(floor)}));
            return prev;
          });
        }else setSuggestErr(true);
      }catch{setSuggestErr(true);}
      finally{setLoading(false);}
    },800);
  }

  function handleAreaBlur(){
    fb("ar");
    doFetch(prereqs.area,btRef.current);
  }

  function toggleBtype(id){
    const next=btypes.includes(id)?btypes.filter(x=>x!==id):[...btypes,id];
    setBtypes(next);
    doFetch(prereqs.area,next);
  }

  const valid=prereqs.area.trim().length>0&&btypes.length>0;

  return(
    <div style={{minHeight:"100vh",background:C.bg}}>
      <Header/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{maxWidth:580,margin:"0 auto",padding:"60px 24px"}}>
        <Step n="1" label="基本条件の設定" sub="診断の前提条件を入力してください。賃料は比較選択には使いません。"/>

        <div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:16,padding:32,marginBottom:16}}>

          {/* エリア */}
          <FLabel text="希望エリア" required/>
          <input type="text" placeholder="例: 渋谷区、横浜市、京都市など"
            value={prereqs.area}
            onChange={e=>setPrereqs(p=>({...p,area:e.target.value}))}
            onFocus={()=>fo("ar")} onBlur={handleAreaBlur}
            style={inp("ar")}/>

          {/* 建物タイプ */}
          <div style={{marginTop:24}}>
            <FLabel text="希望する建物タイプ" required/>
            <div style={{fontSize:11,color:C.muted,marginBottom:12}}>複数選択可。こだわりなしの場合はすべて選択してください。</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {BTYPE_OPTIONS.map(opt=>{
                const active=btypes.includes(opt.id);
                return(
                  <button key={opt.id} onClick={()=>toggleBtype(opt.id)} style={{
                    padding:"10px 22px",borderRadius:10,
                    border:`2px solid ${active?C.accent:C.line}`,
                    background:active?C.accentL:"transparent",
                    color:active?C.accent:C.muted,
                    fontSize:14,fontWeight:700,cursor:"pointer",transition:"all 0.15s",
                  }}>
                    {active?"✓ ":""}{opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 賃料 */}
          <div style={{marginTop:28}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <FLabel text="賃料の範囲（任意）"/>
              {loading&&(
                <span style={{fontSize:11,color:C.accent,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
                  <span style={{display:"inline-block",width:11,height:11,border:`2px solid ${C.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                  相場を取得中...
                </span>
              )}
              {!loading&&suggested&&!suggestErr&&(
                <span style={{fontSize:11,color:C.green,fontWeight:700,background:"#F0FAF3",padding:"3px 10px",borderRadius:20,border:`1px solid ${C.green}`}}>
                  ✓ 相場下限 {suggested.toLocaleString()}円 を提案
                </span>
              )}
              {!loading&&suggestErr&&(
                <span style={{fontSize:11,color:C.muted}}>相場取得に失敗しました</span>
              )}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{position:"relative",flex:1}}>
                <input type="number" placeholder="下限"
                  value={prereqs.rentMin}
                  onChange={e=>{setUserEditedMin(true);setPrereqs(p=>({...p,rentMin:e.target.value}));}}
                  onFocus={()=>fo("rm")} onBlur={()=>fb("rm")}
                  style={{...inp("rm"),paddingRight:36}}/>
                <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted}}>円</span>
              </div>
              <span style={{color:C.muted}}>〜</span>
              <div style={{position:"relative",flex:1}}>
                <input type="number" placeholder="上限"
                  value={prereqs.rentMax}
                  onChange={e=>setPrereqs(p=>({...p,rentMax:e.target.value}))}
                  onFocus={()=>fo("rx")} onBlur={()=>fb("rx")}
                  style={{...inp("rx"),paddingRight:36}}/>
                <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted}}>円</span>
              </div>
            </div>
            {suggested&&!loading&&!suggestErr&&(
              <div style={{marginTop:8,fontSize:11,color:C.muted,display:"flex",alignItems:"center",gap:8}}>
                ※ {prereqs.area}の実勢相場から自動入力しました。
                {userEditedMin&&(
                  <button onClick={()=>{setUserEditedMin(false);setPrereqs(p=>({...p,rentMin:String(suggested)}));}}
                    style={{fontSize:11,color:C.accent,background:"none",border:"none",cursor:"pointer",textDecoration:"underline",padding:0}}>
                    提案値に戻す
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <button onClick={onNext} disabled={!valid}
          style={btnStyle(valid?C.ink:"#CCC","#fff",{width:"100%",cursor:valid?"pointer":"not-allowed"})}>
          次へ：こだわり条件 →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// BYO
// ─────────────────────────────────────────────
function BYOPage({byo,setByo,btypes,onNext,onBack}){
  const set1=(id,val)=>setByo(p=>({...p,[id]:val}));
  const activeItems = btypes.includes("mansion") ? BYO_ITEMS : BYO_ITEMS.filter(i => i.id !== "autolock");
  const allDone=activeItems.every(i=>byo[i.id]);
  return(
    <div style={{minHeight:"100vh",background:C.bg}}>
      <Header/>
      <div style={{maxWidth:600,margin:"0 auto",padding:"60px 24px"}}>
        <Step n="2" label="設備のこだわり確認" sub="各設備について「必須 / 条件にしない」を選んでください。"/>
        <div style={{fontSize:12,color:C.muted,margin:"-18px 0 18px",lineHeight:1.6}}>
          「必須」= この条件がない物件は除外する想定 ／「条件にしない」= あってもなくてもOK
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:28}}>
          {activeItems.map(item=>(
            <div key={item.id} style={{
              background:C.card,border:`1.5px solid ${byo[item.id]?C.accent:C.line}`,
              borderRadius:12,padding:"14px 18px",
              display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
              transition:"border-color 0.2s",
            }}>
              <span style={{fontWeight:700,fontSize:14,color:C.ink,minWidth:130}}>{item.label}</span>
              <div style={{display:"flex",gap:6}}>
                {BYO_OPTIONS.map(opt=>{
                  const active=byo[item.id]===opt.value;
                  return(
                    <button key={opt.value} onClick={()=>set1(item.id,opt.value)} style={{
                      padding:"6px 12px",borderRadius:20,
                      border:`1.5px solid ${active?opt.bg:C.line}`,
                      background:active?opt.bg:"transparent",
                      color:active?opt.fg:C.muted,
                      fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s",
                    }}>{opt.label}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:12}}>
          <button onClick={onBack} style={btnStyle("transparent",C.muted,{border:`1px solid ${C.line}`})}>← 戻る</button>
          <button onClick={onNext} disabled={!allDone}
            style={btnStyle(allDone?C.ink:"#CCC","#fff",{flex:1,cursor:allDone?"pointer":"not-allowed"})}>
            診断スタート →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CBC
// ─────────────────────────────────────────────
function CBCPage({task,taskIdx,progress,onChoice,onBack}){
  const[hov,setHov]=useState(null);
  return(
    <div style={{minHeight:"100vh",background:C.bg}}>
      <div style={{height:3,background:C.line}}>
        <div style={{height:"100%",background:C.accent,width:`${progress}%`,transition:"width 0.4s"}}/>
      </div>
      <Header taskNum={taskIdx+1} total={TASKS.length}/>
      <div style={{maxWidth:980,margin:"0 auto",padding:"44px 24px 64px"}}>
        <p style={{textAlign:"center",fontSize:18,fontWeight:700,color:C.ink,marginBottom:6}}>
          より希望に近い物件はどれですか？
        </p>
        <p style={{textAlign:"center",fontSize:12,color:C.muted,marginBottom:36}}>
          賃料・エリア・建物タイプは同条件として比較してください
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:32}}>
          {task.profiles.map((prof,idx)=>{
            const isH=hov===idx;
            return(
              <button key={idx} onClick={()=>onChoice(idx)}
                onMouseEnter={()=>setHov(idx)} onMouseLeave={()=>setHov(null)}
                style={{
                  background:isH?C.ink:C.card,
                  border:`2px solid ${isH?C.ink:C.line}`,
                  borderRadius:16,padding:22,textAlign:"left",cursor:"pointer",
                  transition:"all 0.18s",
                  transform:isH?"translateY(-4px)":"translateY(0)",
                  boxShadow:isH?"0 14px 36px rgba(0,0,0,0.13)":"none",
                }}>
                <div style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  width:30,height:30,borderRadius:8,marginBottom:20,
                  background:isH?"rgba(255,255,255,0.15)":C.accentL,
                  color:isH?"#fff":C.accent,
                  fontFamily:"monospace",fontWeight:900,fontSize:13,
                }}>
                  {["A","B","C"][idx]}
                </div>
                {ATTRS.map((attr,ai)=>(
                  <div key={attr.id} style={{
                    borderBottom:ai<ATTRS.length-1?`1px solid ${isH?"rgba(255,255,255,0.1)":C.line}`:"none",
                    paddingBottom:12,marginBottom:12,
                  }}>
                    <div style={{fontSize:9,fontWeight:700,color:isH?"rgba(255,255,255,0.45)":C.muted,marginBottom:3,letterSpacing:0.5}}>
                      {attr.short}
                    </div>
                    <div style={{fontSize:14,fontWeight:700,color:isH?"#fff":C.ink}}>
                      {attr.levels[prof[attr.id]]}
                    </div>
                  </div>
                ))}
                <div style={{marginTop:8,fontSize:11,fontWeight:700,textAlign:"center",color:isH?"rgba(255,255,255,0.6)":C.accent}}>
                  {isH?"これを選ぶ ✓":"タップして選択"}
                </div>
              </button>
            );
          })}
        </div>
        {taskIdx>0&&(
          <div style={{textAlign:"center"}}>
            <button onClick={onBack} style={{background:"transparent",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontWeight:600}}>
              ← 前の問題に戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MID FEEDBACK
// ─────────────────────────────────────────────
function FeedbackPage({msg,onContinue}){
  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{maxWidth:480,padding:"40px 32px",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:20}}>📊</div>
        <div style={{fontSize:11,color:C.accent,fontWeight:700,letterSpacing:1,marginBottom:12}}>折り返しチェック</div>
        <h2 style={{fontSize:26,fontWeight:900,color:C.ink,marginBottom:24}}>折り返し地点です</h2>
        <div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:16,padding:28,marginBottom:32}}>
          <div style={{fontSize:12,color:C.muted,marginBottom:8}}>今のところ、あなたは...</div>
          <div style={{fontSize:22,fontWeight:900,color:C.ink,marginBottom:4}}>「{msg.attr.label}：{msg.level}」</div>
          <div style={{fontSize:13,color:C.muted}}>を重視する傾向が出ています</div>
        </div>
        <button onClick={onContinue} style={btnStyle(C.ink,"#fff",{fontSize:15,padding:"14px 40px"})}>後半へ進む →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RESULT
// ─────────────────────────────────────────────
function ResultPage({results,prereqs,btypes,byo,savedPayload,onClearSaved,onRestart}){
  const{pw,imp,rec}=results;
  const impOrder=Object.entries(imp).sort(([,a],[,b])=>b-a).map(([id,v])=>({id,v,attr:ATTRS.find(a=>a.id===id)}));
  const activeItems = btypes.includes("mansion") ? BYO_ITEMS : BYO_ITEMS.filter(i => i.id !== "autolock");
  const mustItems=activeItems.filter(i=>byo[i.id]==="must");
  const anyItems=activeItems.filter(i=>byo[i.id]==="any");
  const selBtypes=BTYPE_OPTIONS.filter(o=>btypes.includes(o.id));

  return(
    <div style={{minHeight:"100vh",background:C.bg}}>
      <Header/>
      <div style={{maxWidth:800,margin:"0 auto",padding:"56px 24px 80px"}}>
        <div style={{marginBottom:44}}>
          <div style={{fontSize:10,fontWeight:700,color:C.accent,letterSpacing:2,marginBottom:12}}>RESULT</div>
          <h2 style={{fontSize:36,fontWeight:900,color:C.ink,marginBottom:10,letterSpacing:"-1px"}}>あなたの住まい優先度レポート</h2>
          {prereqs.area&&(
            <p style={{fontSize:13,color:C.muted}}>
              エリア：{prereqs.area}　タイプ：{selBtypes.map(o=>o.label).join("・")}
              {prereqs.rentMin&&prereqs.rentMax?`　賃料：${Number(prereqs.rentMin).toLocaleString()}〜${Number(prereqs.rentMax).toLocaleString()}円`
                :prereqs.rentMax?`　賃料：〜${Number(prereqs.rentMax).toLocaleString()}円`
                :prereqs.rentMin?`　賃料：${Number(prereqs.rentMin).toLocaleString()}円〜`:""}
            </p>
          )}
        </div>

        {/* おすすめタイプ */}
        <div style={{background:C.ink,borderRadius:20,padding:"40px",marginBottom:24,color:"#fff",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",right:-10,top:-10,fontSize:120,opacity:0.06,lineHeight:1}}>{rec.icon}</div>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:2,marginBottom:16}}>最適物件タイプ</div>
          <div style={{display:"flex",alignItems:"flex-start",gap:20,marginBottom:20}}>
            <div style={{fontSize:44}}>{rec.icon}</div>
            <div>
              <h3 style={{fontSize:26,fontWeight:900,marginBottom:10,color:"#fff"}}>{rec.name}</h3>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.65)",lineHeight:1.75,maxWidth:480}}>{rec.desc}</p>
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {rec.tags.map(tag=>(
              <span key={tag} style={{background:"rgba(255,255,255,0.12)",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.75)"}}>{tag}</span>
            ))}
          </div>
        </div>

        {/* 重視度 */}
        <div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:16,padding:32,marginBottom:20}}>
          <SLabel text="条件の重視度ランキング"/>
          <div style={{display:"flex",flexDirection:"column",gap:20}}>
            {impOrder.map((item,i)=>(
              <div key={item.id}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontFamily:"monospace",fontSize:10,color:i===0?C.accent:C.muted,fontWeight:700}}>0{i+1}</span>
                    <span style={{fontWeight:700,fontSize:15,color:C.ink}}>{item.attr.label}</span>
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:i===0?C.accent:C.muted}}>{item.v.toFixed(1)}%</span>
                </div>
                <div style={{height:6,background:C.line,borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${item.v}%`,background:i===0?C.accent:"#B0A898",borderRadius:3}}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 詳細スコア */}
        <div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:16,padding:32,marginBottom:20}}>
          <SLabel text="各条件の詳細スコア"/>
          <div style={{display:"flex",flexDirection:"column",gap:28}}>
            {ATTRS.map(attr=>{
              const vals=pw[attr.id],lo=Math.min(...vals),hi=Math.max(...vals),rng=hi-lo||1,bestI=vals.indexOf(hi);
              return(
                <div key={attr.id}>
                  <div style={{fontWeight:700,fontSize:13,color:C.ink,marginBottom:12}}>{attr.label}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {attr.levels.map((lv,li)=>{
                      const pct=((vals[li]-lo)/rng)*100,isBest=li===bestI;
                      return(
                        <div key={li} style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{fontSize:11,width:90,textAlign:"right",color:isBest?C.accent:C.muted,fontWeight:isBest?700:400}}>{lv}</div>
                          <div style={{flex:1,height:5,background:C.line,borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${Math.max(pct,3)}%`,background:isBest?C.accent:"#C8C0B0",borderRadius:3}}/>
                          </div>
                          {isBest&&<span style={{fontSize:9,color:C.accent,fontWeight:700,minWidth:40}}>◀ TOP</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 希望まとめ */}
        <div style={{background:C.card,border:`1px solid ${C.line}`,borderRadius:16,padding:32,marginBottom:28}}>
          <SLabel text="設備・条件の希望まとめ"/>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:10}}>希望建物タイプ</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {selBtypes.map(o=>(
                <span key={o.id} style={{background:C.accentL,border:`1px solid ${C.accent}`,color:C.accent,padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:700}}>{o.label}</span>
              ))}
            </div>
          </div>
          {mustItems.length>0&&(
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.green,marginBottom:8}}>✓ 必須設備</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {mustItems.map(i=>(
                  <span key={i.id} style={{background:"#F0FAF3",border:`1px solid ${C.green}`,color:C.green,padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:700}}>{i.label}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{marginTop:10,fontSize:12,color:C.muted}}>条件にしない設備：{anyItems.length}件</div>
        </div>

        <div style={{display:"flex",gap:12}}>
          <button onClick={()=>window.print()} style={btnStyle(C.card,C.ink,{flex:1,border:`1px solid ${C.line}`})}>🖨️ 印刷・保存</button>
          <button onClick={async()=>{try{const txt=JSON.stringify(savedPayload??{prereqs,btypes,byo,results},null,2); await navigator.clipboard.writeText(txt); alert("結果JSONをコピーしました");}catch{alert("コピーに失敗しました（ブラウザ設定をご確認ください）");}}} style={btnStyle(C.card,C.ink,{flex:1,border:`1px solid ${C.line}`})}>📋 結果JSONをコピー</button>
          <button onClick={()=>{if(confirm("保存したレポートを削除しますか？")) onClearSaved?.();}} style={btnStyle(C.card,C.ink,{flex:1,border:`1px solid ${C.line}`})}>🧹 保存を消す</button>
          <button onClick={onRestart} style={btnStyle(C.ink,"#fff",{flex:1})}>↩ もう一度やってみる</button>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────
// ImportBox (JSON復元)
// ─────────────────────────────────────────────
function ImportBox({onImport}){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState("");
  const [err,setErr]=useState("");
  return (
    <div style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:12,padding:"12px 14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <div style={{fontWeight:800,fontSize:12,color:C.ink}}>JSONから復元（別URL/別端末から移行したい時）</div>
        <button onClick={()=>setOpen(o=>!o)} style={btnStyle(open?C.ink:"transparent",open?"#fff":C.ink,{padding:"8px 10px",borderRadius:10,border:open?"none":`1px solid ${C.line}`})}>
          {open?"閉じる":"開く"}
        </button>
      </div>
      {open&&(
        <div style={{marginTop:10}}>
          <textarea value={text} onChange={e=>{setText(e.target.value); setErr("");}} placeholder="ここに結果JSONを貼り付け" rows={6}
            style={{width:"100%",border:`1px solid ${C.line}`,borderRadius:10,padding:10,fontSize:12,fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace"}}/>
          {err&&<div style={{marginTop:8,color:"#b42318",fontSize:12,fontWeight:700}}>{err}</div>}
          <div style={{display:"flex",gap:10,marginTop:10}}>
            <button onClick={()=>{setText(""); setErr("");}} style={btnStyle("transparent",C.ink,{border:`1px solid ${C.line}`,flex:1})}>クリア</button>
            <button onClick={()=>{try{const p=JSON.parse(text); if(!p||typeof p!=="object") throw new Error(); onImport?.(p); setOpen(false);}catch{setErr("JSONの形式が不正です");}}}
              style={btnStyle(C.accent,"#fff",{flex:1})}>復元する</button>
          </div>
          <div style={{marginTop:8,fontSize:11,color:C.muted,lineHeight:1.5}}>
            ※復元すると、この端末の保存データも上書きされます
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TINY HELPERS
// ─────────────────────────────────────────────
function Step({n,label,sub}){
  return(
    <div style={{marginBottom:36}}>
      <div style={{fontFamily:"monospace",fontSize:10,color:C.accent,fontWeight:700,marginBottom:10,letterSpacing:1}}>STEP {n} / 3</div>
      <h2 style={{fontSize:26,fontWeight:900,color:C.ink,marginBottom:6,letterSpacing:"-0.5px"}}>{label}</h2>
      <p style={{fontSize:13,color:C.muted}}>{sub}</p>
    </div>
  );
}
function FLabel({text,required}){
  return(
    <label style={{display:"block",fontSize:13,fontWeight:700,color:C.ink,marginBottom:10}}>
      {text}{required&&<span style={{color:C.red,fontSize:10,marginLeft:4}}>必須</span>}
    </label>
  );
}
function SLabel({text}){
  return<div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:20}}>{text}</div>;
}
