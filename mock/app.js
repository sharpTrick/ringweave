// BuddyGraph interactive prototype.
// Stand-in generator (a simplified cousin of the real ring-greedy core) +
// hand-rolled force layout. NOT wired to the production core yet — the graph is
// representative, the interactions are the point.
'use strict';

const SAMPLE = [
  "Alice Nguyen","Ben Carter","Chloe Diaz","Dev Patel","Elena Rossi","Farah Khan",
  "Grace Lee","Hugo Martin","Iris Okafor","Jae Sung","Kira Volkov","Liam Walsh",
  "Maya Cohen","Noah Bright","Ola Adeyemi","Priya Rao","Quinn Foster","Rosa Mendez",
  "Sam Ito","Tara Singh","Uma Devi","Victor Hale","Wren Ellis","Xander Poe"
];

// ---------- tiny graph core (stand-in) ----------
function mulberry32(seed){let t=seed>>>0;return()=>{t=(t+0x6D2B79F5)|0;let r=Math.imul(t^(t>>>15),1|t);r^=r+Math.imul(r^(r>>>7),61|r);return((r^(r>>>14))>>>0)/4294967296;};}

function bfs(adj,s){const n=adj.length,d=new Array(n).fill(-1);d[s]=0;const q=[s];let h=0;
  while(h<q.length){const u=q[h++];for(const w of adj[u])if(d[w]<0){d[w]=d[u]+1;q.push(w);}}return d;}

// ring + greedy farthest-low-degree chords (a faithful flavor of ring-greedy)
function generate(names,k,seed){
  const n=names.length;
  const adj=Array.from({length:n},()=>new Set());
  const add=(a,b)=>{if(a!==b&&!adj[a].has(b)){adj[a].add(b);adj[b].add(a);}};
  for(let i=0;i<n;i++)add(i,(i+1)%n);            // ring
  const rand=mulberry32(seed);
  let mind=Math.min(5,Math.floor(n/2));
  const edgeOrder=[];                             // for replay
  for(const[a,b]of ringEdges(n))edgeOrder.push([a,b]);
  // greedy: connect lowest-degree, farthest pairs
  let guard=0;
  while(guard++<n*k*4){
    // pick lowest-degree vertex (ties: earliest), needing degree
    let va=-1,best=1e9;
    for(let i=0;i<n;i++){if(adj[i].size<k&&adj[i].size<best){best=adj[i].size;va=i;}}
    if(va<0)break;
    const d=bfs(adj,va);
    let ecc=0;for(let t=0;t<n;t++)if(d[t]>ecc)ecc=d[t];
    // candidate farthest under-degree partners at dist>=mind
    let cand=[];for(let vb=0;vb<n;vb++){if(vb!==va&&adj[vb].size<k&&!adj[va].has(vb)&&d[vb]>=Math.min(mind,ecc))cand.push(vb);}
    if(!cand.length){if(mind>2){mind--;continue;}else break;}
    // prefer farthest, then lowest partner degree, jitter ties by seed
    cand.sort((x,y)=> d[y]-d[x] || adj[x].size-adj[y].size || (rand()-.5));
    add(va,cand[0]);edgeOrder.push([va,cand[0]]);
  }
  return{n,adj,names,k,edgeOrder};
}
function* ringEdges(n){for(let i=0;i<n;i++)yield[i,(i+1)%n];}

function metrics(g){
  const n=g.n;let total=0,pairs=0,diam=0;
  for(let s=0;s<n;s++){const d=bfs(g.adj,s);for(let t=s+1;t<n;t++){if(d[t]>0){total+=d[t];pairs++;if(d[t]>diam)diam=d[t];}}}
  const aspl=pairs?total/pairs:0;
  // Moore lower bound for gap→quality
  let rem=n-1,tot=0,shell=g.k,dist=1;
  while(rem>0&&g.k>1){const take=Math.min(shell,rem);tot+=dist*take;rem-=take;dist++;shell*= (g.k-1);if(shell<=0)break;}
  const lb=tot/(n-1);const gap=lb>0?(aspl-lb)/lb:0;
  const quality=Math.max(0,Math.min(1,1-gap));
  return{aspl,diam,quality};
}

// ---------- state ----------
let G=null, positions=[], layout='ring', selected=null, hovered=null;
let view={x:0,y:0,scale:1};
let W=0,H=0,cx=0,cy=0,R=0;
const svg=document.getElementById('svg');
const NS='http://www.w3.org/2000/svg';

function size(){const r=svg.getBoundingClientRect();W=r.width;H=r.height;cx=W/2;cy=H/2-8;R=Math.min(W,H)*0.34;}

// ---------- layouts ----------
function ringPositions(){size();return G.names.map((_,i)=>{const a=-Math.PI/2+2*Math.PI*i/G.n;return{x:cx+R*Math.cos(a),y:cy+R*Math.sin(a)};});}
function forcePositions(){
  size();
  // start from ring, relax with spring+repulsion
  let p=ringPositions().map(q=>({x:q.x+(Math.random()-.5)*20,y:q.y+(Math.random()-.5)*20,vx:0,vy:0}));
  const edges=[];for(let u=0;u<G.n;u++)for(const v of G.adj[u])if(u<v)edges.push([u,v]);
  const K=R*0.9, rep=R*R*3.4;
  for(let it=0;it<320;it++){
    for(let i=0;i<G.n;i++){p[i].vx*=.85;p[i].vy*=.85;}
    for(let i=0;i<G.n;i++)for(let j=i+1;j<G.n;j++){
      let dx=p[i].x-p[j].x,dy=p[i].y-p[j].y,d2=dx*dx+dy*dy+.01,d=Math.sqrt(d2);
      const f=rep/d2;const fx=f*dx/d,fy=f*dy/d;p[i].vx+=fx;p[i].vy+=fy;p[j].vx-=fx;p[j].vy-=fy;}
    for(const[u,v]of edges){let dx=p[v].x-p[u].x,dy=p[v].y-p[u].y,d=Math.hypot(dx,dy)+.01;const f=(d-K)*.02;const fx=f*dx/d,fy=f*dy/d;p[u].vx+=fx;p[u].vy+=fy;p[v].vx-=fx;p[v].vy-=fy;}
    for(let i=0;i<G.n;i++){p[i].vx+=(cx-p[i].x)*.008;p[i].vy+=(cy-p[i].y)*.008;p[i].x+=p[i].vx;p[i].y+=p[i].vy;}
  }
  return p.map(q=>({x:q.x,y:q.y}));
}

// Focus (ego) layout: selected person at center, buddies on an inner ring,
// friends-of-friends on an outer ring. Everyone else parked faintly at the rim.
function focusPositions(){
  size();
  const f=focusId();
  const first=new Set(G.adj[f]);
  const second=new Set();
  for(const b of G.adj[f])for(const c of G.adj[b])if(c!==f&&!first.has(c))second.add(c);
  const pos=new Array(G.n);
  pos[f]={x:cx,y:cy};
  const r1=R*0.52, r2=R*1.02;
  placeRing([...first],r1,pos,f,-Math.PI/2);
  placeRing([...second],r2,pos,f,-Math.PI/2+0.18);
  // anyone unreachable-in-2: tuck at the far bottom rim, evenly
  const rest=[];for(let i=0;i<G.n;i++)if(i!==f&&!first.has(i)&&!second.has(i))rest.push(i);
  placeRing(rest,R*1.32,pos,f,Math.PI/2);
  return pos;
}
function placeRing(ids,radius,pos,center,phase){
  const m=ids.length;ids.forEach((id,k)=>{
    const a=phase+2*Math.PI*k/Math.max(m,1);
    pos[id]={x:cx+radius*Math.cos(a),y:cy+radius*Math.sin(a)};
  });
}
function focusId(){return selected!=null?selected:(hovered!=null?hovered:0);}

function setLayout(l,animate=true){
  layout=l;
  document.querySelectorAll('#toggle button').forEach(b=>{
    const on=b.dataset.layout===l;b.classList.toggle('on',on);
  });
  const target=l==='ring'?ringPositions():l==='force'?forcePositions():focusPositions();
  if(l==='focus'){view={x:0,y:0,scale:1};}  // ego-graph is centered in canvas space
  updateSunburst();
  if(!animate||!positions.length){positions=target;draw();return;}
  const from=positions.map(p=>({...p}));const t0=performance.now(),dur=650;
  const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(reduce){positions=target;draw();return;}
  function tick(now){const k=Math.min(1,(now-t0)/dur);const e=1-Math.pow(1-k,3);
    positions=target.map((tp,i)=>({x:from[i].x+(tp.x-from[i].x)*e,y:from[i].y+(tp.y-from[i].y)*e}));
    draw();if(k<1)requestAnimationFrame(tick);}
  requestAnimationFrame(tick);
}

// sunburst gently follows the focused person and warms when someone's centered
function updateSunburst(){
  const sb=document.getElementById('sunburst');if(!sb)return;
  let px=50,py=46,warm=.10,cool=.05;
  if(layout==='focus'){warm=.16;cool=.07;}
  const f=(selected!=null?selected:hovered);
  if(f!=null&&positions[f]){
    px=(positions[f].x/W)*100;py=(positions[f].y/H)*100;warm=Math.max(warm,.14);
  }
  sb.style.background=`radial-gradient(circle at ${px}% ${py}%,`+
    `rgba(246,178,107,${warm}), rgba(139,211,221,${cool}) 30%, transparent 62%)`;
}

// ---------- draw ----------
function draw(){
  while(svg.firstChild)svg.removeChild(svg.firstChild);
  const gWrap=document.createElementNS(NS,'g');
  gWrap.setAttribute('transform',`translate(${view.x},${view.y}) scale(${view.scale})`);
  svg.appendChild(gWrap);

  const nbr=hovered!=null?G.adj[hovered]:(selected!=null?G.adj[selected]:null);
  const focus=hovered!=null?hovered:selected;
  let second=new Set();
  if(focus!=null){for(const b of G.adj[focus])for(const c of G.adj[b])if(c!==focus&&!G.adj[focus].has(c))second.add(c);}

  // edges
  for(let u=0;u<G.n;u++)for(const v of G.adj[u])if(u<v){
    const e=document.createElementNS(NS,'line');
    e.setAttribute('x1',positions[u].x);e.setAttribute('y1',positions[u].y);
    e.setAttribute('x2',positions[v].x);e.setAttribute('y2',positions[v].y);
    e.setAttribute('class','edge');
    if(focus!=null){
      if(u===focus||v===focus)e.classList.add('lit');
      else if(second.has(u)||second.has(v))e.classList.add('lit2');
      else e.classList.add('dim');
    }
    gWrap.appendChild(e);
  }
  // nodes
  positions.forEach((p,i)=>{
    const g=document.createElementNS(NS,'g');g.setAttribute('class','node');
    g.setAttribute('transform',`translate(${p.x},${p.y})`);
    const hit=document.createElementNS(NS,'circle');hit.setAttribute('r',16);
    hit.setAttribute('fill','transparent');hit.style.pointerEvents='all';
    g.appendChild(hit);
    const c=document.createElementNS(NS,'circle');c.setAttribute('r',7);c.style.pointerEvents='none';
    g.appendChild(c);
    const tx=document.createElementNS(NS,'text');tx.setAttribute('x',10);tx.setAttribute('y',4);
    tx.textContent=G.names[i].split(' ')[0];g.appendChild(tx);
    if(focus!=null){
      if(i===focus)g.classList.add('sel');
      else if(nbr&&nbr.has(i))g.classList.add('hi');
      else if(second.has(i))g.classList.add('hi2');
      else g.classList.add('faded');
    }
    g.addEventListener('mouseenter',()=>{hovered=i;draw();});
    g.addEventListener('mouseleave',()=>{hovered=null;draw();});
    g.addEventListener('click',e=>{e.stopPropagation();select(i);});
    gWrap.appendChild(g);
  });
}

// ---------- panels ----------
function refreshPanels(){
  const m=metrics(G);
  document.getElementById('mAspl').textContent=m.aspl.toFixed(1);
  document.getElementById('mDiam').textContent=m.diam;
  const q=Math.round(m.quality*100);
  document.getElementById('mQual').textContent=q;
  const gauge=document.getElementById('gauge');
  gauge.style.background=`conic-gradient(var(--cool2) 0 ${q}%, var(--line) ${q}% 100%)`;
  document.getElementById('rosterN').textContent=G.n;
  document.getElementById('rosterSub').textContent=`people · ${G.k} buddies each`;
  // buddy list
  const list=document.getElementById('bpList');list.innerHTML='';
  G.names.forEach((nm,i)=>{
    const bs=[...G.adj[i]].map(j=>G.names[j].split(' ')[0]).join(', ');
    const row=document.createElement('div');row.className='brow';
    row.innerHTML=`<div class="nm">${nm}</div><div class="bd">${bs}</div>`;
    row.addEventListener('click',()=>select(i));
    list.appendChild(row);
  });
}

function select(i){
  selected=i;hovered=null;
  if(layout==='focus'){setLayout('focus');}else{draw();}
  updateSunburst();
  const d=document.getElementById('detail');
  document.getElementById('dName').textContent=G.names[i];
  const b1=document.getElementById('dB1');b1.innerHTML='';
  [...G.adj[i]].forEach(j=>{const c=document.createElement('span');c.className='chip b1';c.textContent=G.names[j].split(' ')[0];c.onclick=()=>select(j);b1.appendChild(c);});
  const second=new Set();for(const b of G.adj[i])for(const c of G.adj[b])if(c!==i&&!G.adj[i].has(c))second.add(c);
  const b2=document.getElementById('dB2');b2.innerHTML='';
  [...second].slice(0,10).forEach(j=>{const c=document.createElement('span');c.className='chip b2';c.textContent=G.names[j].split(' ')[0];c.onclick=()=>select(j);b2.appendChild(c);});
  const dist=bfs(G.adj,i);const ecc=Math.max(...dist);
  document.getElementById('dPlain').textContent=`${G.names[i].split(' ')[0]} can reach anyone in the group within ${ecc} steps.`;
  // position popover near node
  const p=positions[i];const px=Math.min(Math.max(p.x*view.scale+view.x,20),W-250);
  const py=Math.min(Math.max(p.y*view.scale+view.y+14,60),H-260);
  d.style.left=px+'px';d.style.top=py+'px';d.classList.add('show');
  const fh=document.getElementById('focusHint');if(fh)fh.style.display='none';
}
document.getElementById('dClose').onclick=()=>{document.getElementById('detail').classList.remove('show');selected=null;draw();};
svg.addEventListener('click',e=>{if(panMoved||e.target.closest('.node'))return;document.getElementById('detail').classList.remove('show');selected=null;draw();});

// ---------- search (fuzzy-ish) ----------
const sInput=document.getElementById('searchInput'),sRes=document.getElementById('results');
function fuzzy(q,s){q=q.toLowerCase();s=s.toLowerCase();let i=0;for(const ch of s){if(ch===q[i])i++;if(i>=q.length)return true;}return q.length===0;}
sInput.addEventListener('input',()=>{
  const q=sInput.value.trim();if(!q){sRes.classList.remove('show');return;}
  const hits=G.names.map((n,i)=>({n,i})).filter(o=>fuzzy(q,o.n)).slice(0,7);
  sRes.innerHTML='';hits.forEach(o=>{const r=document.createElement('div');r.className='r';r.textContent=o.n;r.onclick=()=>{select(o.i);sRes.classList.remove('show');sInput.value='';};sRes.appendChild(r);});
  sRes.classList.toggle('show',hits.length>0);
});

// ---------- zoom ----------
function zoom(f){const nx=cx-(cx-view.x)*f,ny=cy-(cy-view.y)*f;view={x:nx,y:ny,scale:view.scale*f};draw();}
document.getElementById('zin').onclick=()=>zoom(1.2);
document.getElementById('zout').onclick=()=>zoom(1/1.2);
svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.08:1/1.08);},{passive:false});
// drag to pan — only engages after a movement threshold, so node clicks pass through
let pan=null,panMoved=false;
svg.addEventListener('pointerdown',e=>{if(e.target.closest('.node'))return;pan={x:e.clientX,y:e.clientY,ox:view.x,oy:view.y};panMoved=false;});
svg.addEventListener('pointermove',e=>{if(pan){const dx=e.clientX-pan.x,dy=e.clientY-pan.y;if(Math.abs(dx)+Math.abs(dy)>4)panMoved=true;if(panMoved){view.x=pan.ox+dx;view.y=pan.oy+dy;draw();}}});
window.addEventListener('pointerup',()=>pan=null);

// ---------- watch it build (replay) ----------
document.getElementById('watchBtn').onclick=()=>replay();
function replay(){
  if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  setLayout('ring',false);
  const order=G.edgeOrder.slice();let shown=0;
  const saved=G.adj;G.adj=Array.from({length:G.n},()=>new Set()); // empty then rebuild visually
  draw();
  const iv=setInterval(()=>{
    if(shown>=order.length){clearInterval(iv);G.adj=saved;draw();return;}
    const[a,b]=order[shown++];G.adj[a].add(b);G.adj[b].add(a);draw();
  },Math.max(18,600/order.length));
}

// ---------- export ----------
document.getElementById('exportBtn').onclick=()=>{
  const data={version:1,people:G.names.map((n,i)=>({id:i,name:n})),
    settings:{buddies:G.k},edges:[],metrics:metrics(G)};
  for(let u=0;u<G.n;u++)for(const v of G.adj[u])if(u<v)data.edges.push([u,v]);
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='buddygraph.json';a.click();
};
document.getElementById('copyBtn').onclick=()=>{
  const txt=G.names.map((n,i)=>`${n}: ${[...G.adj[i]].map(j=>G.names[j]).join(', ')}`).join('\n');
  navigator.clipboard&&navigator.clipboard.writeText(txt);
  flash('copyBtn','Copied');
};
document.getElementById('csvBtn').onclick=()=>{
  const rows=[['name','buddies']];G.names.forEach((n,i)=>rows.push([n,[...G.adj[i]].map(j=>G.names[j]).join('; ')]));
  const csv=rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='buddies.csv';a.click();
};
function flash(id,txt){const el=document.getElementById(id);const o=el.textContent;el.textContent=txt;setTimeout(()=>el.textContent=o,1100);}

// ---------- toggle + reroll + modal ----------
document.querySelectorAll('#toggle button').forEach(b=>b.onclick=()=>{
  setLayout(b.dataset.layout);
  const fh=document.getElementById('focusHint');
  if(fh)fh.style.display=(b.dataset.layout==='focus'&&selected==null)?'block':'none';
});
let seed=7;
document.getElementById('reroll').onclick=()=>{seed++;const names=G.names.slice();G=generate(names,G.k,seed);G.names=names;positions=[];setLayout(layout,false);refreshPanels();};
document.getElementById('editPeople').onclick=()=>openModal();
document.querySelectorAll('.step').forEach(s=>s.onclick=()=>{if(s.dataset.step!=='results')openModal();});

// modal
let kSel=4;
const modal=document.getElementById('modal');
function openModal(){document.getElementById('names').value=G?G.names.join('\n'):SAMPLE.slice(0,18).join('\n');kSel=G?G.k:4;document.getElementById('kVal').textContent=kSel;modal.classList.remove('hide');checkNote();}
document.getElementById('kMinus').onclick=()=>{kSel=Math.max(2,kSel-1);document.getElementById('kVal').textContent=kSel;checkNote();};
document.getElementById('kPlus').onclick=()=>{kSel=Math.min(8,kSel+1);document.getElementById('kVal').textContent=kSel;checkNote();};
document.getElementById('names').addEventListener('input',checkNote);
function parseNames(){return document.getElementById('names').value.split('\n').map(s=>s.trim()).filter(Boolean);}
function checkNote(){
  const nm=parseNames(),n=nm.length,note=document.getElementById('note');
  if(n<kSel+1){note.textContent=`Add at least ${kSel+1-n} more — you need more people than buddies.`;return;}
  if((n*kSel)%2!==0){note.textContent=`${n} people × ${kSel} buddies is odd, so one person will have one buddy more or fewer. That's fine.`;return;}
  note.textContent='';
}
document.getElementById('generate').onclick=()=>{
  const names=parseNames();if(names.length<kSel+1)return;
  seed=7;G=generate(names,kSel,seed);G.names=names;
  modal.classList.add('hide');selected=null;hovered=null;view={x:0,y:0,scale:1};positions=[];
  setLayout('ring',false);refreshPanels();
};

// ---------- boot ----------
function boot(){
  const names=SAMPLE.slice(0,18);
  G=generate(names,4,7);G.names=names;
  setLayout('ring',false);refreshPanels();
  modal.classList.add('hide'); // start already generated so the value is visible
}
window.addEventListener('resize',()=>{positions=[];setLayout(layout,false);});
boot();
