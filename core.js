'use strict';
// ============================================================
// 兒科自費：病房登錄 App（index.html）與管理頁（admin.html）共用的程式。
// 資料全部在同一份 Google 試算表：
//   「門診」分頁＝門診表單（Google 表單，放在門診護理師電腦）的回應
//   「病房」分頁＝病房表單的回應：病房 NP 用這個 App 送出；刪除（作廢）紀錄也記在這裡
//   「項目」分頁＝自費項目、價錢、PF 比例、適用起（新增項目、調價都在這裡改）
//   「醫師」分頁＝開單醫師名單
//   「系統」分頁＝病房表單的送出位址與欄位代號（建立腳本自動填好）
// 本檔公開在網站上，所以不含任何姓名、價錢、試算表或表單網址：
//   試算表代號由連結 #s=… 帶進來、存在這台裝置；其他全部從試算表讀。
// ============================================================
const APP_VER='2026.10.23a';
const LS_SHEET='pedsSelfpay_sheet';

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=n=>Math.round(n||0).toLocaleString('en-US');
const pad=n=>String(n).padStart(2,'0');
const sumVals=o=>Object.values(o||{}).reduce((a,b)=>a+b,0);
const keyLabel=k=>{ const [y,m]=k.split('-').map(Number); return `${y}年${m}月`; };
const shiftKey=(k,d)=>{ let [y,m]=k.split('-').map(Number); m+=d; while(m<1){ m+=12; y--; } while(m>12){ m-=12; y++; } return `${y}-${pad(m)}`; };
const todayKey=()=>{ const d=new Date(); return `${d.getFullYear()-1911}-${pad(d.getMonth()+1)}`; };
const isoDay=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const normLabel=l=>String(l==null?'':l).replace(/\s+/g,'');
const hm=ms=>{ const d=new Date(ms); if(!ms||isNaN(d)) return '';
  const t=`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString()===new Date().toDateString()?t:`${d.getMonth()+1}/${d.getDate()} ${t}`; };
// 項目的短名稱（表頭用）：「224項急慢性過敏原」→「224項」
const shortItem=n=>{ const m=String(n||'').match(/^(\d+\s*項)/); return m?m[1].replace(/\s/g,''):n; };

// ---------- 試算表代號：網址 #s=… 優先，記在這台裝置 ----------
function sheetIdOf(s){
  s=String(s||'').trim();
  const m=s.match(/[#&]s=([A-Za-z0-9_-]{30,})/)||s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{30,})/);
  return m?m[1]:(/^[A-Za-z0-9_-]{30,}$/.test(s)?s:null);
}
function getSheetId(){
  const h=sheetIdOf(location.hash);
  if(h){ try{ localStorage.setItem(LS_SHEET,h); }catch(e){} return h; }
  try{ return localStorage.getItem(LS_SHEET)||null; }catch(e){ return null; }
}

// ---------- 讀 Google 試算表（gviz JSONP；試算表要設成「知道連結的人可檢視」） ----------
function gvizRaw(id,sheet){
  if(window.PS_MOCK) return window.PS_MOCK.gviz(sheet);   // 本機測試用的假試算表（_mock.js，不上傳）
  return new Promise((resolve,reject)=>{
    const cb='__gviz'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    const s=document.createElement('script'); let done=false;
    const fin=()=>{ done=true; clearTimeout(t); window[cb]=function(){}; s.remove(); };   // 逾時後晚到的回應：留一個空函式接住
    const t=setTimeout(()=>{ if(!done){ fin(); reject(new Error('連線逾時')); } },20000);
    window[cb]=d=>{ if(done) return; fin();
      if(d&&d.status==='error') reject(new Error((d.errors&&d.errors[0]&&(d.errors[0].detailed_message||d.errors[0].message))||'試算表回傳錯誤'));
      else resolve(d); };
    s.onerror=()=>{ if(!done){ fin(); reject(new Error('讀不到試算表（沒有網路，或試算表沒有開放「知道連結的人可檢視」）')); } };
    s.src=`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=1&sheet=${encodeURIComponent(sheet)}`;
    document.head.appendChild(s);
  });
}
const gcell=c=>c==null?null:(c.v!=null?c.v:(c.f!=null?c.f:null));
// 讀一個分頁 → {cols:[欄名], rows:[[值]]}。分頁名稱不存在時 gviz 不會報錯、而是回第一個分頁，
// 所以用欄名擋：need＝一定要有的欄、not＝一定不能有的欄（例：病房分頁有「作廢」欄、門診沒有）
async function readTab(id,sheet,need,not){
  const d=await gvizRaw(id,sheet), t=(d&&d.table)||{cols:[],rows:[]};
  const cols=(t.cols||[]).map(c=>normLabel(c.label)), has=re=>cols.some(l=>re.test(l));
  if((need&&!need.every(has))||(not&&not.some(has))) throw new Error(`試算表裡找不到「${sheet}」分頁（或欄位名稱被改了）`);
  return {cols,rows:(t.rows||[]).map(r=>(r.c||[]).map(gcell))};
}
// 回傳 {y,m,d,h,mi,s}；認得 gviz 的 Date(2026,9,23,10,5,3)、2026-10-23、2026/10/23、115/10/23
function parseGDate(v){
  if(v==null||v==='') return null;
  const s=String(v).trim(); let m;
  if((m=s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?/))) return {y:+m[1],m:+m[2]+1,d:+m[3],h:+(m[4]||0),mi:+(m[5]||0),s:+(m[6]||0)};
  if((m=s.match(/^(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))){
    let y=+m[1]; if(y<1000) y+=1911; return {y,m:+m[2],d:+m[3],h:+(m[4]||0),mi:+(m[5]||0),s:+(m[6]||0)}; }
  return null;
}
// 適用起：115/12、115-12、2026/12、Date(2026,11,1) → 115-12；空白＝一開始就適用
function parseFrom(v){
  if(v==null||v==='') return null;
  const g=parseGDate(v); if(g) return `${g.y-1911}-${pad(g.m)}`;
  const m=String(v).trim().match(/^(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})/); if(!m) return null;
  let y=+m[1]; if(y>=1000) y-=1911; return `${y}-${pad(+m[2])}`;
}
// 病歷號末3碼：試算表會把 012 存成數字 12，補回 3 位
function mrn3(v){
  if(v==null||v==='') return '';
  if(typeof v==='number') return isFinite(v)&&v>=0&&v<1000&&Number.isInteger(v)?String(v).padStart(3,'0'):String(v);
  const s=String(v).trim(); return /^\d{1,3}$/.test(s)?s.padStart(3,'0'):s;
}
// 醫師姓名：去空白；「溫／温」這類異體字和名單上的對得起來就用名單上的寫法
const VARIANT={'溫':'温','範':'范'};
const canon=s=>[...String(s||'')].map(ch=>VARIANT[ch]||ch).join('');
function normDoc(v,docs){
  const s=String(v==null?'':v).replace(/\s+/g,''); if(!s) return '';
  const hit=(docs||[]).find(n=>canon(n)===canon(s)); return hit||s;
}
const normItem=v=>String(v==null?'':v).replace(/\s+/g,'');

// ---------- 設定：項目／醫師／系統 ----------
function parseItems(t){
  const ci=re=>t.cols.findIndex(l=>re.test(l));
  const iN=ci(/^項目/), iP=ci(/價錢|價格|金額/), iF=ci(/PF/i), iFrom=ci(/適用/), iOff=ci(/停用/);
  const out=[];
  t.rows.forEach((r,i)=>{
    const name=normItem(r[iN]); if(!name) return;
    const price=Number(String(r[iP]==null?'':r[iP]).replace(/[,\s元$]/g,''))||0;
    let pf=iF<0?0.1:r[iF];
    if(typeof pf==='string'){ const p=pf.replace(/[%\s]/g,''); pf=Number(p)||0; if(/%/.test(String(r[iF]))) pf/=100; }
    pf=Number(pf)||0; if(pf>1) pf/=100;   // 打 10 或 10% 都當 10%
    const off=iOff>=0&&(r[iOff]===true||/^(true|v|✓|✔|是|停用|x)$/i.test(String(r[iOff]==null?'':r[iOff]).trim()));
    out.push({name,price,pf,from:iFrom>=0?parseFrom(r[iFrom]):null,off,order:i});
  });
  return out;
}
function parseDocs(t){
  const i=Math.max(0,t.cols.findIndex(l=>/醫師/.test(l))), seen={}, out=[];
  t.rows.forEach(r=>{ const n=String(r[i]==null?'':r[i]).replace(/\s+/g,''); if(n&&!seen[n]){ seen[n]=1; out.push(n); } });
  return out;
}
function parseSys(t){
  const o={}; t.rows.forEach(r=>{ const k=normLabel(r[0]); if(k) o[k]=String(r[1]==null?'':r[1]).trim(); });
  return {form:o['病房表單']||'', eDate:o['欄位_日期']||'', eMrn:o['欄位_病歷號']||'', eItem:o['欄位_項目']||'', eDoc:o['欄位_醫師']||'', eVoid:o['欄位_作廢']||'',
    clinic:o['門診表單']||'', itemsGid:o['項目分頁']||''};
}
const itemNames=cfg=>{ const s={}, out=[]; cfg.items.forEach(x=>{ if(!s[x.name]){ s[x.name]=1; out.push(x.name); } }); return out; };
// 某個月某個項目適用的那一列（適用起 ≤ 這個月、最新的那一列）；找不到＝null
function priceOf(cfg,item,key){
  let best=null;
  cfg.items.forEach(x=>{ if(x.name!==item||(x.from&&x.from>key)) return;
    if(!best||(x.from||'')>=(best.from||'')) best=x; });
  return best;
}
// 現在可以登錄的項目：這個月適用的那一列沒有勾停用
const activeItems=cfg=>itemNames(cfg).filter(n=>{ const p=priceOf(cfg,n,todayKey()); return p&&!p.off; });

// ---------- 門診／病房回應 ----------
// 回傳 {recs:[一筆一列], voids:[作廢或復原]}。一筆的 key＝來源|送出時間|病歷號末3碼（刪除時用它指定是哪一筆）
function parseResp(src,t,docs){
  const ci=re=>t.cols.findIndex(l=>re.test(l));
  const iTs=Math.max(0,ci(/時間戳記|timestamp/i)), iDate=ci(/^日期/), iMrn=ci(/病歷/), iItem=ci(/^項目/), iDoc=ci(/醫師/), iVoid=ci(/作廢/);
  const recs=[], voids=[];
  t.rows.forEach((r,ri)=>{
    const g=i=>i<0?null:r[i], ts=parseGDate(g(iTs)); if(!ts) return;
    const tsKey=`${ts.y}-${pad(ts.m)}-${pad(ts.d)} ${pad(ts.h)}:${pad(ts.mi)}:${pad(ts.s)}`, tms=new Date(ts.y,ts.m-1,ts.d,ts.h,ts.mi,ts.s).getTime();
    const vv=String(g(iVoid)==null?'':g(iVoid)).trim();
    if(vv){ const restore=/^復原\|/.test(vv); voids.push({t:tms,target:restore?vv.slice(3):vv,restore}); return; }
    const mrn=mrn3(g(iMrn)), item=normItem(g(iItem)), doc=normDoc(g(iDoc),docs);
    if(!mrn&&!item&&!doc) return;
    const dt=parseGDate(g(iDate))||ts;   // 日期空白＝送出那天
    recs.push({src,row:ri+2,ts:tms,tsKey,key:`${src}|${tsKey}|${mrn}`,y:dt.y,m:dt.m,d:dt.d,k:`${dt.y-1911}-${pad(dt.m)}`,md:`${dt.m}/${dt.d}`,mrn,item,doc});
  });
  return {recs,voids};
}
// 作廢／復原依送出時間先後套用，最後一次為準
function applyVoids(recs,voids){
  const st={}; voids.slice().sort((a,b)=>a.t-b.t).forEach(v=>{ st[v.target]=!v.restore; });
  recs.forEach(r=>{ r.void=!!st[r.key]; });
}
// 讀整份：設定三個分頁＋要的回應分頁（srcs＝['門診','病房'] 或 ['病房']）
async function loadSheet(id,srcs){
  const RESP=[/病歷/,/^項目/,/醫師/];
  const [ti,td,ts,...tr]=await Promise.all([
    readTab(id,'項目',[/^項目/,/價錢|價格|金額/]), readTab(id,'醫師',[/^醫師$/],[/病歷/]), readTab(id,'系統',[/^鍵$/]),
    ...srcs.map(s=>s==='病房'?readTab(id,s,RESP.concat(/作廢/)):readTab(id,s,RESP,[/作廢/]))]);
  const cfg={items:parseItems(ti),docs:parseDocs(td),sys:parseSys(ts)};
  let recs=[], voids=[];
  tr.forEach((t,i)=>{ const p=parseResp(srcs[i],t,cfg.docs); recs=recs.concat(p.recs); voids=voids.concat(p.voids); });
  applyVoids(recs,voids);
  return {cfg,recs,voidN:recs.filter(r=>r.void).length};
}

// ---------- 送出到病房表單（Google 表單的 formResponse；跨網域只能 no-cors，看不到回應，所以送完要回頭讀試算表確認） ----------
function sysReady(sys){ return !!(sys&&/^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(sys.form)&&sys.eDate&&sys.eMrn&&sys.eItem&&sys.eDoc&&sys.eVoid); }
async function postForm(sys,fields){
  const body=new URLSearchParams(); Object.keys(fields).forEach(k=>{ if(k) body.append(k,fields[k]); });
  if(window.PS_MOCK) return window.PS_MOCK.post(sys.form,body);
  await fetch(sys.form,{method:'POST',mode:'no-cors',body});   // 沒網路時會丟例外
}
const submitRec=(sys,r)=>postForm(sys,{[sys.eDate]:r.date,[sys.eMrn]:r.mrn,[sys.eItem]:r.item,[sys.eDoc]:r.doc});
const voidRec=(sys,key,restore)=>postForm(sys,{[sys.eVoid]:(restore?'復原|':'')+key});

// ---------- 網站有新版就自動換上（手機上的 App 常常只是從背景叫回來、不會重新載入） ----------
let _verAt=0;
async function checkVersion(busyNow){
  if(location.protocol!=='https:'||navigator.onLine===false||Date.now()-_verAt<3*60*1000) return;
  _verAt=Date.now();
  try{
    const r=await fetch('core.js',{cache:'no-store'}); if(!r.ok) return;
    const m=(await r.text()).match(/const APP_VER='([^']+)'/);
    if(!m||m[1]===APP_VER) return;
    let tried=''; try{ tried=sessionStorage.getItem('pedsSelfpay_ver')||''; }catch(e){}
    if(tried.split('|')[0]===m[1]&&Date.now()-Number(tried.split('|')[1])<5*60*1000) return;   // 剛為這一版重載過、拿到的還是舊的：先不要一直重載
    const ae=document.activeElement;
    if((ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))||(busyNow&&busyNow())){ _verAt=0; return; }   // 正在操作：下次再換
    try{ sessionStorage.setItem('pedsSelfpay_ver',m[1]+'|'+Date.now()); }catch(e){}
    location.reload();
  }catch(e){}
}

// ---------- 安裝成手機 App ----------
let _installEvt=null;   // Android／電腦 Chrome 可以由網頁按鈕叫出安裝視窗；iPhone 只能自己「加入主畫面」
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); _installEvt=e; if(window.onInstallReady) window.onInstallReady(); });
const isStandalone=()=>!!(navigator.standalone||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches));
const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function installHtml(){
  if(isStandalone()) return '';
  if(_installEvt) return '<button class="btn outline" data-act="install">📲 安裝到這台手機</button>';
  if(isIOS()) return '<div class="mut">📲 安裝：Safari 下方「分享」→「加入主畫面」</div>';
  return '';
}
