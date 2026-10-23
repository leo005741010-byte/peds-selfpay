'use strict';
// ============================================================
// 兒科自費：病房登錄 App（index.html）與管理頁（admin.html）共用的程式。
// 資料全部在同一份 Google 試算表：
//   「門診」分頁＝門診表單（Google 表單，放在門診護理師電腦）的回應
//   「病房」分頁＝病房表單的回應：病房 NP 用這個 App 送出；刪除（作廢）紀錄也記在這裡
//   「項目」分頁＝自費項目、價錢、PF（每件的金額）、適用起、停用、類別（檢驗／疫苗）、排序（新增項目、調價都在這裡改）
//   「醫師」分頁＝開單醫師名單
//   「系統」分頁＝病房表單的送出位址與欄位代號（建立腳本自動填好）
// 本檔公開在網站上，所以不含任何姓名、價錢、試算表或表單網址：
//   試算表代號由連結 #s=… 帶進來、存在這台裝置；其他全部從試算表讀。
// ============================================================
const APP_VER='2026.10.23f';
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
// 病歷號：照試算表讀到的（試算表會把數字開頭的 0 拿掉）。舊資料是末3碼，012 存成 12 → 補回 3 位，刪除用的代號才對得上
function mrn3(v){
  if(v==null||v==='') return '';
  if(typeof v==='number') return isFinite(v)&&v>=0&&v<1000&&Number.isInteger(v)?String(v).padStart(3,'0'):String(v);
  const s=String(v).trim(); return /^\d{1,3}$/.test(s)?s.padStart(3,'0'):s;
}
// 比對用的病歷號：純數字就去掉開頭的 0（試算表存的時候會拿掉），英文字母一律大寫
const mrnCmp=v=>{ const s=String(v==null?'':v).trim().toUpperCase(); return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,''):s; };
// 畫面上的病歷號：系統分頁有「病歷號位數」時，純數字補回開頭的 0
const mrnDisp=(v,sys)=>{ const s=String(v==null?'':v), n=sys&&sys.mrnLen; return n&&/^\d+$/.test(s)&&s.length<n?s.padStart(n,'0'):s; };
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
  const iN=ci(/^項目/), iP=ci(/價錢|價格|金額/), iF=ci(/^PF/i), iFrom=ci(/適用/), iOff=ci(/停用/), iCat=ci(/類別|分類/), iOrd=ci(/排序|順序/);
  const ratioCol=iF>=0&&/比例|%/.test(t.cols[iF]);   // 舊版的「PF比例」欄（價錢的幾 %）
  const num=v=>Number(String(v==null?'':v).replace(/[,\s元$%]/g,''))||0;
  const out=[];
  t.rows.forEach((r,i)=>{
    const name=normItem(r[iN]); if(!name) return;
    const price=num(r[iP]);
    // PF＝每件的金額（元）。舊的比例欄、或格子打成 10%／0.1 的，換算成元
    let pfAmt=0;
    if(iF>=0){ const raw=r[iF], v=num(raw);
      pfAmt=ratioCol||/%/.test(String(raw))||(v>0&&v<1)?Math.round(price*(v>1?v/100:v)):Math.round(v); }
    const off=iOff>=0&&isOn(r[iOff]);
    // 類別：沒填的，名稱有「疫苗」就算疫苗、其他算檢驗
    const c0=iCat>=0?String(r[iCat]==null?'':r[iCat]).trim():'', cat=c0?(/疫苗/.test(c0)?'疫苗':/檢驗/.test(c0)?'檢驗':c0):(/疫苗/.test(name)?'疫苗':'檢驗');
    const o0=iOrd>=0?Number(r[iOrd]):NaN, ord=isFinite(o0)&&String(r[iOrd]==null?'':r[iOrd]).trim()!==''?o0:1000+i;
    out.push({name,price,pfAmt,from:iFrom>=0?parseFrom(r[iFrom]):null,off,cat,ord,order:i});
  });
  return out;
}
const isOn=v=>v===true||/^(true|v|✓|✔|是|停用|x)$/i.test(String(v==null?'':v).trim());   // 「停用」欄打勾
// 醫師：all＝名單上全部（舊紀錄比對用）；on＝沒勾停用的（表單與 App 的選項）
function parseDocs(t){
  const i=Math.max(0,t.cols.findIndex(l=>/醫師/.test(l))), iOff=t.cols.findIndex(l=>/停用/.test(l)), seen={}, all=[], on=[], off=[];
  t.rows.forEach(r=>{ const n=String(r[i]==null?'':r[i]).replace(/\s+/g,''); if(!n||seen[n]) return; seen[n]=1; all.push(n);
    if(iOff>=0&&isOn(r[iOff])) off.push(n); else on.push(n); });
  return {all,on,off};
}
function parseSys(t){
  const o={}; t.rows.forEach(r=>{ const k=normLabel(r[0]); if(k) o[k]=String(r[1]==null?'':r[1]).trim(); });
  return {form:o['病房表單']||'', eDate:o['欄位_日期']||'', eMrn:o['欄位_病歷號']||'', eItem:o['欄位_項目']||'', eDoc:o['欄位_醫師']||'', eVoid:o['欄位_作廢']||'',
    clinic:o['門診表單']||'', itemsGid:o['項目分頁']||'', write:o['管理寫入']||'', mrnLen:Number(o['病歷號位數'])||0};
}
// 類別的先後：檢驗、疫苗，其他的排後面
const CATS=['檢驗','疫苗'];
const catRank=c=>{ const i=CATS.indexOf(c); return i<0?CATS.length:i; };
// 每個項目一筆：類別（第一列的）、排序（各列最小的）
function itemMeta(cfg){ const m={}; cfg.items.forEach(x=>{ const o=m[x.name]; if(!o) m[x.name]={cat:x.cat||'檢驗',ord:x.ord,row:x.order}; else if(x.ord<o.ord) o.ord=x.ord; }); return m; }
// 項目名稱，照「類別 → 後台排的順序」排
const itemNames=cfg=>{ const m=itemMeta(cfg); return Object.keys(m).sort((a,b)=>catRank(m[a].cat)-catRank(m[b].cat)||m[a].cat.localeCompare(m[b].cat)||m[a].ord-m[b].ord||m[a].row-m[b].row); };
const catOf=(cfg,n)=>{ const x=cfg.items.find(y=>y.name===n); return x?(x.cat||'檢驗'):(/疫苗/.test(n)?'疫苗':'檢驗'); };
const catsIn=(cfg,names)=>{ const s=[...new Set(names.map(n=>catOf(cfg,n)))]; return s.sort((a,b)=>catRank(a)-catRank(b)||a.localeCompare(b)); };
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
// 回傳 {recs:[一個項目一筆], voids:[作廢或復原]}。一筆的 key＝來源|送出時間|病歷號（刪除時用它指定是哪一筆）；
// 門診表單分「檢驗項目」「疫苗項目」兩題，同一次可以各選一個 → 一列拆成兩筆，第二筆的 key 後面加 |2
function parseResp(src,t,docs){
  const ci=re=>t.cols.findIndex(l=>re.test(l));
  const iTs=Math.max(0,ci(/時間戳記|timestamp/i)), iDate=ci(/^日期/), iMrn=ci(/病歷/), iDoc=ci(/醫師/), iVoid=ci(/作廢/);
  const iItems=t.cols.map((l,i)=>/項目$/.test(l)&&!/作廢/.test(l)?i:-1).filter(i=>i>=0);
  const recs=[], voids=[];
  t.rows.forEach((r,ri)=>{
    const g=i=>i<0?null:r[i], ts=parseGDate(g(iTs)); if(!ts) return;
    const tsKey=`${ts.y}-${pad(ts.m)}-${pad(ts.d)} ${pad(ts.h)}:${pad(ts.mi)}:${pad(ts.s)}`, tms=new Date(ts.y,ts.m-1,ts.d,ts.h,ts.mi,ts.s).getTime();
    const vv=String(g(iVoid)==null?'':g(iVoid)).trim();
    if(vv){ const restore=/^復原\|/.test(vv); voids.push({t:tms,target:restore?vv.slice(3):vv,restore}); return; }
    const mrn=mrn3(g(iMrn)), items=iItems.map(i=>normItem(g(i))).filter(Boolean), doc=normDoc(g(iDoc),docs);
    if(!mrn&&!items.length&&!doc) return;
    const dt=parseGDate(g(iDate))||ts, base=`${src}|${tsKey}|${mrn}`;   // 日期空白＝送出那天
    (items.length?items:['']).forEach((item,j)=>recs.push({src,row:ri+2,ts:tms,tsKey,key:j?`${base}|${j+1}`:base,y:dt.y,m:dt.m,d:dt.d,k:`${dt.y-1911}-${pad(dt.m)}`,md:`${dt.m}/${dt.d}`,mrn,item,doc}));
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
  const RESP=[/病歷/,/項目$/,/醫師/];
  const [ti,td,ts,...tr]=await Promise.all([
    readTab(id,'項目',[/^項目/,/價錢|價格|金額/]), readTab(id,'醫師',[/^醫師$/],[/病歷/]), readTab(id,'系統',[/^鍵$/]),
    ...srcs.map(s=>s==='病房'?readTab(id,s,RESP.concat(/作廢/)):readTab(id,s,RESP,[/作廢/]))]);
  const dd=parseDocs(td), cfg={items:parseItems(ti),docs:dd.all,docsOn:dd.on,docsOff:dd.off,sys:parseSys(ts)};
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
const isAndroid=()=>/Android/i.test(navigator.userAgent);
const inAppBrowser=()=>/\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(navigator.userAgent);
// 「變成手機 App」教學：還沒裝成 App 的手機才出現（LINE 裡先教怎麼換到瀏覽器，再教加到主畫面）。name＝主畫面上的名字
function installHtml(name){
  if(isStandalone()||!(isIOS()||isAndroid()||inAppBrowser())) return '';
  const line=inAppBrowser(), ios=isIOS();
  let h=`<div class="card instc"><div class="insth">📲 變成手機 App</div>`;
  if(line) h+=`<div class="instp"><b>LINE 裡不能加到主畫面，要先換到${ios?' Safari':' Chrome'}：</b></div>
    <div class="row"><button class="btn" data-act="open-browser">用${ios?' Safari':' Chrome'} 打開</button></div>
    <ol><li>沒有跳過去的話：點右上角「⋯」→「以預設瀏覽器開啟」</li><li>打開後照下面做</li></ol>`;
  if(ios) h+=`<div class="instp"><b>iPhone：</b></div><ol>
    <li>用 <b>Safari</b> 打開這一頁</li>
    <li>點下方的「分享」<span class="ico">⬆</span>（Chrome 在右上角）</li>
    <li>往下滑，點「<b>加入主畫面</b>」→ 右上角「<b>新增</b>」</li>
    <li>之後從主畫面的「${esc(name)}」圖示打開</li></ol>`;
  else{
    h+=`<div class="instp"><b>Android：</b></div>`;
    if(_installEvt&&!line) h+=`<div class="row"><button class="btn" data-act="install">安裝到這台手機</button></div>`;
    h+=`<ol><li>用 <b>Chrome</b> 打開這一頁</li><li>點右上角「<b>⋮</b>」</li><li>點「<b>加到主畫面</b>」或「<b>安裝應用程式</b>」→「安裝」</li>
      <li>之後從主畫面的「${esc(name)}」圖示打開</li></ol>`;
  }
  return h+'</div>';
}
// 用外部瀏覽器重新打開同一頁（LINE 看到 openExternalBrowser=1 會改用 Safari／Chrome 開）
function openInBrowser(){ location.href=location.origin+location.pathname+'?openExternalBrowser=1'+location.hash; }
