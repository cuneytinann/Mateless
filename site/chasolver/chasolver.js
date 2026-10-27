(function(){
'use strict';
var B=CHA.B, $=function(id){return document.getElementById('cha-'+id)}, ROOT=document.getElementById('tab-chasolver');

/* ================= i18n ================= */
var DICT={
en:{
 title:'chasolver',
 h1:'Can this side still mate, by any series of legal moves?',
 sub:'chasolver answers <b>winnable</b> and shows a mating line, or <b>unwinnable</b> and proves it. This is Miguel Ambrona’s chasolver 3.0.0, ported to JavaScript with the same verdicts and the same lines as the Rust original, running in your browser. Mateless is the fast layer in front of it; this is the complete solver behind.',
 lblLang:'Language',
 navArb:'Arbiter',
 navCha:'chasolver',
 lblFen:'Positions',
 fenHint:'A FEN, one per line. End a line with <code>white</code> or <code>black</code> to choose the side for that line alone; lines starting with <code>#</code> are skipped. A chasolver label in front (<code>WB</code>, <code>W-</code>, <code>-B</code>, <code>--</code>) is checked against the answer. Ctrl+Enter analyzes.',
 exTry:'Examples:',
 ex0:'a locked flag fall',
 ex1:'the starting position',
 ex2:'a long helpmate',
 hFiles:'Files',
 dropBig:'Drop CSV or TXT files here, or click to choose',
 dropSmall:'CSV: the <code>fen</code> column is read, and <code>gameId</code> and <code>label</code> if present. TXT: one position per line, as in the box, so chasolver’s <code>WB &lt;fen&gt;</code> format works too. Each file becomes a set named after it.',
 dataHint:'chasolver lists every Lichess game lost on time that should have been drawn: download the CSV files from <a href="https://chasolver.org/unfair-games">chasolver.org/unfair-games</a> and drop them here.',
 fRows:'{0} positions',
 fBad:'{0} unreadable rows skipped',
 fLabels:'reference: the labels in the file',
 fRef:'reference',
 fRefNone:'none',
 fRefUnwin:'every row is unwinnable',
 fRemove:'Remove {0}',
 fClear:'Remove all files',
 fReading:'Reading {0}…',
 fFail:'Could not read {0}: {1}',
 lgWho:'Can … still mate?',
 whoAuto:'the side not to move',
 whoW:'White',
 whoB:'Black',
 whoHint:'When the clock of the side to move runs out, the side not to move wins only if it can still mate (FIDE 6.9). That is the question asked by default; a line ending in white or black overrides it.',
 lblFast:'Fast check only: proves unwinnable, never winnable',
 lblRange:'positions',
 lblRangeTo:'to',
 lblRangeNote:'in input order, pasted lines first; 0 = to the end',
 lblBoth:'labelled lines for both sides',
 go1:'Analyze',
 goN:'Analyze {0} positions',
 go0:'Enter a position or add a file',
 goSplit:'{0} pasted + {1} from files',
 goStop:'Stop',
 running:'Analyzing… {0} s',
 runningN:'{0} / {1} · {2} per second · about {3} s left',
 done1:'Done in {0}.',
 doneN:'{0} positions in {1} ({2} per second).',
 stopped:'Stopped after {0} of {1} positions; everything below covers those.',
 noWorker:'This browser would not start a background worker, so the analysis runs on the page itself and the page may pause while it works.',
 pastedSet:'pasted',
 v_winnable:'Winnable',
 v_unwinnable:'Unwinnable',
 v_undetermined:'Undetermined',
 v_unproven:'Not proven',
 v_bad:'Not a FEN',
 v_error:'Error',
 v_pending:'Waiting',
 t_winnable:'{0} can still checkmate. The line below is one way: both sides cooperate, and it ends in mate.',
 t_unwinnable:'{0} cannot checkmate by any sequence of legal moves. If {1}’s flag falls in this position, the game is drawn.',
 t_undetermined:'The search reached its limits without settling the question either way.',
 t_unproven:'The fast check found no proof that {0} cannot mate. It never proves the opposite; clear “fast check only” for a full answer.',
 t_bad:'The solver does not accept this line. It needs the piece placement and the side to move, exactly one king per side, the two kings apart, castling rights only where king and rook still stand on their squares, and the side not to move out of check.',
 t_error:'The analysis stopped with an error: {0}',
 t_stack:'The analysis needed a deeper call stack than this browser allows.',
 t_pending:'Waiting for its turn.',
 hLine:'Mating line',
 startPos:'start',
 plyOf:'ply {0} of {1}',
 kWinner:'can mate',
 kToMove:'to move',
 kMode:'analysis',
 mFull:'full',
 mFast:'fast check',
 kTime:'time',
 kRef:'reference',
 kSource:'source',
 refLabel:'label {0}',
 refFile:'the file says unwinnable',
 r_ok:'agrees: {0}',
 r_no:'expected {0}',
 r_open:'expected {0}, not settled here',
 copyFen:'Copy FEN',
 copyUci:'Copy line (UCI)',
 copied:'Copied',
 lichess:'Open on lichess',
 flip:'Flip board',
 first:'Start',
 prev:'Previous move',
 next:'Next move',
 last:'Final position',
 white:'White',
 black:'Black',
 hBatch:'All positions',
 s_agree:'agree with the reference',
 s_disagree:'disagree with the reference',
 fShow:'show',
 f_all:'all',
 f_disagree:'disagree with the reference',
 f_agree:'agree with the reference',
 dlTxt:'Download analyzer output',
 dlCsv:'Download CSV',
 pgPrev:'Previous',
 pgNext:'Next',
 pgOf:'page {0} of {1} · {2} positions',
 none:'No position matches this filter.',
 thN:'#',
 thSet:'set',
 thId:'row',
 thVerdict:'verdict',
 thSide:'can mate',
 thPly:'line',
 thMs:'ms',
 thRef:'reference',
 thFen:'position',
 thRows:'positions',
 thDone:'done',
 thOpen:'not settled',
 thBad:'unreadable',
 thTime:'time',
 thTot:'total',
 foot:'Engine: chasolver-js, a JavaScript port of <a href="https://github.com/miguel-ambrona/chasolver">chasolver</a> 3.0.0 (Copyright © 2021–2026 Miguel Ambrona) with parts derived from the <a href="https://github.com/jordanbray/chess">chess</a> crate (Copyright © 2010–2016 Jordan Bray), both MIT licensed; the licence texts are at the top of this file’s source. On 398,960 inputs its fast check gave the official Rust build’s answer on every row. Everything runs in your browser, in a background worker; no position or file leaves the page. chasolver’s own site: <a href="https://chasolver.org">chasolver.org</a>, with the Lichess games lost on time that should have been drawn at <a href="https://chasolver.org/unfair-games">chasolver.org/unfair-games</a>. Part of <a href="https://github.com/cuneytinann/Mateless">Mateless</a>.',
},
tr:{
 title:'chasolver',
 h1:'Bu taraf herhangi bir legal hamle dizisiyle hâlâ mat edebilir mi?',
 sub:'chasolver ya <b>kazanılabilir</b> der ve bir mat hattı gösterir, ya da <b>kazanılamaz</b> der ve bunu kanıtlar. Bu, Miguel Ambrona’nın chasolver 3.0.0’ı; Rust aslıyla aynı hükümleri ve aynı hatları veren bir JavaScript çevirisi, tarayıcında çalışıyor. Mateless onun önündeki hızlı katman; bu, arkasındaki tam çözücü.',
 lblLang:'Dil',
 navArb:'Hakem',
 navCha:'chasolver',
 lblFen:'Pozisyonlar',
 fenHint:'Her satıra bir FEN. Yalnız o satırın tarafını seçmek için satırı <code>white</code> ya da <code>black</code> ile bitir; <code>#</code> ile başlayan satırlar atlanır. Başta bir chasolver etiketi (<code>WB</code>, <code>W-</code>, <code>-B</code>, <code>--</code>) varsa cevapla karşılaştırılır. Ctrl+Enter analiz eder.',
 exTry:'Örnekler:',
 ex0:'kilitli bir bayrak düşüşü',
 ex1:'başlangıç pozisyonu',
 ex2:'uzun bir yardımlı mat',
 hFiles:'Dosyalar',
 dropBig:'CSV ya da TXT dosyalarını buraya bırak ya da seçmek için tıkla',
 dropSmall:'CSV: <code>fen</code> sütunu, varsa <code>gameId</code> ve <code>label</code> da okunur. TXT: kutudaki gibi satır başına bir pozisyon; chasolver’ın <code>WB &lt;fen&gt;</code> biçimi de olur. Her dosya, adını taşıyan bir küme olur.',
 dataHint:'chasolver, berabere bitmesi gerekirken süreden kaybedilmiş bütün Lichess oyunlarını listeliyor: CSV dosyalarını <a href="https://chasolver.org/unfair-games">chasolver.org/unfair-games</a> adresinden indirip buraya bırak.',
 fRows:'{0} pozisyon',
 fBad:'{0} okunamayan satır atlandı',
 fLabels:'referans: dosyadaki etiketler',
 fRef:'referans',
 fRefNone:'yok',
 fRefUnwin:'her satır kazanılamaz',
 fRemove:'{0} dosyasını kaldır',
 fClear:'Tüm dosyaları kaldır',
 fReading:'{0} okunuyor…',
 fFail:'{0} okunamadı: {1}',
 lgWho:'… hâlâ mat edebilir mi?',
 whoAuto:'sırası olmayan taraf',
 whoW:'Beyaz',
 whoB:'Siyah',
 whoHint:'Sırası gelen tarafın süresi bittiğinde, sırası olmayan taraf ancak hâlâ mat edebiliyorsa kazanır (FIDE 6.9). Varsayılan olarak sorulan soru bu; white ya da black ile biten satır bunu geçersiz kılar.',
 lblFast:'Yalnız hızlı kontrol: kazanılamazlığı kanıtlar, kazanılabilirliği asla',
 lblRange:'pozisyonlar',
 lblRangeTo:'–',
 lblRangeNote:'giriş sırasıyla, yapıştırılanlar önce; 0 = sona kadar',
 lblBoth:'etiketli satırlar iki taraf için',
 go1:'Analiz et',
 goN:'{0} pozisyonu analiz et',
 go0:'Bir pozisyon gir ya da dosya ekle',
 goSplit:'{0} yapıştırılan + {1} dosyalardan',
 goStop:'Durdur',
 running:'Analiz ediliyor… {0} sn',
 runningN:'{0} / {1} · saniyede {2} · kalan ~{3} sn',
 done1:'{0} içinde bitti.',
 doneN:'{0} pozisyon, {1} içinde (saniyede {2}).',
 stopped:'{1} pozisyonun {0} tanesinden sonra durduruldu; aşağıdakiler onları kapsıyor.',
 noWorker:'Bu tarayıcı arka plan işçisi başlatmadı; analiz sayfanın kendisinde çalışıyor ve sayfa iş sürerken duraklayabilir.',
 pastedSet:'yapıştırılan',
 v_winnable:'Kazanılabilir',
 v_unwinnable:'Kazanılamaz',
 v_undetermined:'Belirsiz',
 v_unproven:'Kanıtlanmadı',
 v_bad:'FEN değil',
 v_error:'Hata',
 v_pending:'Sırada',
 t_winnable:'{0} hâlâ mat edebilir. Aşağıdaki hat bunun bir yolu: iki taraf iş birliği yapıyor ve hat matla bitiyor.',
 t_unwinnable:'{0} hiçbir legal hamle dizisiyle mat edemez. Bu pozisyonda {1} tarafının bayrağı düşerse oyun berabere biter.',
 t_undetermined:'Arama sınırlarına ulaştı; soruyu iki yönde de çözemedi.',
 t_unproven:'Hızlı kontrol, {0} tarafının mat edemeyeceğine dair kanıt bulamadı. Tersini hiçbir zaman kanıtlamaz; tam cevap için “yalnız hızlı kontrol”ü kaldır.',
 t_bad:'Çözücü bu satırı kabul etmiyor. Taş dizilimi ve sıra alanı gerekli; her tarafta tam bir şah olmalı, şahlar yan yana olmamalı, rok hakkı yalnız şahla kalenin hâlâ kendi karelerinde durduğu tarafta bulunmalı ve sırası olmayan taraf şah altında olmamalı.',
 t_error:'Analiz bir hatayla durdu: {0}',
 t_stack:'Analiz, bu tarayıcının izin verdiğinden daha derin bir çağrı yığınına ihtiyaç duydu.',
 t_pending:'Sırasını bekliyor.',
 hLine:'Mat hattı',
 startPos:'başlangıç',
 plyOf:'{1} yarım hamlenin {0}.’si',
 kWinner:'mat edebilecek',
 kToMove:'sıra',
 kMode:'analiz',
 mFull:'tam',
 mFast:'hızlı kontrol',
 kTime:'süre',
 kRef:'referans',
 kSource:'kaynak',
 refLabel:'etiket {0}',
 refFile:'dosyaya göre kazanılamaz',
 r_ok:'uyuşuyor: {0}',
 r_no:'beklenen {0}',
 r_open:'beklenen {0}, burada çözülmedi',
 copyFen:'FEN’i kopyala',
 copyUci:'Hattı kopyala (UCI)',
 copied:'Kopyalandı',
 lichess:'lichess’te aç',
 flip:'Tahtayı çevir',
 first:'Başa',
 prev:'Önceki hamle',
 next:'Sonraki hamle',
 last:'Son pozisyon',
 white:'Beyaz',
 black:'Siyah',
 hBatch:'Bütün pozisyonlar',
 s_agree:'referansla uyuşuyor',
 s_disagree:'referansla uyuşmuyor',
 fShow:'göster',
 f_all:'hepsi',
 f_disagree:'referansla uyuşmayanlar',
 f_agree:'referansla uyuşanlar',
 dlTxt:'Analyzer çıktısını indir',
 dlCsv:'CSV indir',
 pgPrev:'Önceki',
 pgNext:'Sonraki',
 pgOf:'sayfa {0} / {1} · {2} pozisyon',
 none:'Bu süzgece uyan pozisyon yok.',
 thN:'#',
 thSet:'küme',
 thId:'satır',
 thVerdict:'hüküm',
 thSide:'mat edebilecek',
 thPly:'hat',
 thMs:'ms',
 thRef:'referans',
 thFen:'pozisyon',
 thRows:'pozisyon',
 thDone:'biten',
 thOpen:'çözülmeyen',
 thBad:'okunamayan',
 thTime:'süre',
 thTot:'toplam',
 foot:'Motor: chasolver-js; <a href="https://github.com/miguel-ambrona/chasolver">chasolver</a> 3.0.0’ın (Copyright © 2021–2026 Miguel Ambrona) JavaScript çevirisi, bazı kısımları <a href="https://github.com/jordanbray/chess">chess</a> crate’inden (Copyright © 2010–2016 Jordan Bray) türetildi; ikisi de MIT lisanslı, lisans metinleri bu dosyanın kaynağının başında. 398.960 girdide hızlı kontrolü resmi Rust sürümüyle her satırda aynı cevabı verdi. Her şey tarayıcında, bir arka plan işçisinde çalışır; hiçbir pozisyon ya da dosya sayfadan çıkmaz. chasolver’ın kendi sitesi: <a href="https://chasolver.org">chasolver.org</a>; berabere bitmesi gerekirken süreden kaybedilmiş Lichess oyunları <a href="https://chasolver.org/unfair-games">chasolver.org/unfair-games</a> sayfasında. <a href="https://github.com/cuneytinann/Mateless">Mateless</a>’in parçası.',
}};
var lang='en';
function T(k){var v=DICT[lang][k];return v===undefined?DICT.en[k]:v}
function F(k){var A=arguments;return T(k).replace(/\{(\d+)\}/g,function(_,i){return A[+i+1]})}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function num(x){return Number(x).toLocaleString(lang=='tr'?'tr-TR':'en-US')}
function side(c){return c===B.WHITE?T('white'):T('black')}
function dur(ms){return ms>=1000?(ms/1000).toFixed(ms>=10000?0:1)+(lang=='tr'?' sn':' s'):(ms<10?ms.toFixed(1):Math.round(ms))+' ms'}
function setName(s){return s===''?T('pastedSet'):s}
var VERDICTS=['winnable','unwinnable','undetermined','unproven','bad','error'];

/* ================= input: the box and the files ================= */
var EXAMPLES=[
  '5b2/p7/Pp3k2/1Pp1pBp1/2P1P1P1/5K2/8/8 w - -',
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  '8/1p4p1/kPp3p1/2P3p1/1pP3P1/1P6/8/7K w - -'
];
/* One position as the analyzer reads it: an optional chasolver label in front, an optional
   white|black at the end. The FEN itself is left to the solver; only a FEN given with just
   placement and side gets "- -", since the solver's reader wants four fields. */
function lineToRow(line,set,id){
  var toks=line.trim().split(/\s+/), label=null, w=null, last;
  if(/^(WB|W-|-B|--)$/.test(toks[0]))label=toks.shift();
  last=toks[toks.length-1];
  if(last==='white'||last==='black'){ w=last==='white'?B.WHITE:B.BLACK; toks.pop() }
  if(toks.length===2)toks.push('-','-'); else if(toks.length===3)toks.push('-');
  return{set:set,id:id,fen:toks.slice(0,6).join(' '),label:label,w:w}
}
function pastedRows(){
  var out=[], L=$('fen').value.split(/\r?\n/), i, s;
  for(i=0;i<L.length;i++){ s=L[i].trim(); if(s&&s.charAt(0)!=='#')out.push(lineToRow(s,'',String(i+1))) }
  return out }

var files=[], fileSeq=0;
function parseTXT(text,f){
  var L=text.split(/\r?\n/), rows=[], i, s;
  for(i=0;i<L.length;i++){ s=L[i].trim(); if(s&&s.charAt(0)!=='#')rows.push(lineToRow(s,f.set,String(i+1))) }
  return{rows:rows,bad:0,head:''} }
function parseCSV(text,f){
  var L=text.split(/\r?\n/), head=L[0].split(',').map(function(s){return s.trim()}),
      fi=head.indexOf('fen'), gi=head.indexOf('gameId'), li=head.indexOf('label'), rows=[], bad=0, i, col, r;
  if(fi<0)fi=head.length-1;
  for(i=1;i<L.length;i++){
    if(!L[i].trim())continue;
    col=L[i].split(',');
    if(col.length<head.length||!col[fi]||!col[fi].trim()){bad++;continue}
    r=lineToRow(col[fi],f.set,gi>=0&&col[gi]?col[gi].trim():String(i+1));
    if(li>=0&&/^(WB|W-|-B|--)$/.test((col[li]||'').trim()))r.label=col[li].trim();
    rows.push(r) }
  return{rows:rows,bad:bad,head:head.join(',')} }
function addFiles(list){
  var pending=list.length; if(!pending)return;
  say(F('fReading',Array.prototype.map.call(list,function(f){return f.name}).join(', ')));
  Array.prototype.forEach.call(list,function(file){
    file.text().then(function(txt){
      var base=file.name.replace(/\.(csv|txt)$/i,''), set=base, n=2;
      while(set===''||files.some(function(x){return x.set===set}))set=base+' ('+(n++)+')';
      var f={key:++fileSeq,name:file.name,set:set,rows:[],bad:0,labs:0,ref:'none'};
      var first=(txt.split(/\r?\n/,1)[0]||'');
      var csv=/\.csv$/i.test(file.name)||/(^|,)\s*fen\s*(,|$)/.test(first);
      var P=csv?parseCSV(txt,f):parseTXT(txt,f);
      f.rows=P.rows; f.bad=P.bad;
      f.rows.forEach(function(r){ if(r.label)f.labs++; r.file=f });
      /* chasolver's wrongly decided timeouts, and missed-draw exports of them: unwinnable by construction */
      if(!f.labs&&(/(^|,)lastMove(,|$)/.test(P.head)||/chasolver-data|missed-draws?/i.test(file.name)))f.ref='unwin';
      files.push(f);
      if(!--pending){ say(''); inputChanged() }
    }).catch(function(err){ say(F('fFail',file.name,err.message)); if(!--pending)inputChanged() })
  }) }
function renderFiles(){
  var h='';
  files.forEach(function(f){
    h+='<li><span class="fname">'+esc(f.name)+'</span><span class="fmeta">'+F('fRows',num(f.rows.length))+
       (f.bad?'; '+F('fBad',num(f.bad)):'')+'</span><span class="fref">'+
       (f.labs?T('fLabels'):'<label>'+T('fRef')+' <select data-fk="'+f.key+'"><option value="none"'+(f.ref=='none'?' selected':'')+'>'+
         T('fRefNone')+'</option><option value="unwin"'+(f.ref=='unwin'?' selected':'')+'>'+T('fRefUnwin')+'</option></select></label>')+
       '</span><button class="x" data-rm="'+f.key+'" aria-label="'+esc(F('fRemove',f.name))+'" title="'+esc(F('fRemove',f.name))+'">×</button></li>' });
  if(files.length>1)h+='<li class="clr"><button class="link" id="cha-clrall">'+T('fClear')+'</button></li>';
  $('flist').innerHTML=h }
function allRows(){ var r=pastedRows(); files.forEach(function(f){ r=r.concat(f.rows) }); return r }
function whoChoice(){ var v=ROOT.querySelector('input[name=who]:checked').value; return v==='white'?B.WHITE:v==='black'?B.BLACK:'auto' }
/* the rows to analyze: range first, then labelled rows doubled when both sides are asked for */
function buildQueries(rows){
  var a=+$('rowA').value|0, b=+$('rowB').value|0, n=rows.length, both=$('both').checked&&!$('bothrow').classList.contains('hide'), who=whoChoice(), Q=[], i, r, ref;
  if(a<1)a=1; if(b<1||b>n)b=n;
  for(i=a-1;i<b;i++){ r=rows[i];
    ref=r.label?'label':(r.file&&r.file.ref==='unwin'?'unwin':null);
    if(r.label&&both){
      Q.push({set:r.set,id:r.id+'/w',fen:r.fen,label:r.label,w:B.WHITE,ref:ref});
      Q.push({set:r.set,id:r.id+'/b',fen:r.fen,label:r.label,w:B.BLACK,ref:ref}) }
    else Q.push({set:r.set,id:r.id,fen:r.fen,label:r.label,w:r.w!==null?r.w:who,ref:ref}) }
  return Q }

/* ================= the solver: a background worker, or the page itself ================= */
var worker=null, workerOK=true, workerReady=false, readyWaiters=[], onResult=null, onEnd=null;
function startWorker(){
  workerReady=false;
  try{
    var url=URL.createObjectURL(new Blob([$('engine').textContent+'\n'+$('glue').textContent],{type:'text/javascript'}));
    worker=new Worker(url);
    worker.onmessage=function(e){ var d=e.data;
      if(d.pong){ workerReady=true; flushReady(true) }
      else if(d.end!==undefined){ if(onEnd)onEnd(d.end) }
      else if(onResult)onResult(d) };
    worker.onerror=function(e){ if(e.preventDefault)e.preventDefault();
      /* a worker that cannot load or crashes outside an analysis: fall back to the page */
      if(worker)worker.terminate(); worker=null; workerOK=false; flushReady(false);
      if(busy&&onEnd)onEnd('restart') };
    worker.postMessage({ping:1});
  }catch(x){ worker=null; workerOK=false }
}
function flushReady(ok){ var w=readyWaiters; readyWaiters=[]; w.forEach(function(f){f(ok)}) }
function whenReady(cb){
  if(!worker){ cb(false); return }
  if(workerReady){ cb(true); return }
  readyWaiters.push(cb);
  setTimeout(function(){ if(!workerReady&&readyWaiters.length){ if(worker)worker.terminate(); worker=null; workerOK=false; flushReady(false) } },4000) }

/* ================= a run ================= */
var runs=null, busy=false, cancel=false, cur=0, ply=0, flipped=false, tick=0, next=0, chunkSeq=0, useWorker=false;
var CHUNK=64;
function go(){
  if(busy){ cancel=true; if(worker){worker.terminate();worker=null} finish(); startWorker(); return }
  var Q=buildQueries(allRows()); if(!Q.length)return;
  runs={Q:Q,R:new Array(Q.length),fast:$('fast').checked,done:0,t0:performance.now(),t1:0,stopped:false,
        cnt:{},agree:0,disagree:0,sets:{},setOrder:[],anyRef:false,ms:0};
  VERDICTS.forEach(function(v){runs.cnt[v]=0});
  Q.forEach(function(q){ if(!runs.sets[q.set]){runs.sets[q.set]=newSet();runs.setOrder.push(q.set)} runs.sets[q.set].n++; if(q.ref)runs.anyRef=true });
  cur=0; ply=0; flipped=false; next=0; page=0; filt='all'; detailKey='';
  busy=true; cancel=false; lockUI(true); render();
  whenReady(function(ok){ useWorker=ok; pump() });
}
function newSet(){ var s={n:0,done:0,agree:0,disagree:0,ms:0}; VERDICTS.forEach(function(v){s[v]=0}); return s }
function pump(){
  if(cancel||!busy)return;
  if(next>=runs.Q.length){ finish(); return }
  var end=Math.min(runs.Q.length,next+(next===0?1:CHUNK)), items=[], k;
  for(k=next;k<end;k++)items.push({k:k,fen:runs.Q[k].fen,w:runs.Q[k].w});
  next=end;
  if(useWorker&&worker){
    var id=++chunkSeq;
    onResult=accept;
    onEnd=function(e){ if(e===id)pump(); else if(e==='restart'){ useWorker=false; next=items[0].k; pump() } };
    worker.postMessage({id:id,items:items,fast:runs.fast});
  } else {
    /* on the page: work for ~40 ms, then let it paint */
    var j=0;
    (function slice(){
      if(cancel)return;
      var until=performance.now()+40;
      while(j<items.length&&performance.now()<until)accept(chaSolve(items[j++],runs.fast));
      if(j<items.length)setTimeout(slice,0); else setTimeout(pump,0) })();
  }
}
function accept(r){
  if(!runs||runs.R[r.k])return;
  var q=runs.Q[r.k], s=runs.sets[q.set];
  runs.R[r.k]=r; runs.done++; runs.cnt[r.v]++; s.done++; s[r.v]++; s.ms+=r.ms; runs.ms+=r.ms;
  var a=agreeOf(q,r); if(a==='ok'){runs.agree++;s.agree++} else if(a==='no'){runs.disagree++;s.disagree++}
  if(runs.done===runs.Q.length)runs.t1=performance.now();
  schedule() }
function finish(){
  if(!runs)return;
  runs.stopped=runs.done<runs.Q.length; if(!runs.t1)runs.t1=performance.now();
  busy=false; onResult=null; onEnd=null; lockUI(false); render() }
var dirty=false;
function schedule(){ if(dirty)return; dirty=true; setTimeout(function(){ dirty=false; render() },200) }

/* ================= reference ================= */
function expectOf(q,win){
  if(q.label)return q.label.charAt(win===B.WHITE?0:1)==='-'?'unwinnable':'winnable';
  if(q.ref==='unwin')return 'unwinnable';
  return null }
/* 'ok' / 'no' when the solver decided, 'open' when it did not, '' without a reference */
function agreeOf(q,r){
  if(!r||r.v==='bad'||r.v==='error')return '';
  var e=expectOf(q,r.win); if(!e)return '';
  if(r.v==='winnable'||r.v==='unwinnable')return r.v===e?'ok':'no';
  return 'open' }

/* ================= UI state ================= */
function lockUI(on){
  ['fen','fast','rowA','rowB','both'].forEach(function(id){$(id).disabled=on});
  Array.prototype.forEach.call(ROOT.querySelectorAll('input[name=who],[data-ex],#cha-flist select,#cha-flist button'),function(x){x.disabled=on});
  $('drop').classList.toggle('off',on);
  $('go').classList.toggle('stop',on);
  clearInterval(tick); if(on)tick=setInterval(status,500);
  refreshGo(); status() }
function refreshGo(){
  var g=$('go');
  if(busy){ g.textContent=T('goStop'); g.disabled=false; $('split').textContent=''; return }
  var p=pastedRows(), rows=p.concat.apply(p,files.map(function(f){return f.rows})), anyLab=false, i;
  for(i=0;i<rows.length;i++)if(rows[i].label){anyLab=true;break}
  $('bothrow').classList.toggle('hide',!anyLab);
  var a=+$('rowA').value|0, b=+$('rowB').value|0, both=$('both').checked&&anyLab, n=0, np=0, m;
  if(a<1)a=1; if(b<1||b>rows.length)b=rows.length;
  for(i=a-1;i<b;i++){ m=both&&rows[i].label?2:1; n+=m; if(rows[i].set==='')np+=m }
  g.textContent=n>1?F('goN',num(n)):n?T('go1'):T('go0'); g.disabled=!n;
  $('split').textContent=np&&np<n?F('goSplit',num(np),num(n-np)):'' }
function say(s){ $('stat').textContent=s }
function status(){
  var s='';
  if(runs){
    var n=runs.Q.length, el=((runs.t1||performance.now())-runs.t0)/1000, rate=runs.done/Math.max(el,.001);
    if(busy) s=n>1?F('runningN',num(runs.done),num(n),num(rate<10?rate.toFixed(1):Math.round(rate)),num(Math.round((n-runs.done)/Math.max(rate,.01)))):F('running',el.toFixed(1));
    else s=runs.stopped?F('stopped',num(runs.done),num(n)):
           n>1?F('doneN',num(runs.done),dur(el*1000),num(rate<10?rate.toFixed(1):Math.round(rate))):F('done1',dur(runs.ms));
    $('bar').classList.toggle('hide',!(busy&&n>1));
    $('barf').style.width=(100*runs.done/n)+'%';
  }
  if(!workerOK)s=(s?s+' ':'')+T('noWorker');
  say(s) }

/* ================= the mating line ================= */
function replay(q,r){
  var b=B.boardFromFen(q.fen); if(!b)return null;
  var boards=[b], sans=[], moves=[], line=(r&&r.v==='winnable'&&r.h)?r.h.split(' '):[], k, j, L, m;
  for(k=0;k<line.length;k++){
    L=B.legalMoves(b); m=-1;
    for(j=0;j<L.length;j++) if(B.moveToUci(L[j])===line[k]){m=L[j];break}
    if(m<0)break;
    sans.push(san(b,m,L)); b=B.makeMove(b,m); boards.push(b); moves.push(m) }
  return{boards:boards,sans:sans,moves:moves,uci:line} }
function sqName(s){return 'abcdefgh'.charAt(s&7)+((s>>3)+1)}
function san(b,m,L){
  var s=B.moveSource(m), d=B.moveDest(m), p=B.movePromotion(m), pc=b.sq[s], t=B.typeOf(pc), out;
  if(t===B.KING&&Math.abs((s&7)-(d&7))===2) out=(d&7)>(s&7)?'O-O':'O-O-O';
  else{
    var cap=b.sq[d]!==0||(t===B.PAWN&&(s&7)!==(d&7));
    if(t===B.PAWN) out=(cap?'abcdefgh'.charAt(s&7)+'x':'')+sqName(d)+(p?'='+'NBRQ'.charAt(p-1):'');
    else{
      var others=L.filter(function(x){return x!==m&&B.moveDest(x)===d&&b.sq[B.moveSource(x)]===pc}), dis='';
      if(others.length){
        var sf=others.some(function(x){return (B.moveSource(x)&7)===(s&7)}), sr=others.some(function(x){return (B.moveSource(x)>>3)===(s>>3)});
        dis=!sf?'abcdefgh'.charAt(s&7):!sr?String((s>>3)+1):sqName(s) }
      out='NBRQK'.charAt(t-1)+dis+(cap?'x':'')+sqName(d) }
  }
  var nb=B.makeMove(b,m);
  if(nb.nCheckers) out+=B.legalMoves(nb).length?'+':'#';
  return out }

/* ================= drawing ================= */
var GLYPH=['\u265F','\u265E','\u265D','\u265C','\u265B','\u265A'];
function boardHTML(b,last,fen){
  var h='', ck=b.nCheckers?b.ksq[b.stm]:-1, r, f, s, p, cls;
  for(var row=0;row<8;row++)for(var col=0;col<8;col++){
    r=flipped?row:7-row; f=flipped?7-col:col; s=r*8+f; p=b.sq[s]; cls=((r+f)&1)?'l':'d';
    if(p)cls+=B.colorOf(p)===B.WHITE?' w':' b';
    if(last&&(s===B.moveSource(last)||s===B.moveDest(last)))cls+=' mv';
    if(s===ck)cls+=' ck';
    h+='<i class="'+cls+'">'+(p?GLYPH[B.typeOf(p)]+'\uFE0E':'')+
      (col===0?'<s class="rk">'+(r+1)+'</s>':'')+(row===7?'<s class="fl">'+'abcdefgh'.charAt(f)+'</s>':'')+'</i>' }
  return '<div class="bd big" role="img" aria-label="'+esc(fen)+'">'+h+'</div>' }

function render(){
  if(!runs){ $('out').classList.add('hide'); $('batch').classList.add('hide'); status(); return }
  renderDetail(false); renderBatch(); status() }

var RP=null, RPkey='', detailKey='';
function renderDetail(force){
  var q=runs.Q[cur], r=runs.R[cur]||null, out=$('out');
  var key=[cur,r?r.v:'',ply,flipped,lang,runs.fast].join('|');
  if(!force&&key===detailKey)return;
  detailKey=key; out.classList.remove('hide');
  var rk=cur+':'+(r?r.v+r.ms:'');
  if(RPkey!==rk){ RP=replay(q,r); RPkey=rk }
  var v=r?r.v:'pending';
  if(!RP){ out.innerHTML='<div class="detail"><div></div><div>'+verdictHTML('bad',null,null,r)+fenBlock(q,null,true)+'</div></div>'; return }
  var stm=RP.boards[0].stm, win=r&&r.win!==undefined?r.win:(q.w==='auto'?1-stm:q.w);
  var n=RP.sans.length; if(ply>n)ply=n;
  var b=RP.boards[ply], last=ply?RP.moves[ply-1]:0;
  var h='<div class="detail"><div class="dboard">'+boardHTML(b,last,q.fen)+
    '<div class="ctrl">'+
      ctrlBtn('first','«',ply===0)+ctrlBtn('prev','‹',ply===0)+ctrlBtn('next','›',ply>=n)+ctrlBtn('last','»',ply>=n)+
      '<button class="txt" data-c="flip">'+T('flip')+'</button>'+
      (n?'<span class="pos">'+(ply?F('plyOf',ply,n):T('startPos'))+'</span>':'')+
    '</div></div><div>'+verdictHTML(v,win,1-win,r);
  if(n){
    /* one unbreakable group per full move: number, White's move, Black's move */
    h+='<h3>'+T('hLine')+'</h3><div class="moves">';
    var num1=1, k, mover;
    for(k=0;k<n;k++){
      mover=(stm+k)&1;
      if(mover===B.WHITE||k===0)h+='<span class="mp"><span class="n">'+num1+(mover===B.WHITE?'.':'…')+'</span>';
      h+='<button data-ply="'+(k+1)+'"'+(ply===k+1?' class="on"':'')+'>'+esc(RP.sans[k])+'</button>';
      if(mover===B.BLACK||k===n-1){ h+='</span> '; if(mover===B.BLACK)num1++ } }
    h+='</div>' }
  var e=expectOf(q,win), a=agreeOf(q,r);
  h+='<dl class="kv" style="margin-top:22px">'+
     '<dt>'+T('kWinner')+'</dt><dd>'+side(win)+'</dd>'+
     '<dt>'+T('kToMove')+'</dt><dd>'+side(stm)+'</dd>'+
     '<dt>'+T('kMode')+'</dt><dd>'+(runs.fast?T('mFast'):T('mFull'))+'</dd>'+
     (r?'<dt>'+T('kTime')+'</dt><dd>'+dur(r.ms)+'</dd>':'')+
     (e?'<dt>'+T('kRef')+'</dt><dd>'+(q.label?F('refLabel','<code>'+esc(q.label)+'</code>'):T('refFile'))+
        (a?'; <span class="'+(a==='ok'?'agree':a==='no'?'disagree':'')+'">'+F('r_'+a,esc(T('v_'+e)))+'</span>':'')+'</dd>':'')+
     (runs.setOrder.length>1||q.set!==''?'<dt>'+T('kSource')+'</dt><dd>'+esc(setName(q.set))+', '+T('thId')+' '+esc(q.id)+'</dd>':'')+
     '</dl>'+fenBlock(q,n?RP.uci:null,false)+'</div></div>';
  out.innerHTML=h }
function ctrlBtn(c,glyph,dis){ return '<button data-c="'+c+'" aria-label="'+esc(T(c))+'" title="'+esc(T(c))+'"'+(dis?' disabled':'')+'>'+glyph+'</button>' }
function verdictHTML(v,win,other,r){
  var txt;
  if(v==='error') txt=r.msg==='stack'?T('t_stack'):F('t_error',esc(r.msg));
  else txt=F('t_'+v,win===null?'':side(win),win===null?'':side(other));
  return '<span class="verdict v-'+v+'">'+esc(T('v_'+v))+'</span><p class="vtext">'+txt+'</p>' }
function fenBlock(q,line,bad){
  return '<p class="fenbox">'+esc(q.fen)+'</p><div class="acts">'+
    '<button class="ghost" data-copy="'+esc(q.fen)+'">'+T('copyFen')+'</button>'+
    (line?'<button class="ghost" data-copy="'+esc(line.join(' '))+'">'+T('copyUci')+'</button>':'')+
    (bad?'':'<a class="btn" target="_blank" rel="noopener" href="https://lichess.org/analysis/standard/'+esc(q.fen.replace(/ /g,'_'))+'">'+T('lichess')+'</a>')+
    '</div>' }

/* ================= all positions: summary, sets, filter, pages ================= */
var page=0, filt='all', PER=100;
var SW={winnable:'var(--win)',unwinnable:'var(--draw)',undetermined:'var(--hatch)',unproven:'var(--hatch)',bad:'#3a404b',error:'#3a404b'};
function matches(k){
  var r=runs.R[k];
  if(filt==='all')return true;
  if(filt==='pending')return !r;
  if(!r)return false;
  if(filt==='agree'||filt==='disagree'){ var a=agreeOf(runs.Q[k],r); return filt==='agree'?a==='ok':a==='no' }
  return r.v===filt }
function renderBatch(){
  var Q=runs.Q, n=Q.length;
  if(n<2){ $('batch').classList.add('hide'); return }
  $('batch').classList.remove('hide');
  var c=runs.cnt, h='';
  VERDICTS.forEach(function(v){ if(c[v])h+='<span><i class="sw" style="background:'+SW[v]+'"></i><b>'+num(c[v])+'</b> '+esc(T('v_'+v))+'</span>' });
  if(runs.anyRef){
    if(runs.agree)h+='<span class="agree"><b>'+num(runs.agree)+'</b> '+T('s_agree')+'</span>';
    if(runs.disagree)h+='<span class="disagree"><b>'+num(runs.disagree)+'</b> '+T('s_disagree')+'</span>' }
  $('sum').innerHTML=h;
  renderSets();
  /* filter: only the choices that have something in them, plus the current one */
  var opts=[['all',T('f_all'),n]];
  VERDICTS.forEach(function(v){ opts.push([v,T('v_'+v),c[v]]) });
  opts.push(['pending',T('v_pending'),n-runs.done]);
  if(runs.anyRef){ opts.push(['disagree',T('f_disagree'),runs.disagree]); opts.push(['agree',T('f_agree'),runs.agree]) }
  $('filt').innerHTML=opts.filter(function(o){return o[2]||o[0]===filt}).map(function(o){
    return '<option value="'+o[0]+'"'+(o[0]===filt?' selected':'')+'>'+esc(o[1])+' ('+num(o[2])+')</option>' }).join('');
  var list=[], k;
  for(k=0;k<n;k++)if(matches(k))list.push(k);
  var pages=Math.max(1,Math.ceil(list.length/PER)); if(page>=pages)page=pages-1;
  var multi=runs.setOrder.length>1, ids=Q.some(function(q){return q.set!==''});
  h='<thead><tr><th class="num">'+T('thN')+'</th>'+(multi?'<th>'+T('thSet')+'</th>':'')+(ids?'<th>'+T('thId')+'</th>':'')+
    '<th>'+T('thVerdict')+'</th><th>'+T('thSide')+'</th><th class="num">'+T('thPly')+'</th><th class="num">'+T('thMs')+'</th>'+
    (runs.anyRef?'<th>'+T('thRef')+'</th>':'')+'<th>'+T('thFen')+'</th></tr></thead><tbody>';
  list.slice(page*PER,(page+1)*PER).forEach(function(k){
    var q=Q[k], r=runs.R[k], v=r?r.v:'pending', e=r?expectOf(q,r.win):null, a=agreeOf(q,r);
    h+='<tr data-k="'+k+'"'+(k===cur?' class="act"':'')+' tabindex="0"><td class="num">'+(k+1)+'</td>'+
       (multi?'<td>'+esc(setName(q.set))+'</td>':'')+(ids?'<td>'+esc(q.id)+'</td>':'')+
       '<td><span class="tag v-'+v+'">'+esc(T('v_'+v))+'</span></td>'+
       '<td>'+(r&&r.win!==undefined?side(r.win):'')+'</td>'+
       '<td class="num">'+(r&&r.v==='winnable'&&r.h?r.h.split(' ').length:'')+'</td>'+
       '<td class="num">'+(r&&r.v!=='bad'?(r.ms<10?r.ms.toFixed(1):Math.round(r.ms)):'')+'</td>'+
       (runs.anyRef?'<td>'+(e?'<span class="'+(a==='ok'?'agree':a==='no'?'disagree':'')+'">'+(q.label?esc(q.label)+' ':'')+(a==='no'?'≠ ':a==='ok'?'= ':'')+esc(T('v_'+e))+'</span>':q.label?esc(q.label):'')+'</td>':'')+
       '<td class="fen">'+esc(q.fen)+'</td></tr>' });
  $('tab').innerHTML=h+'</tbody>'+(list.length?'':'<caption>'+T('none')+'</caption>');
  $('pg').innerHTML=pages>1
    ?'<button class="ghost" data-pg="-1"'+(page?'':' disabled')+'>'+T('pgPrev')+'</button><span>'+F('pgOf',num(page+1),num(pages),num(list.length))+
     '</span><button class="ghost" data-pg="1"'+(page<pages-1?'':' disabled')+'>'+T('pgNext')+'</button>'
    :(list.length?'<span>'+F('pgOf',1,1,num(list.length))+'</span>':'') }
function renderSets(){
  if(runs.setOrder.length<2){ $('persetbox').classList.add('hide'); return }
  $('persetbox').classList.remove('hide');
  var cols=['n','done','winnable','unwinnable','open','bad'].concat(runs.anyRef?['agree','disagree']:[],['ms']),
      L={n:'thRows',done:'thDone',winnable:'v_winnable',unwinnable:'v_unwinnable',open:'thOpen',bad:'thBad',agree:'s_agree',disagree:'s_disagree',ms:'thTime'},
      tot={}, h='<tr><th>'+T('thSet')+'</th>'+cols.map(function(c){return '<th class="num">'+esc(T(L[c]))+'</th>'}).join('')+'</tr>';
  cols.forEach(function(c){tot[c]=0});
  var cell=function(s,c){ return c==='open'?s.undetermined+s.unproven:c==='bad'?s.bad+s.error:s[c] };
  runs.setOrder.forEach(function(name){ var s=runs.sets[name];
    h+='<tr><td>'+esc(setName(name))+'</td>'+cols.map(function(c){ var v=cell(s,c); tot[c]+=v;
      return '<td class="num'+(c==='disagree'&&v?' disagree':'')+'">'+(c==='ms'?dur(v):num(v))+'</td>' }).join('')+'</tr>' });
  h+='<tr class="tot"><td>'+T('thTot')+'</td>'+cols.map(function(c){ return '<td class="num">'+(c==='ms'?dur(tot[c]):num(tot[c]))+'</td>' }).join('')+'</tr>';
  $('perset').innerHTML=h }

/* ================= downloads ================= */
function download(name,text,type){
  var url=URL.createObjectURL(new Blob([text],{type:type})), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url)},2000) }
function sideWord(w){ return w===B.WHITE?'white':'black' }
/* the analyzer's own lines; in fast mode, like --fast, only the positions proven unwinnable */
$('dlTxt').onclick=function(){
  if(!runs)return; var o=[];
  runs.Q.forEach(function(q,k){ var r=runs.R[k]; if(!r||r.win===undefined)return;
    var tail=q.fen+' '+sideWord(r.win);
    if(r.v==='winnable')o.push('winnable moves '+r.h.split(' ').join(',')+' '+tail);
    else if(r.v==='unwinnable'||r.v==='undetermined')o.push(r.v+' '+tail) });
  download('chasolver-results.txt',o.join('\n')+'\n','text/plain') };
function csvf(s){ s=String(s==null?'':s); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s }
$('dlCsv').onclick=function(){
  if(!runs)return; var o=['set,id,label,side,verdict,expected,agree,ply,ms,fen,moves'];
  runs.Q.forEach(function(q,k){ var r=runs.R[k]; if(!r)return;
    var e=r.win!==undefined?expectOf(q,r.win):null, a=agreeOf(q,r);
    o.push([setName(q.set),q.id,q.label||'',r.win===undefined?'':sideWord(r.win),r.v,e||'',a==='ok'?'yes':a==='no'?'no':a,
            r.v==='winnable'&&r.h?r.h.split(' ').length:'',r.ms.toFixed(2),q.fen,r.v==='winnable'?r.h:''].map(csvf).join(',')) });
  download('chasolver-results.csv',o.join('\n')+'\n','text/csv') };

/* ================= events ================= */
ROOT.addEventListener('click',function(e){
  var t=e.target; if(!t||!t.closest)return;
  var c=t.closest('[data-c]'), p=t.closest('[data-ply]'), cp=t.closest('[data-copy]'), row=t.closest('tr[data-k]'),
      ex=t.closest('[data-ex]'), pg=t.closest('[data-pg]'), rm=t.closest('[data-rm]');
  if(c&&!c.disabled){ step(c.getAttribute('data-c')); return }
  if(p){ ply=+p.getAttribute('data-ply'); renderDetail(); return }
  if(cp){ copy(cp.getAttribute('data-copy'),cp); return }
  if(row){ pick(+row.getAttribute('data-k')); return }
  if(pg&&!pg.disabled){ page+=+pg.getAttribute('data-pg'); renderBatch(); return }
  if(rm&&!busy){ files=files.filter(function(f){return f.key!=rm.getAttribute('data-rm')}); inputChanged(); return }
  if(t.id==='cha-clrall'&&!busy){ files=[]; inputChanged(); return }
  if(ex&&!busy){ $('fen').value=EXAMPLES[+ex.getAttribute('data-ex')]; refreshGo(); $('fen').focus() }
});
$('flist').addEventListener('change',function(e){
  var k=e.target.getAttribute&&e.target.getAttribute('data-fk'); if(!k)return;
  files.forEach(function(f){ if(f.key==k)f.ref=e.target.value }); refreshGo() });
$('filt').onchange=function(){ filt=this.value; page=0; renderBatch() };
$('tab').addEventListener('keydown',function(e){
  var row=e.target.closest&&e.target.closest('tr[data-k]'); if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pick(+row.getAttribute('data-k'))} });
function pick(k){ cur=k; ply=0; flipped=false; renderDetail(true); renderBatch(); $('out').scrollIntoView({behavior:'smooth',block:'start'}) }
function step(c){
  if(!RP)return; var n=RP.sans.length;
  if(c==='first')ply=0; else if(c==='prev')ply=Math.max(0,ply-1); else if(c==='next')ply=Math.min(n,ply+1);
  else if(c==='last')ply=n; else if(c==='flip')flipped=!flipped;
  renderDetail();
  var f=ROOT.querySelector('#cha-out [data-c="'+c+'"]'); if(f&&!f.disabled)f.focus() }
document.addEventListener('keydown',function(e){
  var tg=e.target.tagName; if(MatelessSite.active()!=='chasolver'||tg==='TEXTAREA'||tg==='INPUT'||tg==='SELECT'||!runs||$('out').classList.contains('hide'))return;
  if(e.key==='ArrowLeft'){e.preventDefault();step('prev')} else if(e.key==='ArrowRight'){e.preventDefault();step('next')}
  else if(e.key==='Home'){e.preventDefault();step('first')} else if(e.key==='End'){e.preventDefault();step('last')} });
function copy(text,btn){
  var done=function(){ var o=btn.textContent; btn.textContent=T('copied'); setTimeout(function(){btn.textContent=o},1200) };
  var fallback=function(){ var a=document.createElement('textarea'); a.value=text; document.body.appendChild(a); a.select();
    try{document.execCommand('copy')}catch(x){} document.body.removeChild(a); done() };
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(done,fallback); else fallback() }
var dropEl=$('drop'), fileEl=$('file');
dropEl.onclick=function(){ if(!busy)fileEl.click() };
dropEl.onkeydown=function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault(); if(!busy)fileEl.click()} };
fileEl.onchange=function(){ if(fileEl.files.length)addFiles(fileEl.files); fileEl.value='' };
dropEl.ondragover=function(e){ e.preventDefault(); if(!busy)dropEl.classList.add('over') };
dropEl.ondragleave=function(){ dropEl.classList.remove('over') };
dropEl.ondrop=function(e){ e.preventDefault(); dropEl.classList.remove('over'); if(!busy&&e.dataTransfer.files.length)addFiles(e.dataTransfer.files) };
function inputChanged(){ renderFiles(); refreshGo() }
$('go').onclick=go;
$('fen').addEventListener('input',function(){ clearTimeout(this._t); this._t=setTimeout(refreshGo,150) });
$('fen').addEventListener('keydown',function(e){ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault(); if(!$('go').disabled)go()} });
['rowA','rowB','both'].forEach(function(id){ $(id).addEventListener('input',refreshGo); $(id).addEventListener('change',refreshGo) });
Array.prototype.forEach.call(ROOT.querySelectorAll('input[name=who]'),function(x){ x.addEventListener('change',refreshGo) });
function applyI18n(){
  Array.prototype.forEach.call(ROOT.querySelectorAll('[data-i]'),function(el){
    var k=el.getAttribute('data-i'); if(el.hasAttribute('data-ihtml'))el.innerHTML=T(k); else el.textContent=T(k) });
  renderFiles(); refreshGo(); if(runs){ detailKey=''; render() } else status() }
/* the language is the site's (English unless the reader chose Turkish) */
lang=MatelessSite.lang; MatelessSite.onLang(function(l){ lang=l; applyI18n() });
startWorker(); applyI18n();
/* a position handed over by the arbiter's "Ask chasolver" link: #chasolver?fen=<FEN>&side=white|black
   (the side whose mate is asked about) */
MatelessSite.onRoute('chasolver',function(p){
  if(!p.fen)return;
  $('fen').value=p.fen.trim()+(p.side==='white'||p.side==='black'?' '+p.side:'');
  refreshGo(); go() });
})();
