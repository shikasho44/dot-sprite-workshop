(function(root){
 'use strict';
 const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 function recolor(d,from,to,protect){const out=[];for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++){const at=(y*d.width+x)*4,before=Array.from(d.pixels.slice(at,at+4));if(!before[3]||!same(before.slice(0,3),from))continue;if(protect&&x>=protect.x&&x<protect.x+protect.w&&y>=protect.y&&y<protect.y+protect.h)continue;const after=[...to,before[3]];if(!same(before,after))out.push({at,before,after});}return out;}
 function translate(d,changes,sourceWidth,dx,dy){const out=[];for(const c of changes){const p=c.at/4,x=p%sourceWidth+dx,y=Math.floor(p/sourceWidth)+dy;if(x<0||y<0||x>=d.width||y>=d.height)return {changes:[],reason:'キャンバス外に出ます'};const at=(y*d.width+x)*4;if(!same(Array.from(d.pixels.slice(at,at+4)),c.before))return {changes:[],reason:'変更前の画素が一致しません'};out.push({at,before:[...c.before],after:[...c.after]});}return {changes:out,reason:''};}
 function valid(d,changes,reverse=false){return changes.every(c=>Number.isInteger(c.at)&&c.at>=0&&c.at+4<=d.pixels.length&&same(Array.from(d.pixels.slice(c.at,c.at+4)),reverse?c.after:c.before));}
 const api={same,recolor,translate,valid};if(typeof module!=='undefined')module.exports=api;else root.EditOps=api;
})(typeof window==='undefined'?this:window);
