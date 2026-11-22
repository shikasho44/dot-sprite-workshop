/* 日本語 / English の切り替え（2026-09-24）。
   画面の文とJSの文言は日本語のまま書き、英語のときだけ、この仕組みが表示を差し替える。
   訳は i18n-en.js（I18N_EN）。キーは日本語そのもの:
   - text   … 文字だけの要素・テキスト（空白を1つにそろえた文）
   - html   … <b> <kbd> <a> など文中の飾りを含む要素（innerHTML を空白をそろえた形）
   - pre    … 指示文など、改行を保つ <pre>
   - patterns … JSで数値などを埋め込んだ文。[正規表現, 英文（{1}{2}…に埋め込みを戻す）]
   画面があとから書き換えた文も MutationObserver で追いかけて訳す。
   訳が無い文は日本語のまま出し、I18N.missing に集める（抜けの点検用）。
   <head> で i18n-en.js のあとに同期で読む。 */
(function () {
 'use strict';
 const JP = /[　-ヿ㐀-鿿！-ﾟ]/;
 const KEY = 'pixel-motion-lang';
 const params = new URLSearchParams(location.search);
 function pick() {
  const q = params.get('lang');
  if (q === 'en' || q === 'ja') { try { localStorage.setItem(KEY, q); } catch (e) {} return q; }
  try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'ja') return s; } catch (e) {}
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
 }
 const lang = pick();
 const D = window.I18N_EN || { text: {}, html: {}, pre: {}, patterns: [] };
 const patterns = (D.patterns || []).map(([re, en]) => [new RegExp('^' + re + '$'), en]);
 /* 連結でできた文のための部品。長いものから置き換える */
 const fragments = Object.keys(D.text || {}).filter(k => k.length >= 3).sort((a, b) => b.length - a.length);
 const missing = new Map();
 const norm = s => s.replace(/\s+/g, ' ').trim();
 function note(kind, key) { if (!missing.has(key)) missing.set(key, kind); }

 function tr(s, depth = 0) {
  const k = norm(s);
  if (!k || !JP.test(k)) return null;
  if (D.text[k] != null) return D.text[k];
  for (const [re, en] of patterns) {
   const m = re.exec(k);
   if (m) return en.replace(/\{(\d+)\}/g, (_, i) => { const v = m[Number(i)] ?? ''; return depth < 4 && JP.test(v) ? (tr(v, depth + 1) ?? v) : v; });
  }
  /* 文を足し合わせて作った表示（「…です。」＋「（…）」など）は、文の切れ目で分けて訳す */
  if (depth < 3) {
   const parts = k.split(/(?<=[。！？])\s*|(?=（)/).filter(Boolean);
   if (parts.length > 1) { const done = parts.map(p => JP.test(p) ? tr(p, depth + 1) : p); if (done.every(x => x != null)) return done.join(' ').replace(/\s+\(/g, ' ('); }
  }
  if (depth === 0) {
   let out = k, hit = false;
   for (const f of fragments) if (out.includes(f)) { out = out.split(f).join(D.text[f]); hit = true; if (!JP.test(out)) break; }
   if (hit && !JP.test(out)) return out;
  }
  return null;
 }

 const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'KBD', 'CODE', 'A', 'BR', 'SPAN', 'SMALL', 'SUP', 'SUB', 'MARK', 'U', 'S', 'ABBR', 'TIME', 'WBR']);
 const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'SVG', 'CANVAS', 'NOSCRIPT', 'TEMPLATE']);
 /* 文中の飾りだけでできていて、中に id や入力欄が無い要素は、まるごと1つの文として訳す（語順が変わるため） */
 /* ダウンロードや結果へのリンクは毎回URLが変わるので、まとめて1つの文にすると二度と一致しない。そういう要素は文ごとに訳す */
 const VOLATILE = /blob:|data:|[0-9a-f]{8}-[0-9a-f]{4}-/i;
 function isLeaf(el) {
  for (const c of el.querySelectorAll('*')) if (!INLINE.has(c.tagName) || c.id || (c.tagName === 'A' && VOLATILE.test(c.getAttribute('href') || ''))) return false;
  return true;
 }
 function attrs(el) {
  for (const a of ['title', 'aria-label', 'placeholder', 'alt']) {
   const v = el.getAttribute(a);
   if (v && JP.test(v)) { const t = tr(v); if (t != null) el.setAttribute(a, t); else note('text', norm(v)); }
  }
  if (el.tagName === 'META' && /description/i.test(el.getAttribute('name') || '')) { const v = el.getAttribute('content'); const t = v && tr(v); if (t != null) el.setAttribute('content', t); }
 }
 function leaf(el) {
  if (el.tagName === 'PRE') {
   const raw = el.textContent.replace(/\r\n/g, '\n').trim();
   if (!JP.test(raw)) return;
   if (D.pre && D.pre[raw] != null) el.textContent = D.pre[raw]; else note('pre', raw);
   return;
  }
  if (!el.children.length) {
   const t = tr(el.textContent);
   if (t != null) el.textContent = t; else if (JP.test(el.textContent)) note('text', norm(el.textContent));
   return;
  }
  const k = norm(el.innerHTML);
  if (!JP.test(k)) return;
  if (D.html[k] != null) { el.innerHTML = D.html[k]; return; }
  const t = tr(k);
  if (t != null) { el.innerHTML = t; return; }
  /* まとめて訳せないときは、中の文を1つずつ訳す（見出しと添え書きを並べた表示など） */
  let left = false;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { if (!JP.test(n.data)) continue; const x = tr(n.data); if (x != null) { const lead = n.data.match(/^\s*/)[0], trail = n.data.match(/\s*$/)[0]; n.data = lead + x + trail; } else left = true; }
  if (left) note('html', k);
 }
 function textNode(n) {
  if (!JP.test(n.data)) return;
  const t = tr(n.data);
  if (t != null) { const lead = n.data.match(/^\s*/)[0], trail = n.data.match(/\s*$/)[0]; n.data = lead + t + trail; }
  else note('text', norm(n.data));
 }
 function walk(el) {
  if (el.nodeType !== 1 || el.closest('[data-no-i18n]')) return;
  attrs(el);
  if (SKIP.has(el.tagName)) return; // 中身は訳さないが、aria-label などの説明は訳す
  if (el.tagName === 'OPTION' || isLeaf(el)) { leaf(el); return; }
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) textNode(c); else if (c.nodeType === 1) walk(c); }
 }

 function toggleButton() {
  const bar = document.querySelector('header.top, header.site-head, header');
  if (!bar || document.getElementById('langToggle')) return;
  const b = document.createElement('button');
  b.id = 'langToggle'; b.type = 'button'; b.className = 'lang-toggle'; b.setAttribute('data-no-i18n', '');
  b.textContent = lang === 'en' ? '日本語' : 'English';
  b.setAttribute('aria-label', lang === 'en' ? '日本語に切り替える' : 'Switch to English');
  b.onclick = () => { const next = lang === 'en' ? 'ja' : 'en'; try { localStorage.setItem(KEY, next); } catch (e) {} const u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.href); };
  bar.append(b);
 }

 window.I18N = { lang, t: s => (lang === 'en' ? tr(s) ?? s : s), missing, walk };
 document.documentElement.lang = lang;
 if (lang !== 'en') { document.addEventListener('DOMContentLoaded', toggleButton); return; }
 /* 英語のときは、訳し終えるまで本文を見せない（日本語が一瞬見えるのを防ぐ） */
 document.documentElement.classList.add('i18n-pending');
 document.addEventListener('DOMContentLoaded', () => {
  walk(document.head); walk(document.body); toggleButton();
  document.documentElement.classList.remove('i18n-pending');
  new MutationObserver(records => {
   for (const r of records) {
    if (r.type === 'attributes') { if (r.target.nodeType === 1) attrs(r.target); continue; }
    const target = r.type === 'characterData' ? r.target.parentElement : r.target;
    if (!target || target.closest('[data-no-i18n]')) continue;
    if (r.type === 'characterData') { if (target.tagName === 'OPTION' || isLeaf(target)) leaf(target); else textNode(r.target); continue; }
    if (target.nodeType === 1 && target !== document.body && (target.tagName === 'OPTION' || isLeaf(target))) { leaf(target); continue; }
    for (const n of r.addedNodes) { if (n.nodeType === 1) walk(n); else if (n.nodeType === 3 && n.parentElement) textNode(n); }
   }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt'] });
 });
 const style = document.createElement('style');
 style.textContent = 'html.i18n-pending body{visibility:hidden}';
 document.head.append(style);
})();
