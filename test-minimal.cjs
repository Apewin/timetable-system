const {CpModel,CpSolver,CpSolverStatus}=require('@ortools-node/cp-sat');
const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++)allSlots.push('D'+d+'P'+p);

// Test with globalTeacher blocking (like real engine)
const tc=[['A',5,'T1'],['B',5,'T2'],['C',4,null],['SS',2,null]];

function sumV(v){let s=v[0];for(let i=1;i<v.length;i++)s=s.add(v[i]);return s}

async function test(label, blockedSlots, useP1) {
  const model=new CpModel();
  const tcVarMap=[[],[],[]];

  for(let ti=0;ti<3;ti++){
    const avail=allSlots.filter(s=>!blockedSlots.has(s));
    for(const[cid,hrs,tid]of tc){
      const svList=[];
      for(let h=0;h<hrs;h++){
        const sv={};
        const candidates=cid==='SS'?avail.filter(s=>parseInt(s.substring(3))>=6):avail;
        for(const sid of candidates){
          if(tid&&blockedSlots.has(sid+'@'+tid))continue;
          sv[sid]=model.newBoolVar('TC'+ti+'_'+cid+'_h'+h+'_'+sid);
        }
        svList.push({h,slotVars:sv});
        model.addEquality(sumV(Object.values(sv)),1n);
      }
      tcVarMap[ti].push({cid,tid,hrs,svList});
    }
    for(const sid of avail){
      const svars=[];for(const ci of tcVarMap[ti])for(const{slotVars}of ci.svList)if(slotVars[sid])svars.push(slotVars[sid]);
      if(svars.length>1)model.addLessOrEqual(sumV(svars),1n);
    }
    for(const ci of tcVarMap[ti]){
      if(ci.hrs>5)continue;
      for(let d=1;d<=5;d++){const dv=[];for(const{slotVars}of ci.svList)for(const[sid,v]of Object.entries(slotVars))if(sid.startsWith('D'+d))dv.push(v);if(dv.length>1)model.addLessOrEqual(sumV(dv),1n)}
    }
  }

  for(let ti=0;ti<3;ti++){
    for(let tj=ti+1;tj<3;tj++){
      for(const sid of allSlots){
        const tv={};
        for(const[idx,vms]of[[ti,tcVarMap[ti]],[tj,tcVarMap[tj]]]){
          for(const ci of vms){if(!ci.tid)continue;for(const{slotVars}of ci.svList)if(slotVars[sid]){if(!tv[ci.tid])tv[ci.tid]=[];tv[ci.tid].push(slotVars[sid])}}
        }
        for(const vars of Object.values(tv))for(let a=0;a<vars.length;a++)for(let b=a+1;b<vars.length;b++)model.addLessOrEqual(vars[a].add(vars[b]),1n);
      }
    }
  }

  if(useP1){
    const p1ByTeacher={};
    for(let ti=0;ti<3;ti++)for(const ci of tcVarMap[ti]){
      if(!ci.tid)continue;for(const{slotVars}of ci.svList)for(const[sid,v]of Object.entries(slotVars))if(sid.endsWith('P1')){if(!p1ByTeacher[ci.tid])p1ByTeacher[ci.tid]=[];p1ByTeacher[ci.tid].push(v)}
    }
    for(const vars of Object.values(p1ByTeacher))if(vars.length>3)model.addLessOrEqual(sumV(vars),3n);
  }

  const solver=new CpSolver();solver.parameters.maxTimeInSeconds=30;
  const status=await solver.solve(model);
  const statusNames={0:'UNKNOWN',1:'MODEL_INVALID',2:'FEASIBLE',3:'INFEASIBLE',4:'OPTIMAL'};
  console.log(label+': '+statusNames[status]||status);
}

(async()=>{
  await test('No blocks, no P1',new Set(),false);
  // Simulate admin+blocked: D1P9, D1P10, D2P10, D5P10
  const bs1=new Set(['D1P9','D1P10','D2P10','D5P10']);
  await test('Admin blocked, no P1',bs1,false);
  await test('Admin blocked + P1 limit',bs1,true);
  // Add batch slots (6 afternoon)
  const bs2=new Set(['D1P9','D1P10','D2P10','D5P10','D1P6','D1P7','D2P6','D2P7','D3P6','D4P6']);
  await test('Admin+batch blocked, no P1',bs2,false);
  await test('Admin+batch blocked + P1',bs2,true);
})();
