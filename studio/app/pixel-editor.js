'use strict';
const el=id=>document.getElementById(id),canvas=el('pixelCanvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
let sourceId=new URLSearchParams(location.search).get('job'),source=null,current=0,loading=true,saving=false,stroke=null,requestToken=0;
const drafts=new Map(),frameLoads=new Map();
const say=t=>el('editStatus').textContent=t;
async function json(url,options){const r=await fetch(url,options),d=await r.json();if(!r.ok)throw Error(d.error||'通信できませんでした');return d;}
function draft(){return drafts.get(current);}
function modified(){return [...drafts.values()].some(d=>d.changed);}
/* 確認再生中も描ける（Aseprite #1320 の要望）。再生は毎コマ描き直すので、直した画素がそのまま動きに出る。保存だけは再生を止めてから */
function controls(){const d=draft();const blocked=loading||saving;for(const id of ['frame','tool','color','alpha','toolR','colorR','alphaR','swapSlots','lockAlpha','multiEdit','multiStart','multiEnd','zoomEdit','editGrid','flipView','applyPixel','x','y'])el(id).disabled=blocked;el('undo').disabled=blocked||!d?.undo.length;el('redo').disabled=blocked||!d?.redo.length;el('saveEdits').disabled=blocked||Studio.playing||!modified();Studio.updateControls();}
function draw(){const d=draft();if(!d)return;canvas.width=d.width;canvas.height=d.height;ctx.putImageData(new ImageData(d.pixels,d.width,d.height),0,0);const z=Number(el('zoomEdit').value);canvas.style.width=d.width*z+'px';canvas.style.height=d.height*z+'px';el('canvasWrap').style.setProperty('--cell',z+'px');el('canvasWrap').classList.toggle('grid',el('editGrid').checked);el('canvasWrap').classList.toggle('flipped',el('flipView').checked);el('editMeta').textContent=`コマ ${current+1} / ${source.frameCount} · ${d.width} × ${d.height}px · 座標 (${el('x').value}, ${el('y').value})${d.changed?' · 修正あり':''}`;controls();Studio.renderOverlay();}
async function loadFrame(i){if(drafts.has(i))return drafts.get(i);if(frameLoads.has(i))return frameLoads.get(i);const operation=(async()=>{const r=await fetch(`/api/jobs/${sourceId}/pixels/frame-${String(i).padStart(3,'0')}.png`);if(!r.ok)throw Error('コマを読み込めません');const o=source.frames[i].output,pixels=new Uint8ClampedArray(await r.arrayBuffer());if(pixels.length!==o.width*o.height*4)throw Error('画素データが不正です');const d={width:o.width,height:o.height,pixels,undo:[],redo:[],changed:false};drafts.set(i,d);return d;})();frameLoads.set(i,operation);try{return await operation;}finally{frameLoads.delete(i);}}
async function selectFrame(i){finishStroke();loading=true;controls();const token=++requestToken;try{await loadFrame(i);if(token!==requestToken)return;current=i;el('x').value=0;el('y').value=0;el('x').max=draft().width-1;el('y').max=draft().height-1;draw();say('修正するドットを選んでください。');Studio.changed();refreshPalette();}catch(e){say(e.message);}finally{if(token===requestToken){loading=false;controls();}}}
/* 画面だけ左右反転しているときは、見えている位置と画素の位置が左右逆になる */
function point(event){const b=canvas.getBoundingClientRect();let x=Math.floor((event.clientX-b.left)*canvas.width/b.width);if(el('flipView').checked)x=canvas.width-1-x;return [x,Math.floor((event.clientY-b.top)*canvas.height/b.height)];}
/* 左右クリックの割り当て。左は従来の tool / color / alpha をそのまま使う（保存済みの編集と互換） */
const SLOT={L:{tool:'tool',color:'color',alpha:'alpha',name:'左'},R:{tool:'toolR',color:'colorR',alpha:'alphaR',name:'右'}};
const otherSlot=s=>s==='L'?'R':'L';
const toHex=rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
/* スポイトで取った色の入れ先。Alt＋クリックは押した側へ。スポイト道具なら、もう片方がペンのときはそちらへ */
function pickInto(slot,forcePick){if(forcePick)return slot;const o=otherSlot(slot);return el(SLOT[o].tool).value==='pen'?o:slot;}
/* 塗る値を決める。透明部分の保護が入っていると、透明な画素には描かず、描いた画素の不透明度も元のまま（Aseprite #459 の要望） */
function paintValue(old,S,tool){const lock=el('lockAlpha').checked;if(lock&&(!old[3]||tool==='erase'))return null;if(tool==='erase')return [0,0,0,0];const hex=el(S.color).value;return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),lock?old[3]:Number(el(S.alpha).value)];}
/* 1ストロークは コマ→(画素位置→変更) の形で持つ。複数コマを同時に直すとき、コマごとの履歴に分けて積むため */
function writePixel(d,frame,at,next){const old=[...d.pixels.slice(at,at+4)];if(old.every((v,i)=>v===next[i]))return false;if(!stroke)stroke={changes:new Map()};let m=stroke.changes.get(frame);if(!m){m=new Map();stroke.changes.set(frame,m);}const existing=m.get(at);m.set(at,{at,before:existing?.before||old,after:next});d.pixels.set(next,at);d.changed=true;return true;}
function apply(x,y,slot='L',forcePick=false,dragging=false){if(loading||saving)return;const d=draft();if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=d.width||y>=d.height)return;el('x').value=x;el('y').value=y;const S=SLOT[slot],at=(y*d.width+x)*4,old=[...d.pixels.slice(at,at+4)],tool=forcePick?'pick':el(S.tool).value;
if(tool==='pick'){const T=SLOT[pickInto(slot,forcePick)];el(T.color).value=toHex(old.slice(0,3));el(T.alpha).value=old[3];Studio.changed();markSwatches();rememberPrefs();say(`RGB ${old.slice(0,3).join(', ')} / α ${old[3]} を${T.name}の色に入れました。`);return;}
const a=Number(el(S.alpha).value);if(!Number.isInteger(a)||a<0||a>255){say('不透明度は0〜255の整数で指定してください。');return;}
if(tool==='fill'){if(!dragging)fill(d,x,y,S);return;}
const next=paintValue(old,S,tool);let changed=next?writePixel(d,current,at,next):false;
for(const i of mirrorFrames()){const o=drafts.get(i),v=paintValue([...o.pixels.slice(at,at+4)],S,tool);if(v&&writePixel(o,i,at,v))changed=true;}
if(changed)draw();}
/* 塗りつぶし: 押した画素とRGBAがぴったり同じで、上下左右につながっている範囲。透明部分の保護も効く */
function fill(d,x,y,S){const w=d.width,h=d.height,start=(y*w+x)*4,target=[...d.pixels.slice(start,start+4)],next=paintValue(target,S,'pen');if(!next||target.every((v,i)=>v===next[i]))return;
 const same=at=>d.pixels[at]===target[0]&&d.pixels[at+1]===target[1]&&d.pixels[at+2]===target[2]&&d.pixels[at+3]===target[3];
 const seen=new Uint8Array(w*h),stack=[y*w+x],hits=[];seen[y*w+x]=1;
 while(stack.length){const p=stack.pop();hits.push(p);const px=p%w,py=(p-px)/w;for(const q of [px>0?p-1:-1,px<w-1?p+1:-1,py>0?p-w:-1,py<h-1?p+w:-1])if(q>=0&&!seen[q]&&same(q*4)){seen[q]=1;stack.push(q);}}
 for(const p of hits)writePixel(d,current,p*4,next);
 for(const i of mirrorFrames()){const o=drafts.get(i);for(const p of hits){const v=paintValue([...o.pixels.slice(p*4,p*4+4)],S,'pen');if(v)writePixel(o,i,p*4,v);}}
 draw();say(`${hits.length}画素を塗りつぶしました。`);}
/* 同時に直すコマ（編集中のコマ以外）。editor-extras.js が決める */
function mirrorFrames(){return typeof Extras!=='undefined'&&Extras.mirrorFrames?Extras.mirrorFrames():[];}
function trimHistory(d){let total=d.undo.reduce((n,a)=>n+a.length,0);while(d.undo.length&&(d.undo.length>50||total>1000000))total-=d.undo.shift().length;}
function finishStroke(){if(typeof Extras!=='undefined'&&Extras.sel?.lifted&&!Extras.committing)Extras.commitSelection();if(!stroke)return;const group=stroke.changes.size>1?crypto.randomUUID():null;let any=false;for(const [frame,m] of stroke.changes){const d=drafts.get(frame),changes=[...m.values()].filter(c=>c.before.some((v,i)=>v!==c.after[i]));if(!changes.length)continue;if(group)changes.group=group;d.undo.push(changes);d.redo=[];trimHistory(d);any=true;}stroke=null;if(any)Studio.changed();controls();refreshPalette();}
/* 複数コマを同時に直したストロークは group で束ねてあるので、戻すときも一緒に戻す（他のコマの一番上が同じ group のときだけ） */
function historyMove(redo){if(loading||saving)return;finishStroke();const d=draft(),changes=(redo?d.redo:d.undo).at(-1);if(!changes)return;const targets=[d];if(changes.group)for(const o of drafts.values())if(o!==d&&(redo?o.redo:o.undo).at(-1)?.group===changes.group)targets.push(o);for(const t of targets){const c=(redo?t.redo:t.undo).pop();for(const x of c)t.pixels.set(redo?x.after:x.before,x.at);(redo?t.undo:t.redo).push(c);t.changed=true;}Studio.changed();draw();say((redo?'修正をやり直しました。':'修正を元に戻しました。')+(targets.length>1?`（同時に直した${targets.length}コマ）`:''));refreshPalette();}
let lastPoint=null,activeSlot='L',altPick=false;
canvas.onpointerdown=e=>{if(loading||saving)return;const slot=e.button===0?'L':e.button===2?'R':null;if(!slot)return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);activeSlot=slot;altPick=e.altKey;lastPoint=point(e);if(typeof Extras!=='undefined'&&Extras.pointer('down',lastPoint,slot,e.altKey))return;apply(...lastPoint,activeSlot,altPick);};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointermove=e=>{if(!canvas.hasPointerCapture(e.pointerId)||!lastPoint)return;if(typeof Extras!=='undefined'&&Extras.pointer('move',point(e)))return;const p=point(e),[x0,y0]=lastPoint,steps=Math.max(Math.abs(p[0]-x0),Math.abs(p[1]-y0));for(let i=1;i<=steps;i++)apply(Math.round(x0+(p[0]-x0)*i/steps),Math.round(y0+(p[1]-y0)*i/steps),activeSlot,altPick,true);lastPoint=p;};
function release(){if(typeof Extras!=='undefined')Extras.pointer('up');finishStroke();lastPoint=null;}
canvas.onpointerup=release;canvas.onpointercancel=release;canvas.onlostpointercapture=release;
canvas.onkeydown=e=>{if(typeof Extras!=='undefined'&&Extras.keydown?.(e))return;let x=Number(el('x').value),y=Number(el('y').value);const flip=el('flipView').checked?-1:1;if(e.key==='ArrowLeft')x-=flip;else if(e.key==='ArrowRight')x+=flip;else if(e.key==='ArrowUp')y--;else if(e.key==='ArrowDown')y++;else if(e.key===' '){e.preventDefault();apply(x,y);finishStroke();return;}else return;e.preventDefault();el('x').value=Math.max(0,Math.min(canvas.width-1,x));el('y').value=Math.max(0,Math.min(canvas.height-1,y));draw();};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!/INPUT|SELECT/.test(e.target.tagName)){e.preventDefault();historyMove(e.shiftKey);}else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)&&!loading&&!saving){const k=e.key.toLowerCase();if(k==='x'){e.preventDefault();swapSlots();}else if(k==='l'||k==='h'||k==='m'){e.preventDefault();const box=el(k==='l'?'lockAlpha':k==='h'?'flipView':'multiEdit');box.checked=!box.checked;box.dispatchEvent(new Event('change'));}}});
el('applyPixel').onclick=()=>{apply(Number(el('x').value),Number(el('y').value));finishStroke();};el('undo').onclick=()=>historyMove(false);el('redo').onclick=()=>historyMove(true);el('frame').onchange=()=>selectFrame(Number(el('frame').value));for(const id of ['zoomEdit','editGrid','flipView'])el(id).onchange=draw;el('lockAlpha').onchange=()=>{say(el('lockAlpha').checked?'透明部分を保護しました。透明なところには描かず、不透明度も変えません。':'透明部分の保護を外しました。');Studio.changed();};
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const b=new Uint8Array(data.length+12),v=new DataView(b.buffer);v.setUint32(0,data.length);b.set(new TextEncoder().encode(type),4);b.set(data,8);v.setUint32(b.length-4,crc32(b.subarray(4,b.length-4)));return b;}
async function png(d){const head=new Uint8Array(13),v=new DataView(head.buffer);v.setUint32(0,d.width);v.setUint32(4,d.height);head[8]=8;head[9]=6;const raw=new Uint8Array((d.width*4+1)*d.height);for(let y=0;y<d.height;y++)raw.set(d.pixels.subarray(y*d.width*4,(y+1)*d.width*4),y*(d.width*4+1)+1);const packed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());const blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',packed),chunk('IEND',new Uint8Array())],{type:'image/png'});return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});}
/* 保存の各段に時間の上限を置く。検証中に「修正版を準備中 1 / 26」のまま進まなくなったことがあり（2026-09-23 GLM・負荷の高い環境。再生では再現せず）、
   止まったまま何も言わないのが一番困るので、止まったら理由を出して押し直せるようにする */
function within(p,what,ms=30000){let t;return Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(`${what}が${ms/1000}秒たっても終わりません。もう一度「修正版を保存」を押してください`)),ms);})]).finally(()=>clearTimeout(t));}
el('saveEdits').onclick=async()=>{if(saving||loading||Studio.playing)return;finishStroke();const target=await prepareTarget();if(!target)return;saving=true;controls();el('savedLinks').replaceChildren();try{const frames=[];for(let i=0;i<source.frameCount;i++){say(`修正版を準備中 ${i+1} / ${source.frameCount}`);const d=drafts.get(i);if(d?.changed)frames.push({name:source.frames[i].name,png:await within(png(d),`コマ ${i+1} のPNG作成`)});else{const r=await within(fetch(`/api/jobs/${sourceId}/output/frame-${String(i).padStart(3,'0')}.png`),`コマ ${i+1} の読み込み`);if(!r.ok)throw Error('元のコマを読み込めません');const blob=await r.blob();const encoded=await within(new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result.split(',')[1]);fr.onerror=reject;fr.readAsDataURL(blob);}),`コマ ${i+1} の読み込み`);frames.push({name:source.frames[i].name,png:encoded});}}
 const job=await json('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:{mode:'preserve',height:0,colors:0,background:'keep',trim:false,hardAlpha:false,fps:source.fps},frames})});
 const until=Date.now()+180000;for(;;){if(Date.now()>until)throw Error('書き出しが3分たっても終わりません');const state=await json('/api/jobs/'+job.id);if(state.status==='error')throw Error(state.error);if(state.status==='cancelled')throw Error('保存処理が中止されました');if(state.status==='done'){source=state.manifest;break;}say('修正版のPNG・アニメーションを書き出しています…');await new Promise(r=>setTimeout(r,500));}
 if(typeof Extras!=='undefined')Extras.saved?.(job.id);sourceId=job.id;for(const d of drafts.values())d.changed=false;Studio.changed();await Studio.flush();
 let where='';try{where=await exportToPc(job.id,source,target);}catch(e){where=`<b>パソコンへの保存に失敗しました</b>（${esc(e.message)}）。修正版はブラウザ内に保存済みなので、下のリンクから取り出せます。`;}
 const box=document.createElement('p');box.className='saved-where';box.innerHTML=where;el('savedLinks').append(box);
 const go=document.createElement('a');go.className='go-studio';go.textContent='修正版を制作画面で開く →';go.href=`/?job=${job.id}`;el('savedLinks').append(go);
 for(const [text,href] of [['全コマ・アニメーションをZIPでダウンロード',`/api/jobs/${job.id}/output/frames.zip?download=1`],['このコマのPNGだけダウンロード',`/api/jobs/${job.id}/output/frame-${String(current).padStart(3,'0')}.png?download=1`]]){const a=document.createElement('a');a.textContent=text;a.href=href;el('savedLinks').append(a);}
 say('修正版を保存しました。元の変換結果は残っています。');draw();
 if(el('afterSave').value==='studio'){say('修正版を保存しました。制作画面へ移動します…');await new Promise(r=>setTimeout(r,1200));go.click();}
 }catch(e){say('保存できませんでした：'+e.message+'。修正内容はこの画面に残っています。');}finally{saving=false;controls();}};
window.addEventListener('beforeunload',e=>{finishStroke();if(Studio.pending||Studio.writing||Studio.failed||saving){e.preventDefault();e.returnValue='';}});
async function init(){controls();try{if(!/^[a-f0-9-]{36}$/.test(sourceId||''))throw Error('制作画面で変換し、「1ドット修正」を開いてください。');const j=await json('/api/jobs/'+sourceId);if(j.status!=='done')throw Error('完了した変換結果を指定してください');source=j.manifest;el('original').href='/?job='+sourceId;await Studio.restore();for(let i=0;i<source.frameCount;i++){const o=document.createElement('option');o.value=i;o.textContent=`コマ ${i+1} / ${source.frameCount}`;el('frame').append(o);}const hasSource=!!source.palette?.length;el('paletteSource').querySelector('[value=source]').disabled=!hasSource;if(!hasSource&&el('paletteSource').value==='source')el('paletteSource').value='frame';el('frame').value=current;el('reviewFps').value=source.fps;await selectFrame(current);buildPalette();}catch(e){say(e.message);el('editMeta').textContent='素材を開けませんでした。';}}
/* パレット。共通パレットは減色したときしか無いので、このコマの色とマイパレットも選べるようにする */
const MY_PALETTE='pixel-motion-palette';
function readMine(){try{const v=JSON.parse(localStorage.getItem(MY_PALETTE));return Array.isArray(v)?v.filter(h=>/^#[0-9a-f]{6}$/i.test(h)):[];}catch(e){return [];}}
function writeMine(list){try{localStorage.setItem(MY_PALETTE,JSON.stringify(list));}catch(e){say('マイパレットを保存できませんでした。');}}
function frameColors(limit=64){const d=draft();if(!d)return {list:[],total:0};const count=new Map();for(let i=0;i<d.pixels.length;i+=4){if(!d.pixels[i+3])continue;const h=toHex([d.pixels[i],d.pixels[i+1],d.pixels[i+2]]);count.set(h,(count.get(h)||0)+1);}return {list:[...count].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(e=>e[0]),total:count.size};}
function paletteColors(){const kind=el('paletteSource').value;
if(kind==='source'){const p=source?.palette||[];return {list:p.map(c=>toHex([c.r,c.g,c.b])),note:`変換で作った共通パレット ${p.length}色。`};}
if(kind==='mine'){const l=readMine();return {list:l,note:l.length?`マイパレット ${l.length}色（このブラウザに保存）。`:'まだ色がありません。「左の色を追加」か、ファイル・貼り付けで読めます。'};}
const f=frameColors();return {list:f.list,note:f.total>f.list.length?`このコマで多く使われている${f.list.length}色（全${f.total.toLocaleString()}色）。`:`このコマで使われている${f.total}色。`};}
function markSwatches(){const l=el('color').value.toLowerCase(),r=el('colorR').value.toLowerCase();for(const b of el('swatches').children){b.classList.toggle('is-l',b.dataset.hex===l);b.classList.toggle('is-r',b.dataset.hex===r);}}
function setSlotColor(slot,hex){const S=SLOT[slot],wasPen=el(S.tool).value==='pen';el(S.color).value=hex;el(S.alpha).value=255;if(!wasPen)el(S.tool).value='pen';Studio.changed();markSwatches();rememberPrefs();say(`${hex} を${S.name}の色にしました。${wasPen?'':S.name+'の道具をペンにしました。'}`);}
function buildPalette(){const {list,note}=paletteColors(),box=el('swatches');box.replaceChildren();for(const hex of list){const b=document.createElement('button');b.type='button';b.dataset.hex=hex.toLowerCase();b.style.backgroundColor=hex;b.title=hex;b.setAttribute('aria-label',hex+'（左クリックで左、右クリックで右）');b.onclick=()=>setSlotColor('L',hex);b.oncontextmenu=e=>{e.preventDefault();setSlotColor('R',hex);};box.append(b);}el('paletteHint').textContent=note+' 左クリックで左の色、右クリックで右の色に入ります。';el('removeFromPalette').hidden=el('paletteSource').value!=='mine';markSwatches();}
let paletteQueued=false;
function refreshPalette(){if(paletteQueued)return;paletteQueued=true;requestAnimationFrame(()=>{paletteQueued=false;if(el('paletteSource').value==='frame')buildPalette();else markSwatches();});}
/* .hex（1行1色）/ .gpl（GIMP）/ .pal（JASC）/ .txt（Paint.NET・AARRGGBB）/ 貼り付けた文 を読む */
function parsePalette(text){let list=[];if(/GIMP Palette|JASC-PAL/i.test(text)){list=text.split(/\r?\n/).map(l=>l.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/)).filter(Boolean).map(m=>toHex([m[1],m[2],m[3]].map(v=>Math.min(255,Number(v)))));}else{const body=text.split(/\r?\n/).filter(l=>!l.trim().startsWith(';')).join('\n');for(const m of body.matchAll(/(?:^|[^0-9a-f])#?([0-9a-f]{8}|[0-9a-f]{6})(?![0-9a-f])/gi)){const h=m[1].toLowerCase();list.push('#'+(h.length===8?h.slice(2):h));}}return [...new Set(list)].slice(0,256);}
function useAsMine(list,from){if(!list.length){say(`${from}から色を読み取れませんでした。#RRGGBB の形か、.hex / .gpl の中身を使ってください。`);return;}writeMine(list);el('paletteSource').value='mine';Studio.changed();rememberPrefs();buildPalette();say(`${from}から${list.length}色をマイパレットにしました。`);}
function swapSlots(){for(const k of ['tool','color','alpha']){const a=el(SLOT.L[k]),b=el(SLOT.R[k]),t=a.value;a.value=b.value;b.value=t;}Studio.changed();markSwatches();rememberPrefs();say('左右の道具と色を入れ替えました。');}
el('swapSlots').onclick=swapSlots;
el('paletteSource').onchange=()=>{buildPalette();Studio.changed();};
for(const id of ['color','colorR'])el(id).addEventListener('input',markSwatches);
el('addToPalette').onclick=()=>{const hex=el('color').value.toLowerCase(),mine=readMine();if(mine.includes(hex)){say(`${hex} はもうマイパレットにあります。`);}else{mine.push(hex);writeMine(mine);say(`${hex} をマイパレットに足しました（${mine.length}色）。`);}el('paletteSource').value='mine';Studio.changed();rememberPrefs();buildPalette();};
el('removeFromPalette').onclick=()=>{const hex=el('color').value.toLowerCase(),mine=readMine();if(!mine.includes(hex)){say(`${hex} はマイパレットにありません。`);return;}writeMine(mine.filter(h=>h!==hex));buildPalette();say(`${hex} をマイパレットから外しました。`);};
el('importPalette').onclick=()=>el('paletteFile').click();
el('paletteFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;useAsMine(parsePalette(await f.text()),f.name);e.target.value='';};
el('applyPaste').onclick=()=>useAsMine(parsePalette(el('palettePaste').value),'貼り付けた文');
el('exportPalette').onclick=()=>{const {list}=paletteColors();if(!list.length){say('書き出す色がありません。');return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([list.map(h=>h.slice(1)).join('\n')+'\n'],{type:'text/plain'}));a.download=`palette-${list.length}.hex`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);say(`${list.length}色を .hex で書き出しました（Lospecと同じ形式）。`);};
/* 左右の道具・色・パレットの種類は、結果ごとではなく使う人の好みとして覚える。
   結果ごとの自動保存は結果が変わると引き継がれず、「修正版を保存」で新しい結果に移ると初期値に戻っていた（2026-09-23 検証で発見）。
   ここで入れた値は、その結果専用の自動保存があれば Studio.restore() が上書きする */
const EDITOR_PREFS='pixel-motion-editor-prefs',PREF_IDS=['tool','color','alpha','toolR','colorR','alphaR','paletteSource'];
try{const saved=JSON.parse(localStorage.getItem(EDITOR_PREFS)||'{}');for(const id of PREF_IDS){const node=el(id);if(node&&saved[id]!=null&&(node.tagName!=='SELECT'||[...node.options].some(o=>o.value===saved[id])))node.value=saved[id];}}catch(e){}
function rememberPrefs(){try{localStorage.setItem(EDITOR_PREFS,JSON.stringify(Object.fromEntries(PREF_IDS.map(id=>[id,el(id).value]))));}catch(e){}}
for(const id of PREF_IDS)el(id).addEventListener('change',rememberPrefs);
for(const id of ['color','colorR'])el(id).addEventListener('input',rememberPrefs);
window.addEventListener('DOMContentLoaded',init);
/* 「修正版を保存」のパソコン側の保存先。
   以前はブラウザ内に別の結果を作るだけで、パソコンのどこにも保存されず「どこに保存されたか分からない」と言われた（2026-09-23 ヨンサン指摘）。
   選べるのは ダウンロードフォルダにZIP ／ 選んだフォルダへ直接（Chrome・Edge のみ）／ 保存しない。
   選んだフォルダはブラウザが覚えるが、書き込みの許可はブラウザを開き直すたびに1回聞かれる */
const SAVE_PREFS='pixel-motion-save-prefs',canPickFolder=typeof window.showDirectoryPicker==='function';
function esc(t){return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);}
function handleDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pixel-motion-save-target',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function handleGet(){try{const db=await handleDb();return await new Promise(r=>{const q=db.transaction('kv').objectStore('kv').get('folder');q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null);});}catch(e){return null;}}
async function handleSet(h){try{const db=await handleDb();await new Promise(r=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(h,'folder');t.oncomplete=r;t.onerror=r;});}catch(e){}}
let folderHandle=null;
function saveModeChanged(){const v=el('saveTarget').value;el('folderRow').hidden=v!=='folder';el('folderName').textContent=folderHandle?`「${folderHandle.name}」フォルダ`:'未選択（保存を押すと選べます）';el('saveHint').textContent=v==='zip'?'ダウンロードフォルダに「pixel-motion_修正版_日時.zip」を保存します。中身は全コマのPNG・スプライトシート・アニメーション・JSONです。':v==='folder'?'選んだフォルダの中に「pixel-motion_修正版_日時」フォルダを作り、全コマのPNG・スプライトシート・アニメーション・JSONを入れます。':'パソコンには保存しません。修正版はこのブラウザの中にだけ残り、あとから下のリンクで取り出せます。';try{localStorage.setItem(SAVE_PREFS,JSON.stringify({saveTarget:v,afterSave:el('afterSave').value}));}catch(e){}}
async function pickFolder(){try{folderHandle=await window.showDirectoryPicker({id:'pixel-motion-save',mode:'readwrite'});await handleSet(folderHandle);}catch(e){if(e.name!=='AbortError')say('フォルダを選べませんでした：'+e.message);}saveModeChanged();return folderHandle;}
/* クリック直後に呼ぶ。許可ダイアログはユーザー操作の直後でないと出せないため、書き出しの前に済ませる */
async function prepareTarget(){const mode=el('saveTarget').value;if(mode!=='folder')return {mode};if(!folderHandle&&!await pickFolder()){say('保存先のフォルダが選ばれなかったので、保存をやめました。');return null;}try{if(await folderHandle.queryPermission({mode:'readwrite'})!=='granted'&&await folderHandle.requestPermission({mode:'readwrite'})!=='granted'){say(`「${folderHandle.name}」への書き込みが許可されませんでした。保存先を選び直すか、ZIPにしてください。`);return null;}}catch(e){say('保存先のフォルダを確認できませんでした：'+e.message);return null;}return {mode,handle:folderHandle};}
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;}
async function fetchBlob(jobId,file){const r=await fetch(`/api/jobs/${jobId}/output/${file}`);if(!r.ok)throw Error(`${file} を読み込めません`);return r.blob();}
/* 保存するファイル名は表示の言語に合わせる（英語のときは edited） */
async function exportToPc(jobId,manifest,target){const name=`pixel-motion_${window.I18N?.lang==='en'?'edited':'修正版'}_${stamp()}`;
 if(target.mode==='none')return 'パソコンには保存していません（設定が「保存しない」）。修正版はこのブラウザの中にあります。';
 if(target.mode==='zip'){say('ZIPをダウンロードしています…');const blob=await fetchBlob(jobId,'frames.zip'),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name+'.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);return `<b>ダウンロードフォルダ</b>に保存しました。<br><code>${esc(name)}.zip</code>（${(blob.size/1024).toFixed(0)} KB）<br>ブラウザのダウンロード一覧（Ctrl＋J）からも開けます。`;}
 const files=[...manifest.frames.map(f=>f.file),...manifest.exports.filter(f=>f!=='frames.zip')];const dir=await target.handle.getDirectoryHandle(name,{create:true});
 for(let i=0;i<files.length;i++){say(`パソコンに書き込み中 ${i+1} / ${files.length}`);const fh=await dir.getFileHandle(files[i],{create:true}),w=await fh.createWritable();await w.write(await fetchBlob(jobId,files[i]));await w.close();}
 return `<b>「${esc(target.handle.name)}」フォルダ</b>の中に保存しました。<br><code>${esc(target.handle.name)} › ${esc(name)}</code><br>${files.length}ファイル（${manifest.frames.length}コマのPNG・スプライトシート・アニメーション・JSON）`;}
try{const saved=JSON.parse(localStorage.getItem(SAVE_PREFS)||'{}');for(const id of ['saveTarget','afterSave'])if(saved[id]&&[...el(id).options].some(o=>o.value===saved[id]))el(id).value=saved[id];}catch(e){}
if(!canPickFolder){const o=el('saveTarget').querySelector('[value=folder]');o.disabled=true;o.textContent='フォルダを選ぶ（Chrome・Edgeのみ）';if(el('saveTarget').value==='folder')el('saveTarget').value='zip';}
el('saveTarget').onchange=async()=>{saveModeChanged();if(el('saveTarget').value==='folder'&&!folderHandle)await pickFolder();};el('afterSave').onchange=saveModeChanged;el('pickFolder').onclick=pickFolder;
if(canPickFolder)handleGet().then(h=>{if(h)folderHandle=h;saveModeChanged();});else saveModeChanged();
