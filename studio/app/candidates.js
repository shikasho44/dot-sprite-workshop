'use strict';
let comparing=false, comparisonCancelled=false, comparisonJob=null, candidates=[];
const routeNames={auto:'自動判定',convert:'イラストを縮小',refine:'格子を整形',preserve:'原寸を維持'};
function resetCandidates(){candidates=[];$('candidates').hidden=true;$('candidateCards').replaceChildren();}
function sizeDescription(m){const g=m.geometry;return `入力 ${g.source.width} × ${g.source.height} → 変換キャンバス ${g.beforeTrim.width} × ${g.beforeTrim.height} → 完成PNG ${g.width} × ${g.height} px`;}
function syncSize(){
 const f=frames[0],h=Number($('height').value);
 $('sizeHint').textContent=f?(h&&h>f.height?`キャンバス高さ ${h}px は元の高さ ${f.height}px より大きいので変換できません。空欄（自動）か ${f.height} 以下にしてください。`:h?`入力 ${f.width} × ${f.height} → 予定キャンバス ${Math.max(1,Math.round(f.width/f.height*h))} × ${h}px。完成PNGは共通トリム後に確定します。`:'高さは自動判定。完成PNGの寸法は処理後に表示します。'):'画像を読み込むと、変換前後のサイズを確認できます。';
 $('sizeResult').hidden=!manifest;
 if(manifest){$('sizeResult').textContent=sizeDescription(manifest)+(manifest.settings.trim?'（全コマ共通の余白を除去）':'（余白を維持）');}
}
function paintCandidates(){
 const scrollPosition={left:window.scrollX,top:window.scrollY};
 $('candidates').hidden=!candidates.length;
 $('candidateCards').replaceChildren();
 for(const c of candidates){
  const card=document.createElement('article');card.className='candidate';
  const title=document.createElement('h3');title.textContent=c.label;
  const condition=document.createElement('p');condition.className='hint';condition.textContent=`高さ ${c.settings.height?c.settings.height+'px':'自動'} / ${c.settings.colors?c.settings.colors+'色まで':'減色なし'}`;
  card.append(title,condition);
  if(c.state?.status==='done'){
   const m=c.state.manifest;
   const stage=document.createElement('div');stage.className='candidate-image';
   const img=document.createElement('img');img.alt=c.label+'の先頭コマ';img.src=`/api/jobs/${c.state.id}/output/frame-000.png`;const zoom=Number($('candidateZoom').value);img.style.width=m.geometry.width*zoom+'px';img.style.height=m.geometry.height*zoom+'px';stage.append(img);
   const dimensions=document.createElement('p');dimensions.textContent=`完成 ${m.geometry.width} × ${m.geometry.height}px / 先頭 ${m.frames[0].output.colors.toLocaleString()}色`;
   const route=document.createElement('p');route.className='hint';route.textContent=`実際の処理：${routeNames[m.referenceRoute]||m.referenceRoute} / ${m.frameCount}コマ`;
   const adopt=document.createElement('button');adopt.textContent=job?.id===c.state.id?'採用中':'この候補を採用';adopt.disabled=busy;adopt.setAttribute('aria-label',c.label+'を採用');
   adopt.onclick=()=>{if(busy)return;stop();job=c.state;applySettings(m.settings);renderResult(m);sessionStorage.setItem('pixel-motion-last-job',job.id);history.replaceState(null,'',`?job=${job.id}`);paintCandidates();status(c.label+'を採用しました。全コマの再生・書き出しができます。');};
   const reopen=document.createElement('a');reopen.href=`/?job=${c.state.id}`;reopen.textContent='設定と結果の固定リンク';
   card.append(stage,dimensions,route,adopt,reopen);
  }else{const p=document.createElement('p');p.textContent=c.error||c.message||'待機中';card.append(p);}
  $('candidateCards').append(card);
 }
 window.scrollTo(scrollPosition);
}
function applySettings(s){for(const k of ['mode','detail','height','colors','background','fps'])$(k).value=k==='height'&&!s[k]?'':s[k];if(s.keyColor)$('keyColor').value=s.keyColor;if(s.keyTolerance!=null)$('keyTolerance').value=s.keyTolerance;if(s.despill!=null)$('despill').checked=s.despill;if(typeof syncKey==='function')syncKey();$('trim').checked=s.trim;$('hardAlpha').checked=s.hardAlpha??false;$('modeHint').textContent=modeHints[s.mode];}
async function compareCandidates(){
 if(busy||!frames.length)return;
 const s=settings();
 if(!Number.isFinite(s.fps)||s.fps<1||s.fps>60)return status('FPSは1〜60で指定してください。',true);
 if(s.height&&(!Number.isInteger(s.height)||s.height<16||s.height>512))return status('高さは空欄、または16〜512の整数で指定してください。',true);
 stop();busy=true;comparing=true;comparisonCancelled=false;comparisonJob=null;controls();
 candidates=[{label:'自動判定',settings:{...s,mode:'auto',height:0}},{label:'イラストを縮小',settings:{...s,mode:'convert',height:s.height||Math.min(96,frames[0]?.height||96)}},{label:'格子を整形',settings:{...s,mode:'refine',height:0}}];
 paintCandidates();status('3候補を比較します。元の採用結果は保持しています。');
 try{
  const payload=[];for(const f of frames){if(comparisonCancelled)break;payload.push({name:f.name,png:await toBase64(f.blob)});}
  for(const [index,c] of candidates.entries()){
   if(comparisonCancelled)break;
   c.message='処理中…';paintCandidates();
   try{
    comparisonJob=await jsonFetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:c.settings,frames:payload})});
    if(comparisonCancelled)await jsonFetch(`/api/jobs/${comparisonJob.id}/cancel`,{method:'POST'});
    for(;;){
     const state=await jsonFetch(`/api/jobs/${comparisonJob.id}`);
     if(state.status==='done'){c.state=state;break;}
     if(state.status==='error')throw Error(state.error);
     if(state.status==='cancelled'){c.message='中止しました';break;}
     status(`${index+1} / 3　${c.label}：${state.progress?.stage||'待機中'}`);
     await new Promise(r=>setTimeout(r,500));
    }
   }catch(e){c.error='この候補は処理できませんでした：'+e.message;}
   comparisonJob=null;paintCandidates();
  }
 }catch(e){status(e.message,true);}
 finally{
  for(const c of candidates)if(!c.state&&!c.error)c.message=comparisonCancelled?'中止しました':'処理できませんでした';
  busy=false;comparing=false;comparisonJob=null;controls();paintCandidates();
  const completed=candidates.filter(c=>c.state?.status==='done').length;
  status(`${comparisonCancelled?'比較を中止しました。':'比較が完了しました。'} ${completed?completed+' / 3候補から採用できます。':'完成した候補はありません。元の採用結果は保持しています。'}`,completed===0&&!comparisonCancelled);
 }
}
$('compare').onclick=compareCandidates;

$('candidateZoom').onchange=paintCandidates;
