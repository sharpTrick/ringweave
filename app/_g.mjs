import { buildBuddyGraph } from "/home/user/ringweave/lib/dist/core/index.js";
for (const [n,k] of [[1000,12],[2000,12]]) {
  const t=performance.now();
  const r=buildBuddyGraph(n,k,{seed:1});
  console.log(`n=${n} k=${k} -> ${(performance.now()-t).toFixed(0)}ms, edges=${r.edges.length}`);
}
