/* one analysis, as the analyzer runs it; shared by the background worker and the page */
function chaSolve(it,fast){
  var r={k:it.k},t0=performance.now();
  try{
    var b=CHA.B.boardFromFen(it.fen);
    if(!b)r.v='bad';
    else{
      var w=it.w==='auto'?1-b.stm:it.w; r.stm=b.stm; r.win=w;
      if(fast)r.v=CHA.W.isUnwinnableFast(b,w)?'unwinnable':'unproven';
      else{ var x=CHA.W.winnability(b,w); r.v=x.result; if(x.helpmate)r.h=x.helpmate.join(' ') }
    }
  }catch(e){ r.v='error'; r.msg=e&&e.name==='RangeError'?'stack':String(e&&e.message||e) }
  r.ms=performance.now()-t0; return r
}
if(typeof window==='undefined')self.onmessage=function(e){
  var d=e.data; if(d.ping){ self.postMessage({pong:1}); return }
  for(var j=0;j<d.items.length;j++)self.postMessage(chaSolve(d.items[j],d.fast));
  self.postMessage({end:d.id})
};
