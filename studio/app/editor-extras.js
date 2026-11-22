'use strict';
/* 1ドット修正の追加機能（2026-09-24）。要望リスト knowledge/要望リスト_1ドット修正_2026-09-23.md から。
   - 参照画像: このコマの元のイラストを、ドットの位置に合わせて並べる・重ねる（Aseprite #1321）
   - 色のチェック: パレットにない色・使われている数が少ない色を探して枠で囲み、近い色への置き換えを提案する
   - 複数コマを同時に直す・範囲選択は、あとから同じ入口（Extras）に足す
   pixel-editor.js と studio-tools.js の後に読む */
const Extras={
 LINEAGE:'pixel-motion-lineage',rootCache:null,refCache:new Map(),refToken:0,check:null,

 /* 「修正版を保存」は新しい結果を作るので、元のイラストはその結果の入力ではない。
    どの変換結果から直してきたかをブラウザに覚えておき、参照画像はそこから取る */
 lineage(){try{const v=JSON.parse(localStorage.getItem(this.LINEAGE)||'{}');return v&&typeof v==='object'?v:{};}catch(e){return {};}},
 rootId(){const m=this.lineage();return m[Studio.key]?.root||m[sourceId]?.root||Studio.key;},
 saved(newId){try{const m=this.lineage();m[newId]={root:this.rootId(),at:Date.now()};const keys=Object.keys(m).sort((a,b)=>(m[a].at||0)-(m[b].at||0));while(keys.length>200)delete m[keys.shift()];localStorage.setItem(this.LINEAGE,JSON.stringify(m));}catch(e){}},

 async rootManifest(){const id=this.rootId();if(this.rootCache?.id===id)return this.rootCache.manifest;const j=await json('/api/jobs/'+id);if(j.status!=='done')throw Error('元の変換結果が見つかりません');this.rootCache={id,manifest:j.manifest};return j.manifest;},
 refBitmap(i){const id=this.rootId(),key=id+':'+i;if(!this.refCache.has(key)){const p=(async()=>{const r=await fetch(`/api/jobs/${id}/input/frame-${String(i).padStart(3,'0')}.png`);if(!r.ok)throw Error('元のイラストを読み込めません。ブラウザ版は直近5件の結果だけを残すため、古い結果の元画像は消えていることがあります');return createImageBitmap(await r.blob());})();p.catch(()=>this.refCache.delete(key));this.refCache.set(key,p);}return this.refCache.get(key);},

 /* 表示の解像度。拡大率そのままだと大きいコマでキャンバスが巨大になるので、長辺4096pxまで */
 scale(d){return Math.max(1,Math.min(Number(el('zoomEdit').value),Math.floor(4096/Math.max(d.width,d.height))));},

 async renderReference(){const d=draft();const overlay=el('refOverlay'),side=el('refSide'),wrap=el('refSideWrap');const mode=el('refMode').value,on=Studio.prefs.panels.reference&&mode!=='off'&&!!d;
  el('refOpacityOut').textContent=el('refOpacity').value;
  if(!on){overlay.hidden=true;wrap.hidden=true;return;}
  const token=++this.refToken;
  try{const [m,bmp]=await Promise.all([this.rootManifest(),this.refBitmap(current)]);if(token!==this.refToken)return;
   const g=m.geometry,crop=g.commonCrop||{x:0,y:0,width:g.width,height:g.height},aligned=crop.width===d.width&&crop.height===d.height&&g.beforeTrim;
   const r=this.scale(d),z=Number(el('zoomEdit').value),target=mode==='overlay'?overlay:side;
   target.width=d.width*r;target.height=d.height*r;target.style.width=d.width*z+'px';target.style.height=d.height*z+'px';
   const c=target.getContext('2d');c.clearRect(0,0,target.width,target.height);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
   if(aligned)c.drawImage(bmp,-crop.x*r,-crop.y*r,g.beforeTrim.width*r,g.beforeTrim.height*r);
   else{const k=Math.min(target.width/bmp.width,target.height/bmp.height);c.drawImage(bmp,(target.width-bmp.width*k)/2,(target.height-bmp.height*k)/2,bmp.width*k,bmp.height*k);}
   overlay.hidden=mode!=='overlay';wrap.hidden=mode!=='side';overlay.style.opacity=el('refOpacity').value/100;wrap.classList.toggle('flipped',el('flipView').checked);
   el('refInfo').textContent=aligned?`元のイラスト ${bmp.width} × ${bmp.height}px を、このコマの ${d.width} × ${d.height}px に位置を合わせて表示しています。`:`元のイラスト（${bmp.width} × ${bmp.height}px）を表示しています。大きさが変わっているため、位置は合わせていません。`;
  }catch(e){if(token!==this.refToken)return;overlay.hidden=true;wrap.hidden=true;el('refInfo').textContent=e.message;}},

 /* ---- 色のチェック ---- */
 key(p,i){return (p[i]<<16)|(p[i+1]<<8)|p[i+2];},
 hexOf(k){return '#'+k.toString(16).padStart(6,'0');},
 scope(){return el('ccAll').checked?Array.from({length:source.frameCount},(_,i)=>i):[current];},
 async find(){if(loading||saving)return;finishStroke();const basis=el('ccBasis').value,frames=this.scope();
  let allowed=null,rareMax=0,near=0;
  if(basis==='near'){near=Number(el('ccNear').value);if(!Number.isInteger(near)||near<1||near>100){say('色の差は1〜100の整数で指定してください。');return;}}
  else if(basis==='palette'){if(el('paletteSource').value==='frame'){say('「パレットにない色」は、左の「パレット」を「共通パレット」か「マイパレット」にしてから探してください。');return;}allowed=new Set(paletteColors().list.map(h=>parseInt(h.slice(1),16)));if(!allowed.size){say('基準にするパレットに色がありません。');return;}}
  else{rareMax=Number(el('ccRare').value);if(!Number.isInteger(rareMax)||rareMax<1||rareMax>999){say('画素数は1〜999の整数で指定してください。');return;}}
  loading=true;controls();try{
   for(const i of frames)await loadFrame(i);
   const count=new Map();for(const i of frames){const p=drafts.get(i).pixels;for(let a=0;a<p.length;a+=4)if(p[a+3]){const k=this.key(p,a);count.set(k,(count.get(k)||0)+1);}}
   /* 似た色: よく使われている色から順に「代表」にし、代表との差が指定以下の色をその代表へまとめる */
   let map=null;if(basis==='near'){map=new Map();const centers=[];for(const k of [...count.keys()].sort((a,b)=>count.get(b)-count.get(a))){const c=centers.find(t=>this.rgbDistance(k,t)<=near);if(c!==undefined)map.set(k,c);else centers.push(k);}}
   const bad=basis==='palette'?k=>!allowed.has(k):basis==='near'?k=>map.has(k):k=>(count.get(k)||0)<=rareMax;
   const badColors=new Map(),perFrame=new Map();let total=0;
   for(const i of frames){const p=drafts.get(i).pixels;let n=0;for(let a=0;a<p.length;a+=4)if(p[a+3]){const k=this.key(p,a);if(bad(k)){n++;badColors.set(k,(badColors.get(k)||0)+1);}}if(n)perFrame.set(i,n);total+=n;}
   /* 置き換え先。パレット基準ならそのパレット、少数色基準なら「少なくない色」全部 */
   const targets=basis==='palette'?[...allowed]:[...count.keys()].filter(k=>count.get(k)>rareMax);
   const unused=basis==='palette'?[...allowed].filter(k=>!count.has(k)):[];
   this.check={basis,frames,bad,badSet:new Set(badColors.keys()),targets,rareMax,map,near,centers:map?new Set(map.values()).size:0,unused};
   this.showResult(total,badColors,perFrame,count.size);
   say(total?`${badColors.size}色・${total}画素を見つけました。黄色い枠で囲んでいます。`:'該当する色は見つかりませんでした。');
  }catch(e){say(e.message);}finally{loading=false;controls();this.updateButtons();draw();}},
 showResult(total,badColors,perFrame,allColors){const box=el('ccResult');box.replaceChildren();const c=this.check;
  const head=document.createElement('p');const label=c.basis==='palette'?'パレットにない色':c.basis==='near'?`差${c.near}以内の似た色（${c.centers}色にまとめられます）`:`${c.rareMax}画素以下しか使われていない色`;head.textContent=total?`${label}：${badColors.size}色・${total.toLocaleString()}画素（調べた色は全${allColors.toLocaleString()}色）`:'見つかりませんでした。';box.append(head);
  if(c.unused?.length)box.append(this.unusedList(c.unused));
  if(!total)return;
  if(c.frames.length>1){const f=document.createElement('div');f.className='cc-frames';for(const [i,n] of perFrame){const b=document.createElement('button');b.type='button';b.textContent=`コマ${i+1}（${n}）`;b.dataset.frame=i;b.onclick=()=>{el('frame').value=i;selectFrame(i);};f.append(b);}box.append(f);}
  const cs=document.createElement('div');cs.className='cc-colors';for(const [k,n] of [...badColors].sort((a,b)=>b[1]-a[1]).slice(0,24)){const s=document.createElement('span'),i=document.createElement('i');i.style.background=this.hexOf(k);s.append(i,document.createTextNode(`${this.hexOf(k)}×${n}`));cs.append(s);}box.append(cs);
  if(badColors.size>24){const more=document.createElement('p');more.textContent=`ほか${badColors.size-24}色`;box.append(more);}},
 unusedList(list){const wrap=document.createElement('div');wrap.className='cc-unused';const p=document.createElement('p');p.textContent=`パレットのうち、調べたコマで使われていない色：${list.length}色`;const cs=document.createElement('div');cs.className='cc-colors';for(const k of list.slice(0,48)){const s=document.createElement('span'),i=document.createElement('i');i.style.background=this.hexOf(k);s.append(i,document.createTextNode(this.hexOf(k)));cs.append(s);}wrap.append(p,cs);
  if(el('paletteSource').value==='mine'){const b=document.createElement('button');b.type='button';b.textContent='使われていない色をマイパレットから外す';b.onclick=()=>{const drop=new Set(list.map(k=>this.hexOf(k)));writeMine(readMine().filter(h=>!drop.has(h.toLowerCase())));buildPalette();b.disabled=true;say(`${drop.size}色をマイパレットから外しました。`);};wrap.append(b);}return wrap;},
 rgbDistance(a,b){const dr=(a>>16&255)-(b>>16&255),dg=(a>>8&255)-(b>>8&255),db=(a&255)-(b&255);return Math.sqrt(dr*dr+dg*dg+db*db);},
 updateButtons(){el('ccClear').disabled=!this.check;el('ccFix').disabled=!this.check||!this.check.badSet.size||!(this.check.map||this.check.targets.length)||loading||saving;for(const b of el('ccResult').querySelectorAll('[data-frame]'))b.classList.toggle('is-current',Number(b.dataset.frame)===current);},
 clear(){this.check=null;el('ccResult').replaceChildren();this.updateButtons();this.renderCheck();say('枠を消しました。');},
 renderCheck(){const d=draft(),o=el('checkOverlay');if(!this.check||!d||!Studio.prefs.panels.colorcheck){o.hidden=true;return;}
  const r=Math.max(4,this.scale(d)),z=Number(el('zoomEdit').value);o.width=d.width*r;o.height=d.height*r;o.style.width=d.width*z+'px';o.style.height=d.height*z+'px';o.hidden=false;
  const c=o.getContext('2d');c.clearRect(0,0,o.width,o.height);c.lineWidth=Math.max(1,r/4);
  for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++){const a=(y*d.width+x)*4;if(!d.pixels[a+3]||!this.check.badSet.has(this.key(d.pixels,a)))continue;c.strokeStyle='#1b1b1b';c.strokeRect(x*r+c.lineWidth/2,y*r+c.lineWidth/2,r-c.lineWidth,r-c.lineWidth);c.strokeStyle='#ffd400';c.strokeRect(x*r+c.lineWidth*1.5,y*r+c.lineWidth*1.5,r-c.lineWidth*3,r-c.lineWidth*3);}
  this.updateButtons();},
 /* 近い色は「赤みの重み付き」RGB距離（redmean）。単純なRGB距離より見た目に近い */
 nearest(k,targets){const r1=k>>16&255,g1=k>>8&255,b1=k&255;let best=targets[0],bd=Infinity;for(const t of targets){const r2=t>>16&255,g2=t>>8&255,b2=t&255,rm=(r1+r2)/2,dr=r1-r2,dg=g1-g2,db=b1-b2,dist=(2+rm/256)*dr*dr+4*dg*dg+(2+(255-rm)/256)*db*db;if(dist<bd){bd=dist;best=t;}}return best;},
 async proposeFix(){if(!this.check||loading||saving)return;finishStroke();const c=this.check;Studio.plans=[];loading=true;controls();try{
  const memo=new Map();for(const i of c.frames){const d=await loadFrame(i),changes=[];for(let a=0;a<d.pixels.length;a+=4){if(!d.pixels[a+3])continue;const k=this.key(d.pixels,a);if(!c.badSet.has(k))continue;if(!memo.has(k))memo.set(k,c.map?c.map.get(k):this.nearest(k,c.targets));const t=memo.get(k);changes.push({at:a,before:Array.from(d.pixels.slice(a,a+4)),after:[t>>16&255,t>>8&255,t&255,d.pixels[a+3]]});}if(changes.length)Studio.plans.push({frame:i,changes,reason:c.map?'似た色をまとめる':'近い色に置き換え'});}
  if(!Studio.plans.length){say('置き換える画素がありません（直したあとなら、探し直してください）。');return;}
  Studio.renderPlans();el('planReview').scrollIntoView({block:'start',behavior:'smooth'});say(`${Studio.plans.length}コマの置き換え候補を出しました。「適用前の確認」で選んで適用してください。`);
 }catch(e){say(e.message);}finally{loading=false;controls();}},

 /* 複数コマを同時に直す（バッチ2で中身を入れる） */
 syncBasis(){const b=el('ccBasis').value;el('ccRareRow').hidden=b!=='rare';el('ccNearRow').hidden=b!=='near';el('ccPaletteNote').hidden=b!=='palette';},
 /* 複数コマを同時に直す（Aseprite #2002）。範囲のコマを先に読み込んでおき、描いたときは同じ位置へ入れる。
    戻すときは1ストロークぶんを全コマまとめて戻す（pixel-editor.js の group） */
 multiRange(){if(!source)return null;const n=source.frameCount,a=Number(el('multiStart').value),b=Number(el('multiEnd').value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>n)return null;return [a-1,b-1];},
 async multiChanged(){const on=el('multiEdit').checked,r=this.multiRange();el('multiRow').hidden=!on;if(source){el('multiStart').max=source.frameCount;el('multiEnd').max=source.frameCount;}
  if(on&&!r){el('multiNote').textContent=`コマは1〜${source?.frameCount}の順で指定してください。`;return;}
  if(on){el('multiNote').textContent='コマを読み込んでいます…';try{for(let i=r[0];i<=r[1];i++)await loadFrame(i);const others=r[1]-r[0]+1-(current>=r[0]&&current<=r[1]?1:0);el('multiNote').textContent=`コマ${r[0]+1}〜${r[1]+1}の同じ位置にも描きます（いま開いているコマのほかに${others}コマ）。Ctrl+Zで全コマまとめて戻ります。`;}catch(e){el('multiNote').textContent=e.message;}}
  Studio.active();Studio.changed();},
 mirrorFrames(){if(!el('multiEdit').checked)return [];const r=this.multiRange();if(!r)return [];const out=[];for(let i=r[0];i<=r[1];i++)if(i!==current&&drafts.has(i))out.push(i);return out;},
 /* ---- 範囲選択と1pxずつの移動（Piskel #741・Aseprite #1437） ----
    ドラッグで長方形を選び、矢印キーかボタンで動かす。動かし始めた時点で中身を「浮かせ」、
    確定するまでは元の画素を base に持っておく。取り消しは base に戻すだけ。
    確定すると、base との差分を1回の修正として履歴に積む。複数コマ同時がONなら、範囲の全コマで同じように動かす */
 sel:null,committing:false,
 selRect(){const s=this.sel;return {x:s.x+s.dx,y:s.y+s.dy,w:s.w,h:s.h};},
 selFrames(){return [current,...this.mirrorFrames()];},
 lift(){const s=this.sel;s.lifted=[];for(const i of this.selFrames()){const d=drafts.get(i),base=d.pixels.slice(),float=new Uint8ClampedArray(s.w*s.h*4);for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const sx=s.x+x,sy=s.y+y;if(sx<0||sy<0||sx>=d.width||sy>=d.height)continue;const a=(sy*d.width+sx)*4;float.set(base.subarray(a,a+4),(y*s.w+x)*4);}s.lifted.push({i,base,float});}},
 place(){const s=this.sel;for(const L of s.lifted){const d=drafts.get(L.i),p=L.base.slice();for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const sx=s.x+x,sy=s.y+y;if(sx>=0&&sy>=0&&sx<d.width&&sy<d.height)p.fill(0,(sy*d.width+sx)*4,(sy*d.width+sx)*4+4);}
   for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const f=(y*s.w+x)*4;if(!L.float[f+3])continue;const tx=s.x+s.dx+x,ty=s.y+s.dy+y;if(tx<0||ty<0||tx>=d.width||ty>=d.height)continue;p.set(L.float.subarray(f,f+4),(ty*d.width+tx)*4);}
   d.pixels.set(p);d.changed=true;}
  draw();},
 moveBy(dx,dy){if(!this.sel||loading||saving)return;if(!this.sel.lifted)this.lift();this.sel.dx+=dx;this.sel.dy+=dy;this.place();this.selInfo();},
 commitSelection(){const s=this.sel;if(!s?.lifted)return;this.committing=true;try{stroke={changes:new Map()};for(const L of s.lifted){const d=drafts.get(L.i),m=new Map();for(let a=0;a<d.pixels.length;a+=4)if(d.pixels[a]!==L.base[a]||d.pixels[a+1]!==L.base[a+1]||d.pixels[a+2]!==L.base[a+2]||d.pixels[a+3]!==L.base[a+3])m.set(a,{at:a,before:Array.from(L.base.subarray(a,a+4)),after:Array.from(d.pixels.subarray(a,a+4))});if(m.size)stroke.changes.set(L.i,m);}
   s.x+=s.dx;s.y+=s.dy;s.dx=0;s.dy=0;s.lifted=null;finishStroke();}finally{this.committing=false;}this.renderSel();this.selInfo();},
 cancelSelection(){const s=this.sel;if(!s)return;if(s.lifted){for(const L of s.lifted)drafts.get(L.i).pixels.set(L.base);s.lifted=null;s.dx=0;s.dy=0;draw();say('移動を取り消しました。');}else{this.sel=null;this.renderSel();say('選択を外しました。');}this.selInfo();},
 clearSelection(){if(!this.sel||loading||saving)return;finishStroke();const r=this.selRect();for(const i of this.selFrames()){const d=drafts.get(i);for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)if(x>=0&&y>=0&&x<d.width&&y<d.height)writePixel(d,i,(y*d.width+x)*4,[0,0,0,0]);}finishStroke();draw();say('選んだ範囲の中身を消しました。');},
 /* 範囲選択の道具を選んだ時点で操作バーを出しておく。選んでから出すと、ドラッグ中にキャンバスが下へずれる */
 selInfo(){const bar=el('selBar'),tool=[el('tool').value,el('toolR').value].includes('select');bar.hidden=!this.sel&&!tool;for(const b of bar.querySelectorAll('button'))b.disabled=!this.sel;if(!this.sel){el('selInfo').textContent='範囲選択：キャンバスをドラッグして選びます';return;}const r=this.selRect(),frames=this.selFrames().length;el('selInfo').textContent=`選択 (${r.x}, ${r.y}) ${r.w} × ${r.h}px${this.sel.lifted?` · 移動中（${this.sel.dx>=0?'+':''}${this.sel.dx}, ${this.sel.dy>=0?'+':''}${this.sel.dy}）`:''}${frames>1?` · ${frames}コマ`:''}`;},
 renderSel(){const d=draft(),o=el('selOverlay');if(!this.sel||!d){o.hidden=true;this.selInfo();return;}const r=Math.max(4,this.scale(d)),z=Number(el('zoomEdit').value),R=this.selRect();o.width=d.width*r;o.height=d.height*r;o.style.width=d.width*z+'px';o.style.height=d.height*z+'px';o.hidden=false;const c=o.getContext('2d');c.clearRect(0,0,o.width,o.height);c.lineWidth=2;c.setLineDash([6,4]);c.strokeStyle='#ffffff';c.strokeRect(R.x*r+1,R.y*r+1,R.w*r-2,R.h*r-2);c.lineDashOffset=5;c.strokeStyle='#0c7480';c.strokeRect(R.x*r+1,R.y*r+1,R.w*r-2,R.h*r-2);this.selInfo();},
 /* キャンバス上の操作。範囲選択の道具か、選択中のドラッグ移動なら、ここで受けて true を返す */
 drag:null,
 pointer(kind,p,slot,alt){if(kind==='up'){if(this.drag){const was=this.drag;this.drag=null;if(was.mode==='new')say('選びました。矢印キーか下のボタンで1pxずつ動かせます（Shiftで5px）。Enterで確定、Escで取り消し。');return true;}return false;}
  if(kind==='move'){if(!this.drag)return false;const [x,y]=p;if(this.drag.mode==='new'){const d=draft(),cx=Math.max(0,Math.min(d.width-1,x)),cy=Math.max(0,Math.min(d.height-1,y)),x0=Math.min(this.drag.sx,cx),y0=Math.min(this.drag.sy,cy);Object.assign(this.sel,{x:x0,y:y0,w:Math.abs(cx-this.drag.sx)+1,h:Math.abs(cy-this.drag.sy)+1});this.renderSel();}else{const tx=this.drag.dx0+x-this.drag.sx,ty=this.drag.dy0+y-this.drag.sy;if(tx!==this.sel.dx||ty!==this.sel.dy)this.moveBy(tx-this.sel.dx,ty-this.sel.dy);}return true;}
  const tool=el(SLOT[slot].tool).value;if(tool!=='select'||alt){if(this.sel?.lifted)this.commitSelection();return false;}
  const [x,y]=p,d=draft();if(x<0||y<0||x>=d.width||y>=d.height)return true;
  if(this.sel){const R=this.selRect();if(x>=R.x&&y>=R.y&&x<R.x+R.w&&y<R.y+R.h){this.drag={mode:'move',sx:x,sy:y,dx0:this.sel.dx,dy0:this.sel.dy};return true;}if(this.sel.lifted)this.commitSelection();}
  this.sel={x,y,w:1,h:1,dx:0,dy:0,lifted:null};this.drag={mode:'new',sx:x,sy:y};this.renderSel();return true;},
 keydown(e){if(!this.sel)return false;const flip=el('flipView').checked?-1:1,step=e.shiftKey?5:1;
  const moves={ArrowLeft:[-step*flip,0],ArrowRight:[step*flip,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
  if(moves[e.key]){e.preventDefault();this.moveBy(...moves[e.key]);return true;}
  if(e.key==='Enter'){e.preventDefault();if(this.sel.lifted){this.commitSelection();say('移動を確定しました。Ctrl+Zで戻せます。');}else{this.sel=null;this.renderSel();}return true;}
  if(e.key==='Escape'){e.preventDefault();this.cancelSelection();return true;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();this.clearSelection();return true;}
  return false;},

 firstRender:true,
 render(){this.renderSel();if(this.firstRender&&source){this.firstRender=false;if(Number(el('multiEnd').value)<=1&&!el('multiEdit').checked)el('multiEnd').value=source.frameCount;this.multiChanged();}this.syncBasis();this.renderReference();this.renderCheck();},
 setup(){
  const base=Studio.renderOverlay.bind(Studio);Studio.renderOverlay=async(...a)=>{const r=base(...a);this.render();return r;};
  for(const id of ['refMode','refOpacity'])el(id).addEventListener('input',()=>this.renderReference());
  /* パネルの表示切り替えは Studio 側の処理が先に prefs を書き換えるので、そのあとで描く */
  for(const id of ['show-reference','show-colorcheck','workspacePreset'])el(id).addEventListener('change',()=>setTimeout(()=>this.render(),0));
  el('ccBasis').onchange=()=>this.syncBasis();this.syncBasis();
  for(const id of ['multiEdit','multiStart','multiEnd'])el(id).addEventListener('change',()=>this.multiChanged());
  for(const b of el('selBar').querySelectorAll('[data-move]'))b.onclick=()=>{const [dx,dy]=b.dataset.move.split(',').map(Number),flip=el('flipView').checked?-1:1;this.moveBy(dx*flip,dy);};
  el('selCommit').onclick=()=>{if(this.sel?.lifted){this.commitSelection();say('移動を確定しました。Ctrl+Zで戻せます。');}else{this.sel=null;this.renderSel();}};el('selCancel').onclick=()=>this.cancelSelection();el('selClear').onclick=()=>this.clearSelection();
  /* コマを切り替えたら選択は外す（浮かせた中身は finishStroke で確定済み） */
  el('frame').addEventListener('change',()=>{this.sel=null;this.renderSel();});
  for(const id of ['tool','toolR'])el(id).addEventListener('change',()=>this.selInfo());
  el('ccFind').onclick=()=>this.find();el('ccClear').onclick=()=>this.clear();el('ccFix').onclick=()=>this.proposeFix();
 }
};
Extras.setup();
