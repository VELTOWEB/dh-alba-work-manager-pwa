
(() => {
'use strict';

const DB_NAME='albaWorkManagerDB';
const DB_VERSION=1;
const STORES=['workplaces','shifts','settlements','goals','settings'];
let db;
let useLocalFallback=false;
const LOCAL_DB_KEY='albaWorkManagerFallbackV2';
let localDB=null;
let route='home';
let currentMonth=monthKey(new Date());
let calMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let statsMonth=currentMonth;
let tickTimer=null;

const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const uid=()=>`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const pad=n=>String(n).padStart(2,'0');
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]));
const won=n=>`${Math.round(Number(n)||0).toLocaleString('ko-KR')}원`;
const fmtMin=m=>{m=Math.max(0,Math.round(Number(m)||0)); return `${Math.floor(m/60)}시간 ${m%60}분`;};
const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function monthKey(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}`}
const parseDate=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const weekday=['일','월','화','수','목','금','토'];
const dateLabel=s=>{const d=parseDate(s);return `${d.getMonth()+1}월 ${d.getDate()}일 ${weekday[d.getDay()]}요일`;};
const monthLabel=k=>{const [y,m]=k.split('-');return `${y}년 ${Number(m)}월`;};
function timeToMinutes(t){if(!t)return null;const [h,m]=t.split(':').map(Number);return h*60+m}
function minutesBetween(startDate,startTime,endDate,endTime){
  if(!startDate||!startTime||!endTime)return 0;
  const sd=parseDate(startDate); const ed=endDate?parseDate(endDate):parseDate(startDate);
  const a=new Date(sd.getFullYear(),sd.getMonth(),sd.getDate(),...startTime.split(':').map(Number));
  const b=new Date(ed.getFullYear(),ed.getMonth(),ed.getDate(),...endTime.split(':').map(Number));
  if(b<a && (!endDate || endDate===startDate)) b.setDate(b.getDate()+1);
  return Math.max(0,Math.round((b-a)/60000));
}
function shiftCalc(s){
  const start=s.actualStart||s.plannedStart; const end=s.actualEnd||s.plannedEnd;
  const endDate=s.actualEndDate||s.date;
  const total=minutesBetween(s.date,start,endDate,end);
  const worked=Math.max(0,total-(Number(s.breakMinutes)||0));
  const base=worked/60*(Number(s.hourlyRate)||0);
  const extras=(s.extras||[]).reduce((a,x)=>a+(Number(x.amount)||0),0);
  return {total,worked,base,totalPay:base+extras};
}
function nowTime(){const d=new Date();return `${pad(d.getHours())}:${pad(d.getMinutes())}`}
function today(){return dateKey(new Date())}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2200)}
function statusPill(s){
  const map={scheduled:['예정',''],working:['근무 중','ok'],completed:['완료','ok'],cancelled:['취소','danger'],needs_record:['기록 필요','warn']};
  const v=map[s]||[s,'']; return `<span class="pill ${v[1]}">${v[0]}</span>`;
}
function titleFor(r){return ({home:['오늘의 근무','알바기록'],records:['근무 기록','기록'],calendar:['근무 일정','캘린더'],stats:['월별 분석','통계'],settings:['앱 관리','설정']})[r]||['','알바기록'];}

function initLocalFallback(){
  useLocalFallback=true;
  try{localDB=JSON.parse(localStorage.getItem(LOCAL_DB_KEY)||'null')}catch(_){localDB=null}
  if(!localDB||typeof localDB!=='object')localDB={};
  STORES.forEach(s=>{if(!Array.isArray(localDB[s]))localDB[s]=[]});
  persistLocalFallback();
}
function persistLocalFallback(){
  if(!useLocalFallback||!localDB)return;
  try{localStorage.setItem(LOCAL_DB_KEY,JSON.stringify(localDB))}catch(_){/* storage may be unavailable; keep in-memory */}
}
function openDB(){return new Promise((resolve)=>{
  if(!('indexedDB' in window)){initLocalFallback();resolve(null);return;}
  try{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{const d=e.target.result;STORES.forEach(s=>{if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'});});};
    req.onsuccess=()=>{db=req.result;resolve(db)};
    req.onerror=()=>{console.warn('IndexedDB unavailable, using fallback storage',req.error);initLocalFallback();resolve(null)};
    req.onblocked=()=>{console.warn('IndexedDB blocked, using fallback storage');initLocalFallback();resolve(null)};
  }catch(err){console.warn('IndexedDB open failed, using fallback storage',err);initLocalFallback();resolve(null)}
})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(store){
  if(useLocalFallback)return Promise.resolve([...(localDB[store]||[])]);
  return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
}
function getOne(store,id){
  if(useLocalFallback)return Promise.resolve((localDB[store]||[]).find(x=>x.id===id));
  return new Promise((res,rej)=>{const r=tx(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
}
function put(store,obj){
  if(useLocalFallback){const arr=localDB[store]||(localDB[store]=[]);const i=arr.findIndex(x=>x.id===obj.id);if(i>=0)arr[i]=typeof structuredClone==='function'?structuredClone(obj):JSON.parse(JSON.stringify(obj));else arr.push(typeof structuredClone==='function'?structuredClone(obj):JSON.parse(JSON.stringify(obj)));persistLocalFallback();return Promise.resolve(obj)}
  return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})
}
function del(store,id){
  if(useLocalFallback){localDB[store]=(localDB[store]||[]).filter(x=>x.id!==id);persistLocalFallback();return Promise.resolve()}
  return new Promise((res,rej)=>{const r=tx(store,'readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})
}
async function setting(key,def=null){const x=await getOne('settings',key);return x?x.value:def}
async function setSetting(key,value){return put('settings',{id:key,value})}

function modal(title,body,{onOpen}={}){
  const root=$('#modalRoot');root.innerHTML=`<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>${esc(title)}</h2><button class="close" aria-label="닫기">×</button></div>${body}</section></div>`;
  $('.close',root).onclick=closeModal; $('.modal-backdrop',root).onclick=e=>{if(e.target.classList.contains('modal-backdrop'))closeModal()};
  onOpen?.(root);
}
function closeModal(){$('#modalRoot').innerHTML=''}

async function ensureDefaults(){
  if(await setting('currency')===null) await setSetting('currency','KRW');
  if(await setting('onboarded')===null) await setSetting('onboarded',false);
}

async function render(){
  const [eye,title]=titleFor(route);$('#headerEyebrow').textContent=eye;$('#headerTitle').textContent=title;
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
  clearInterval(tickTimer);
  if(route==='home') await renderHome();
  if(route==='records') await renderRecords();
  if(route==='calendar') await renderCalendar();
  if(route==='stats') await renderStats();
  if(route==='settings') await renderSettings();
}

async function renderHome(){
  const shifts=await getAll('shifts'); const workplaces=await getAll('workplaces'); const wpMap=Object.fromEntries(workplaces.map(w=>[w.id,w]));
  const t=today(); const todays=shifts.filter(s=>s.date===t && s.status!=='cancelled').sort((a,b)=>(a.plannedStart||'').localeCompare(b.plannedStart||''));
  const working=todays.find(s=>s.status==='working') || shifts.find(s=>s.status==='working');
  const next=todays.find(s=>s.status==='scheduled') || shifts.filter(s=>s.status==='scheduled'&&s.date>=t).sort((a,b)=>`${a.date}${a.plannedStart}`.localeCompare(`${b.date}${b.plannedStart}`))[0];
  const done=todays.filter(s=>s.status==='completed').sort((a,b)=>(b.actualEnd||'').localeCompare(a.actualEnd||''))[0];
  const month=currentMonth=monthKey(new Date()); const monthShifts=shifts.filter(s=>s.date.startsWith(month)&&s.status==='completed');
  const completedPay=monthShifts.reduce((a,s)=>a+shiftCalc(s).totalPay,0); const completedMinutes=monthShifts.reduce((a,s)=>a+shiftCalc(s).worked,0);
  const scheduledMonth=shifts.filter(s=>s.date.startsWith(month)&&['scheduled','completed','working'].includes(s.status));
  const forecast=scheduledMonth.reduce((a,s)=>a+shiftCalc(s).totalPay,0);
  const goal=(await getOne('goals',month))?.amount||0;
  const nextPay=getNextPayday(workplaces);
  let hero='';
  if(working){
    const wp=wpMap[working.workplaceId]; const c=liveCalc(working);
    hero=`<section class="card dark hero"><div class="status-row"><span class="pill ok">● 근무 중</span><span class="hero-kicker">${esc(wp?.name||'근무지')}</span></div><div class="hero-title" id="liveTime">${fmtMin(c.worked)}</div><div class="hero-sub">${working.actualStart||working.plannedStart} 출근 · 휴게 ${working.breakMinutes||0}분</div><div style="height:18px"></div><div class="label muted">현재 예상 급여</div><div class="big-number" id="livePay">${won(c.totalPay)}</div><div style="height:18px"></div><button class="primary cta-wide" style="background:white;color:#8f4260;border:1px solid #efbfd0" data-action="clock-out" data-id="${working.id}">퇴근하기</button><div class="actions" style="margin-top:9px"><button class="secondary" data-action="edit-shift" data-id="${working.id}">휴게·메모 수정</button></div></section>`;
    tickTimer=setInterval(async()=>{const s=await getOne('shifts',working.id);if(!s||s.status!=='working')return;const cc=liveCalc(s);$('#liveTime')&&($('#liveTime').textContent=fmtMin(cc.worked));$('#livePay')&&($('#livePay').textContent=won(cc.totalPay));},30000);
  } else if(next && next.date===t){
    const wp=wpMap[next.workplaceId]; const c=shiftCalc(next);
    hero=`<section class="card hero"><div class="hero-kicker">오늘의 근무</div><div class="hero-title">${esc(wp?.name||'근무지')}</div><div class="hero-sub">${next.plannedStart} → ${next.plannedEnd} · 예정 ${fmtMin(c.worked)}</div><div style="height:16px"></div><div class="label">예상 급여</div><div class="big-number">${won(c.totalPay)}</div><div style="height:18px"></div><button class="primary cta-wide" data-action="clock-in" data-id="${next.id}">출근하기</button><div class="actions" style="margin-top:9px"><button class="secondary" data-action="edit-shift" data-id="${next.id}">시간 변경</button><button class="secondary" data-action="cancel-shift" data-id="${next.id}">근무 취소</button></div></section>`;
  } else if(done){
    const wp=wpMap[done.workplaceId]; const c=shiftCalc(done);
    hero=`<section class="card hero"><div class="hero-kicker">오늘도 수고했어요</div><div class="hero-title">${esc(wp?.name||'근무지')}</div><div class="hero-sub">${done.actualStart} → ${done.actualEnd} · 인정 ${fmtMin(c.worked)}</div><div style="height:16px"></div><div class="label">예상 급여</div><div class="big-number">${won(c.totalPay)}</div><div style="height:16px"></div><div class="actions"><button class="secondary" data-action="edit-shift" data-id="${done.id}">기록 수정</button><button class="ghost" data-route-jump="records">기록 보기</button></div></section>`;
  } else {
    hero=`<section class="card hero"><div class="hero-kicker">${dateLabel(t)}</div><div class="hero-title">오늘 예정된 근무가 없습니다</div>${next?`<div class="hero-sub">다음 근무 · ${dateLabel(next.date)} ${next.plannedStart}–${next.plannedEnd}<br>${esc(wpMap[next.workplaceId]?.name||'')}</div>`:`<div class="hero-sub">첫 일정을 추가하면 출퇴근과 급여 계산을 바로 시작할 수 있어요.</div>`}<div style="height:18px"></div><div class="actions stack-mobile"><button class="primary" data-action="add-shift">일정 추가</button>${workplaces.length?'<button class="secondary" data-action="unscheduled-clockin">예정 없이 출근</button>':''}</div></section>`;
  }
  const pct=goal?Math.min(100,completedPay/goal*100):0;
  $('#view').innerHTML=`<div class="stack">${hero}
  <div class="section-title"><h2>이번 달</h2><button data-route-jump="stats">통계 보기</button></div>
  <section class="card"><div class="grid-2"><div class="metric"><small>지금까지 예상 수입</small><strong>${won(completedPay)}</strong></div><div class="metric"><small>예정 포함 예상</small><strong>${won(forecast)}</strong></div><div class="metric"><small>완료 근무시간</small><strong>${fmtMin(completedMinutes)}</strong></div><div class="metric"><small>완료 근무</small><strong>${monthShifts.length}회</strong></div></div>${goal?`<div class="divider"></div><div style="margin-top:13px"><div class="status-row" style="justify-content:space-between"><span class="label">목표 ${won(goal)}</span><strong>${Math.round(pct)}%</strong></div><div class="progress" style="margin-top:9px"><span style="width:${pct}%"></span></div></div>`:''}</section>
  ${nextPay?`<section class="card flat"><div class="label">다음 급여일</div><div style="display:flex;justify-content:space-between;gap:12px;align-items:end;margin-top:7px"><div><strong style="font-size:18px">${esc(nextPay.name)}</strong><div class="muted small" style="margin-top:4px">${nextPay.label}</div></div><span class="pill">${nextPay.dLabel}</span></div></section>`:''}
  ${findMissing(shifts,t).length?`<section class="card"><div class="status-row" style="justify-content:space-between"><div><strong>확인이 필요한 근무 ${findMissing(shifts,t).length}개</strong><div class="muted small" style="margin-top:4px">예정 시간이 지났지만 출퇴근 기록이 없습니다.</div></div><button class="secondary" data-route-jump="records">확인</button></div></section>`:''}
  </div>`;
  bindCommon();
}
function liveCalc(s){
  const end=nowTime(); const total=minutesBetween(s.date,s.actualStart||s.plannedStart,today(),end); const worked=Math.max(0,total-(Number(s.breakMinutes)||0)); const base=worked/60*(Number(s.hourlyRate)||0); const extras=(s.extras||[]).reduce((a,x)=>a+(Number(x.amount)||0),0);return{total,worked,base,totalPay:base+extras};
}
function findMissing(shifts,t){const now=new Date();return shifts.filter(s=>s.status==='scheduled'&&s.date<t || (s.status==='scheduled'&&s.date===t&&timeToMinutes(s.plannedEnd)<now.getHours()*60+now.getMinutes()));}
function getNextPayday(workplaces){
  const now=new Date();let best=null;
  workplaces.forEach(w=>{if(!w.payday)return;let d=new Date(now.getFullYear(),now.getMonth(),Number(w.payday));if(d<new Date(now.getFullYear(),now.getMonth(),now.getDate()))d=new Date(now.getFullYear(),now.getMonth()+1,Number(w.payday));const diff=Math.ceil((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);if(!best||d<best.date)best={date:d,name:w.name,label:`${d.getMonth()+1}월 ${d.getDate()}일`,dLabel:diff===0?'오늘':`D-${diff}`};});
  return best;
}

async function renderRecords(){
  const shifts=await getAll('shifts');const wps=await getAll('workplaces');const wp=Object.fromEntries(wps.map(x=>[x.id,x]));
  const list=shifts.filter(s=>s.date.startsWith(currentMonth)).sort((a,b)=>`${b.date}${b.actualStart||b.plannedStart||''}`.localeCompare(`${a.date}${a.actualStart||a.plannedStart||''}`));
  const completed=list.filter(s=>s.status==='completed'); const mins=completed.reduce((a,s)=>a+shiftCalc(s).worked,0); const pay=completed.reduce((a,s)=>a+shiftCalc(s).totalPay,0);
  $('#view').innerHTML=`<div class="stack"><section class="card"><div class="month-switch"><button data-month="-1">‹</button><strong>${monthLabel(currentMonth)}</strong><button data-month="1">›</button></div><div class="grid-2" style="margin-top:14px"><div class="metric"><small>완료 근무</small><strong>${completed.length}회</strong></div><div class="metric"><small>근무시간</small><strong>${fmtMin(mins)}</strong></div><div class="metric"><small>예상 급여</small><strong>${won(pay)}</strong></div><div class="metric"><small>전체 기록</small><strong>${list.length}개</strong></div></div></section>
  <div class="actions"><button class="primary" data-action="add-shift">일정 추가</button><button class="secondary" data-action="add-manual">수동 기록</button></div>
  <div class="list">${list.length?list.map(s=>{const c=shiftCalc(s),w=wp[s.workplaceId];return `<article class="list-item" data-action="edit-shift" data-id="${s.id}"><div class="main"><div class="status-row"><span class="workplace-swatch" style="background:${esc(w?.color||'#e78eae')}"></span><h3>${dateLabel(s.date)} · ${esc(w?.name||'삭제된 근무지')}</h3></div><p>${s.actualStart||s.plannedStart||'-'} – ${s.actualEnd||s.plannedEnd||'-'} · ${fmtMin(c.worked)} · ${statusPill(s.status)}</p></div><div class="amount">${won(c.totalPay)}</div></article>`}).join(''):`<section class="card empty"><div class="emoji">🗓️</div><h3>이 달의 근무 기록이 없습니다</h3><p>일정을 추가하거나 지난 근무를 직접 기록해보세요.</p></section>`}</div></div>`;
  $$('[data-month]').forEach(b=>b.onclick=()=>{const [y,m]=currentMonth.split('-').map(Number);currentMonth=monthKey(new Date(y,m-1+Number(b.dataset.month),1));renderRecords()});bindCommon();
}

async function renderCalendar(){
  const shifts=await getAll('shifts');const wps=await getAll('workplaces');const wp=Object.fromEntries(wps.map(x=>[x.id,x]));
  const first=new Date(calMonth.getFullYear(),calMonth.getMonth(),1); const start=new Date(first);start.setDate(1-first.getDay());
  const cells=[];for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const dk=dateKey(d);const dayShifts=shifts.filter(s=>s.date===dk&&s.status!=='cancelled');const payWps=wps.filter(w=>Number(w.payday)===d.getDate());cells.push(`<button class="day ${d.getMonth()!==calMonth.getMonth()?'out':''} ${dk===today()?'today':''}" data-day="${dk}"><span class="num">${d.getDate()}</span><div class="dots">${dayShifts.slice(0,4).map(s=>`<span class="dot" style="background:${esc(wp[s.workplaceId]?.color||'#e78eae')}"></span>`).join('')}</div>${payWps.length?'<div class="pay-dot">₩</div>':''}</button>`)}
  $('#view').innerHTML=`<div class="stack"><section class="card"><div class="month-switch"><button data-cal="-1">‹</button><strong>${calMonth.getFullYear()}년 ${calMonth.getMonth()+1}월</strong><button data-cal="1">›</button></div><div class="calendar" style="margin-top:12px">${weekday.map(x=>`<div class="dow">${x}</div>`).join('')}${cells.join('')}</div></section><button class="primary cta-wide" data-action="add-shift">근무 일정 추가</button></div>`;
  $$('[data-cal]').forEach(b=>b.onclick=()=>{calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+Number(b.dataset.cal),1);renderCalendar()});$$('[data-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.day));bindCommon();
}
async function openDay(day){
  const shifts=(await getAll('shifts')).filter(s=>s.date===day).sort((a,b)=>(a.plannedStart||'').localeCompare(b.plannedStart||''));const wps=await getAll('workplaces');const wp=Object.fromEntries(wps.map(x=>[x.id,x]));
  modal(dateLabel(day),`<div class="stack">${shifts.length?shifts.map(s=>{const c=shiftCalc(s);return `<article class="list-item" data-action="edit-shift" data-id="${s.id}"><div class="main"><h3>${esc(wp[s.workplaceId]?.name||'근무지')}</h3><p>${s.plannedStart||s.actualStart} – ${s.plannedEnd||s.actualEnd} · ${fmtMin(c.worked)}</p></div><div>${statusPill(s.status)}<div class="amount" style="margin-top:5px">${won(c.totalPay)}</div></div></article>`}).join(''):`<div class="empty"><h3>등록된 근무가 없습니다</h3></div>`}<button class="primary cta-wide" data-action="add-shift-day" data-day="${day}">이 날짜에 일정 추가</button></div>`,{onOpen:()=>bindCommon()});
}

async function renderStats(){
  const shifts=await getAll('shifts');const wps=await getAll('workplaces');const completed=shifts.filter(s=>s.status==='completed'&&s.date.startsWith(statsMonth));const mins=completed.reduce((a,s)=>a+shiftCalc(s).worked,0);const expected=completed.reduce((a,s)=>a+shiftCalc(s).totalPay,0);const settlements=(await getAll('settlements')).filter(x=>x.period===statsMonth);const actual=settlements.reduce((a,x)=>a+(Number(x.actualAmount)||0),0);const goal=(await getOne('goals',statsMonth))?.amount||0;
  const byWp=wps.map(w=>{const ss=completed.filter(s=>s.workplaceId===w.id);return{name:w.name,color:w.color,minutes:ss.reduce((a,s)=>a+shiftCalc(s).worked,0),pay:ss.reduce((a,s)=>a+shiftCalc(s).totalPay,0)}}).filter(x=>x.minutes>0);
  const months=[];const [y,m]=statsMonth.split('-').map(Number);for(let i=5;i>=0;i--){const d=new Date(y,m-1-i,1),k=monthKey(d);const val=shifts.filter(s=>s.status==='completed'&&s.date.startsWith(k)).reduce((a,s)=>a+shiftCalc(s).totalPay,0);months.push({k,label:`${d.getMonth()+1}월`,val})}const max=Math.max(...months.map(x=>x.val),1);
  $('#view').innerHTML=`<div class="stack"><section class="card"><div class="month-switch"><button data-stats="-1">‹</button><strong>${monthLabel(statsMonth)}</strong><button data-stats="1">›</button></div><div class="grid-2" style="margin-top:14px"><div class="metric"><small>총 근무일</small><strong>${completed.length}일</strong></div><div class="metric"><small>인정 근무시간</small><strong>${fmtMin(mins)}</strong></div><div class="metric"><small>예상 수입</small><strong>${won(expected)}</strong></div><div class="metric"><small>실제 수입</small><strong>${actual?won(actual):'미입력'}</strong></div></div></section>
  <section class="card"><div class="section-title"><h2>최근 6개월 예상 수입</h2></div><div class="chart">${months.map(x=>`<div class="bar-wrap" title="${won(x.val)}"><div class="bar" style="height:${Math.max(3,x.val/max*120)}px"></div><small>${x.label}</small></div>`).join('')}</div></section>
  <section class="card"><div class="section-title"><h2>근무지별</h2></div><div class="list" style="margin-top:12px">${byWp.length?byWp.map(x=>`<div class="list-item"><div class="main"><div class="status-row"><span class="workplace-swatch" style="background:${esc(x.color||'#e78eae')}"></span><h3>${esc(x.name)}</h3></div><p>${fmtMin(x.minutes)}</p></div><div class="amount">${won(x.pay)}</div></div>`).join(''):'<div class="muted small">완료된 근무가 없습니다.</div>'}</div></section>
  <section class="card"><div class="section-title"><h2>목표 수입</h2></div>${goal?`<div class="big-number" style="margin-top:12px">${Math.min(100,Math.round(expected/goal*100))}%</div><div class="muted small">${won(expected)} / ${won(goal)}</div><div class="progress" style="margin-top:12px"><span style="width:${Math.min(100,expected/goal*100)}%"></span></div>`:'<div class="muted small" style="margin-top:10px">이 달의 목표가 아직 없습니다.</div>'}<button class="secondary" style="margin-top:14px;width:100%" data-action="set-goal">목표 설정</button></section>
  <section class="card"><div class="section-title"><h2>급여 정산</h2></div><div class="muted small" style="margin:8px 0 12px">근무지별 실제 입금액을 입력해 예상 금액과 비교합니다.</div><button class="secondary" style="width:100%" data-action="settle-pay">실제 급여 입력</button></section></div>`;
  $$('[data-stats]').forEach(b=>b.onclick=()=>{const [yy,mm]=statsMonth.split('-').map(Number);statsMonth=monthKey(new Date(yy,mm-1+Number(b.dataset.stats),1));renderStats()});bindCommon();
}

async function renderSettings(){
  const wps=await getAll('workplaces');
  $('#view').innerHTML=`<div class="stack"><section class="card"><div class="section-title"><h2>근무지 관리</h2><button data-action="add-workplace">＋ 추가</button></div><div class="list" style="margin-top:12px">${wps.length?wps.map(w=>`<article class="list-item" data-action="edit-workplace" data-id="${w.id}"><div class="main"><div class="status-row"><span class="workplace-swatch" style="background:${esc(w.color||'#e78eae')}"></span><h3>${esc(w.name)}</h3></div><p>시급 ${won(w.hourlyRate)}${w.payday?` · 매월 ${w.payday}일 급여`:''}</p></div><span>›</span></article>`).join(''):'<div class="muted small">등록된 근무지가 없습니다.</div>'}</div></section>
  <section class="card"><div class="section-title"><h2>데이터</h2></div><div class="actions stack-mobile" style="margin-top:12px"><button class="secondary" data-action="backup">백업 파일 저장</button><button class="secondary" data-action="restore">백업 불러오기</button></div></section>
  <section class="card"><div class="section-title"><h2>앱</h2></div><div class="list" style="margin-top:12px"><div class="list-item"><div class="main"><h3>PWA / 오프라인</h3><p>지원 브라우저에서는 홈 화면 설치와 오프라인 실행을 사용할 수 있습니다.</p></div></div><div class="list-item"><div class="main"><h3>급여 계산 안내</h3><p>표시 금액은 사용자가 입력한 시급·휴게·추가수당 기준의 예상 금액이며 실제 지급액과 다를 수 있습니다.</p></div></div></div></section>
  <section class="card danger-zone"><div class="section-title"><h2>데이터 초기화</h2></div><div class="muted small" style="margin:8px 0 12px">모든 근무지, 일정, 기록, 정산 데이터가 삭제됩니다.</div><button class="danger-btn" style="width:100%" data-action="reset">전체 데이터 삭제</button></section></div>`;bindCommon();
}

function bindCommon(){
  // Dynamic buttons are handled by one delegated click listener below.
}


async function openWorkplaceForm(id=null){
  const w=id?await getOne('workplaces',id):null;
  modal(id?'근무지 수정':'근무지 추가',`<form id="wpForm" class="form"><div class="field"><label>근무지 이름 *</label><input name="name" required value="${esc(w?.name||'')}" placeholder="예: 카페" /></div><div class="inline"><div class="field"><label>기본 시급 *</label><input name="hourlyRate" type="number" min="1" required value="${w?.hourlyRate||''}" placeholder="10500" /></div><div class="field"><label>급여일</label><input name="payday" type="number" min="1" max="31" value="${w?.payday||''}" placeholder="10" /></div></div><div class="inline"><div class="field"><label>기본 출근</label><input name="defaultStart" type="time" value="${w?.defaultStart||'17:00'}" /></div><div class="field"><label>기본 퇴근</label><input name="defaultEnd" type="time" value="${w?.defaultEnd||'22:00'}" /></div></div><div class="inline"><div class="field"><label>기본 휴게(분)</label><input name="defaultBreak" type="number" min="0" value="${w?.defaultBreak??0}" /></div><div class="field"><label>구분 색상</label><input name="color" type="color" value="${w?.color||'#e78eae'}" /></div></div><div class="field"><label>메모</label><textarea name="memo">${esc(w?.memo||'')}</textarea></div><button class="primary cta-wide" type="submit">저장</button>${id?'<button class="danger-btn" type="button" id="deleteWp">근무지 삭제</button>':''}</form>`,{onOpen:root=>{
    $('#wpForm',root).onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const obj={id:w?.id||uid(),name:f.get('name').trim(),hourlyRate:Number(f.get('hourlyRate')),payday:Number(f.get('payday'))||null,defaultStart:f.get('defaultStart'),defaultEnd:f.get('defaultEnd'),defaultBreak:Number(f.get('defaultBreak'))||0,color:f.get('color'),memo:f.get('memo'),createdAt:w?.createdAt||Date.now(),updatedAt:Date.now()};await put('workplaces',obj);await setSetting('onboarded',true);closeModal();toast('근무지를 저장했습니다');render();};
    if(id)$('#deleteWp',root).onclick=async()=>{if(!confirm('근무지를 삭제할까요? 기존 근무 기록은 유지됩니다.'))return;await del('workplaces',id);closeModal();toast('근무지를 삭제했습니다');render()};
  }});
}

async function openShiftForm(id=null,forcedDay=null,manual=false){
  const wps=await getAll('workplaces'); if(!wps.length){toast('먼저 근무지를 등록해주세요');return openWorkplaceForm();}
  const s=id?await getOne('shifts',id):null; const selectedWp=wps.find(w=>w.id===(s?.workplaceId||''))||wps[0];
  const day=forcedDay||s?.date||today();
  const opts=wps.map(w=>`<option value="${w.id}" ${w.id===(s?.workplaceId||selectedWp.id)?'selected':''}>${esc(w.name)}</option>`).join('');
  modal(id?'근무 기록 수정':manual?'수동 근무 기록':'근무 일정 추가',`<form id="shiftForm" class="form"><div class="field"><label>근무지 *</label><select name="workplaceId">${opts}</select></div><div class="field"><label>날짜 *</label><input name="date" type="date" required value="${day}" /></div><div class="inline"><div class="field"><label>${manual||s?.status==='completed'?'출근 시간':'예정 출근'}</label><input name="start" type="time" required value="${s?.actualStart||s?.plannedStart||selectedWp.defaultStart||'17:00'}" /></div><div class="field"><label>${manual||s?.status==='completed'?'퇴근 시간':'예정 퇴근'}</label><input name="end" type="time" required value="${s?.actualEnd||s?.plannedEnd||selectedWp.defaultEnd||'22:00'}" /></div></div><div class="inline"><div class="field"><label>휴게시간(분)</label><input name="breakMinutes" type="number" min="0" value="${s?.breakMinutes??selectedWp.defaultBreak??0}" /></div><div class="field"><label>시급</label><input name="hourlyRate" type="number" min="1" value="${s?.hourlyRate||selectedWp.hourlyRate}" /></div></div><div class="field"><label>추가 수당</label><input name="extraAmount" type="number" min="0" value="${s?.extras?.[0]?.amount||0}" placeholder="0" /></div><div class="field"><label>추가 수당 설명</label><input name="extraLabel" value="${esc(s?.extras?.[0]?.label||'')}" placeholder="예: 교통비" /></div><div class="field"><label>메모</label><textarea name="memo">${esc(s?.memo||'')}</textarea></div>${!id&&!manual?`<div class="field"><label>반복</label><select name="repeat"><option value="none">반복 없음</option><option value="weekly">매주</option><option value="weekdays">평일</option><option value="weekends">주말</option></select></div><div class="field" id="repeatEndWrap"><label>반복 종료일</label><input name="repeatEnd" type="date" value="${dateKey(new Date(Date.now()+28*86400000))}" /></div>`:''}<div class="notice">급여는 인정 근무시간 × 시급 + 추가 수당으로 계산합니다. 실제 지급액과 다를 수 있습니다.</div><button class="primary cta-wide" type="submit">저장</button>${id?'<button class="secondary" type="button" id="cloneShift">이 일정 다시 추가</button><button class="danger-btn" type="button" id="deleteShift">기록 삭제</button>':''}</form>`,{onOpen:root=>{
    const wpSel=$('[name=workplaceId]',root);wpSel.onchange=()=>{const w=wps.find(x=>x.id===wpSel.value);if(!s){$('[name=hourlyRate]',root).value=w.hourlyRate;$('[name=breakMinutes]',root).value=w.defaultBreak||0;$('[name=start]',root).value=w.defaultStart||'17:00';$('[name=end]',root).value=w.defaultEnd||'22:00'}};
    $('#shiftForm',root).onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const wp=wps.find(x=>x.id===f.get('workplaceId'));const editingActual=manual||s?.status==='completed'||s?.status==='working';const base={id:s?.id||uid(),workplaceId:f.get('workplaceId'),date:f.get('date'),plannedStart:editingActual?(s?.plannedStart||f.get('start')):f.get('start'),plannedEnd:editingActual?(s?.plannedEnd||f.get('end')):f.get('end'),actualStart:editingActual?f.get('start'):(s?.actualStart||null),actualEnd:(manual||s?.status==='completed')?f.get('end'):(s?.actualEnd||null),actualEndDate:s?.actualEndDate||f.get('date'),breakMinutes:Number(f.get('breakMinutes'))||0,hourlyRate:Number(f.get('hourlyRate'))||wp.hourlyRate,extras:Number(f.get('extraAmount'))?[{label:f.get('extraLabel')||'추가 수당',amount:Number(f.get('extraAmount'))}]:[],memo:f.get('memo'),status:s?.status||(manual?'completed':'scheduled'),createdAt:s?.createdAt||Date.now(),updatedAt:Date.now()};
      const calcTest=shiftCalc(base);if(base.breakMinutes>calcTest.total){toast('휴게시간이 전체 근무시간보다 길 수 없습니다');return}
      await put('shifts',base);
      if(!id&&!manual){const repeat=f.get('repeat');const end=f.get('repeatEnd');if(repeat&&repeat!=='none'&&end)await createRepeats(base,repeat,end);}
      closeModal();toast('근무 기록을 저장했습니다');render();
    };
    if(id){$('#cloneShift',root).onclick=async()=>{const copy={...s,id:uid(),date:today(),plannedStart:s.plannedStart||s.actualStart,plannedEnd:s.plannedEnd||s.actualEnd,actualStart:null,actualEnd:null,actualEndDate:today(),status:'scheduled',memo:s.memo?`복제 · ${s.memo}`:'복제한 일정',createdAt:Date.now(),updatedAt:Date.now()};await put('shifts',copy);closeModal();toast('오늘 날짜로 일정을 복제했습니다');render()};$('#deleteShift',root).onclick=async()=>{if(!confirm('이 근무 기록을 삭제할까요?'))return;await del('shifts',id);closeModal();toast('기록을 삭제했습니다');render()}};
  }});
}
async function createRepeats(base,type,endDate){
  let d=parseDate(base.date);const end=parseDate(endDate);let guard=0;
  while(guard++<366){d=new Date(d);d.setDate(d.getDate()+1);if(d>end)break;const dow=d.getDay();let ok=false;if(type==='weekly')ok=dow===parseDate(base.date).getDay();if(type==='weekdays')ok=dow>=1&&dow<=5;if(type==='weekends')ok=dow===0||dow===6;if(ok)await put('shifts',{...base,id:uid(),date:dateKey(d),actualStart:null,actualEnd:null,status:'scheduled',createdAt:Date.now(),updatedAt:Date.now()});
  }
}
async function clockIn(id){const s=await getOne('shifts',id);if((await getAll('shifts')).some(x=>x.status==='working'&&x.id!==id)){toast('이미 진행 중인 근무가 있습니다');return}s.actualStart=nowTime();s.actualEnd=null;s.actualEndDate=s.date;s.status='working';s.updatedAt=Date.now();await put('shifts',s);toast('출근을 기록했습니다');render()}
async function clockOut(id){const s=await getOne('shifts',id);s.actualEnd=nowTime();s.actualEndDate=today();s.status='completed';s.updatedAt=Date.now();const c=shiftCalc(s);if(s.breakMinutes>c.total){s.breakMinutes=0}await put('shifts',s);toast(`퇴근 완료 · 예상 ${won(shiftCalc(s).totalPay)}`);render()}
async function cancelShift(id){const s=await getOne('shifts',id);if(!confirm('오늘 근무를 취소 처리할까요?'))return;s.status='cancelled';s.updatedAt=Date.now();await put('shifts',s);toast('근무를 취소했습니다');render()}
async function unscheduledClockIn(){const wps=await getAll('workplaces');modal('예정 없이 출근',`<form id="quickClock" class="form"><div class="field"><label>근무지</label><select name="wp">${wps.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div><div class="notice">현재 시간 ${nowTime()}으로 출근을 기록합니다.</div><button class="primary cta-wide">출근하기</button></form>`,{onOpen:root=>{$('#quickClock',root).onsubmit=async e=>{e.preventDefault();if((await getAll('shifts')).some(x=>x.status==='working')){toast('이미 진행 중인 근무가 있습니다');return}const w=wps.find(x=>x.id===new FormData(e.target).get('wp'));const s={id:uid(),workplaceId:w.id,date:today(),plannedStart:nowTime(),plannedEnd:w.defaultEnd||nowTime(),actualStart:nowTime(),actualEnd:null,actualEndDate:today(),breakMinutes:w.defaultBreak||0,hourlyRate:w.hourlyRate,extras:[],memo:'예정 없이 출근',status:'working',createdAt:Date.now(),updatedAt:Date.now()};await put('shifts',s);closeModal();toast('출근을 기록했습니다');render()}}});}

async function openGoal(){const g=await getOne('goals',statsMonth);modal('목표 수입 설정',`<form id="goalForm" class="form"><div class="field"><label>${monthLabel(statsMonth)} 목표 금액</label><input name="amount" type="number" min="0" value="${g?.amount||''}" placeholder="800000" /></div><button class="primary cta-wide">저장</button></form>`,{onOpen:root=>{$('#goalForm',root).onsubmit=async e=>{e.preventDefault();const amount=Number(new FormData(e.target).get('amount'))||0;await put('goals',{id:statsMonth,amount});closeModal();toast('목표를 저장했습니다');renderStats()}}});}
async function openSettlement(){
  const wps=await getAll('workplaces');const shifts=await getAll('shifts');const existing=await getAll('settlements');
  modal('실제 급여 입력',`<form id="settleForm" class="form"><div class="field"><label>근무지</label><select name="wp">${wps.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div><div class="field"><label>정산 기간</label><input name="period" type="month" value="${statsMonth}" /></div><div class="field"><label>실제 입금액</label><input name="actual" type="number" min="0" required /></div><div class="field"><label>메모</label><input name="memo" placeholder="예: 10월 10일 입금 확인" /></div><button class="primary cta-wide">저장</button></form><div id="settlePreview" class="notice" style="margin-top:12px"></div>`,{onOpen:root=>{
    const update=()=>{const f=new FormData($('#settleForm',root));const wp=f.get('wp'),period=f.get('period');const expected=shifts.filter(s=>s.workplaceId===wp&&s.status==='completed'&&s.date.startsWith(period)).reduce((a,s)=>a+shiftCalc(s).totalPay,0);const prev=existing.find(x=>x.workplaceId===wp&&x.period===period);$('[name=actual]',root).value=prev?.actualAmount||'';$('#settlePreview',root).textContent=`예상 급여 ${won(expected)} · 실제 입금액을 저장하면 차액을 비교할 수 있습니다.`};
    $('[name=wp]',root).onchange=update;$('[name=period]',root).onchange=update;update();
    $('#settleForm',root).onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const wp=f.get('wp'),period=f.get('period');const expected=shifts.filter(s=>s.workplaceId===wp&&s.status==='completed'&&s.date.startsWith(period)).reduce((a,s)=>a+shiftCalc(s).totalPay,0);const obj={id:`${wp}:${period}`,workplaceId:wp,period,expectedAmount:expected,actualAmount:Number(f.get('actual')),memo:f.get('memo'),updatedAt:Date.now()};await put('settlements',obj);closeModal();toast(`정산 저장 · 차액 ${won(obj.actualAmount-expected)}`);renderStats()};
  }});
}

async function backupData(){const data={version:1,exportedAt:new Date().toISOString(),stores:{}};for(const s of STORES)data.stores[s]=await getAll(s);const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`alba-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast('백업 파일을 저장했습니다')}
async function restoreData(file){try{const data=JSON.parse(await file.text());if(!data?.stores)throw new Error('invalid');for(const s of STORES){for(const item of (data.stores[s]||[]))await put(s,item)}toast('백업을 복원했습니다');render()}catch(e){toast('올바른 백업 파일이 아닙니다')}}
async function resetData(){if(!confirm('정말 모든 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;if(!confirm('마지막 확인입니다. 전체 데이터를 삭제할까요?'))return;if(useLocalFallback){STORES.forEach(s=>localDB[s]=[]);persistLocalFallback();}else{for(const s of STORES){const store=tx(s,'readwrite');await new Promise((res,rej)=>{const r=store.clear();r.onsuccess=res;r.onerror=()=>rej(r.error)})}}await ensureDefaults();toast('전체 데이터를 삭제했습니다');route='home';render();setTimeout(maybeOnboard,300)}

async function maybeOnboard(){const wps=await getAll('workplaces');if(wps.length)return;modal('처음 시작하기',`<div class="stack"><div class="card flat"><div class="hero-kicker">내 알바 기록을 한곳에서</div><div class="hero-title" style="font-size:25px">출근과 퇴근만 누르면<br>근무시간과 받을 돈이 정리됩니다.</div><div class="hero-sub">먼저 첫 근무지를 등록해주세요.</div></div><button class="primary cta-wide" id="onboardStart">첫 근무지 등록</button></div>`,{onOpen:root=>{$('#onboardStart',root).onclick=()=>{closeModal();openWorkplaceForm()}}});}

document.addEventListener('click',e=>{
  const nav=e.target.closest('.nav-item[data-route]');
  if(nav){route=nav.dataset.route;render();return;}
  if(e.target.closest('#quickAddBtn')){openShiftForm();return;}
  const b=e.target.closest('[data-route-jump],[data-action]');
  if(!b)return;
  const jump=b.dataset.routeJump;
  if(jump){closeModal();route=jump;render();return;}
  const action=b.dataset.action;
  if(action==='add-shift')return openShiftForm();
  if(action==='add-shift-day')return openShiftForm(null,b.dataset.day);
  if(action==='add-manual')return openShiftForm(null,today(),true);
  if(action==='edit-shift'){e.preventDefault();e.stopPropagation();return openShiftForm(b.dataset.id);}
  if(action==='clock-in')return clockIn(b.dataset.id);
  if(action==='clock-out')return clockOut(b.dataset.id);
  if(action==='cancel-shift')return cancelShift(b.dataset.id);
  if(action==='unscheduled-clockin')return unscheduledClockIn();
  if(action==='add-workplace')return openWorkplaceForm();
  if(action==='edit-workplace')return openWorkplaceForm(b.dataset.id);
  if(action==='set-goal')return openGoal();
  if(action==='settle-pay')return openSettlement();
  if(action==='backup')return backupData();
  if(action==='restore')return $('#restoreFile').click();
  if(action==='reset')return resetData();
});
$('#restoreFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)restoreData(f);e.target.value=''});

async function boot(){
  try{await openDB();await ensureDefaults();await render();await maybeOnboard();if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js?v=4').catch(()=>{});}catch(e){console.error(e);initLocalFallback();try{await ensureDefaults();await render();await maybeOnboard();toast('호환 저장 모드로 실행했습니다');}catch(inner){console.error(inner);$('#view').innerHTML='<section class="card"><h2>앱을 시작할 수 없습니다</h2><p class="muted">페이지를 새로고침한 뒤 다시 시도해주세요.</p></section>'}}
}
boot();
})();

