/**
 * G10 高一引擎 — SAT求解器 (logic-solver/MiniSat)
 * Admin固定 → SAT排全部教学课程 → 保证0分布违规
 */
const fs=require('fs');const Logic=require('logic-solver');
class SchedulingEngine{
  constructor(rulesPath,dataPath){this.rules=JSON.parse(fs.readFileSync(rulesPath,'utf-8'));this.data=JSON.parse(fs.readFileSync(dataPath,'utf-8'));this.students=this.data.students.filter(s=>s.grade===10);this.ac1=this.students.filter(s=>s.admin_class_id==='AC1');this.ac2=this.students.filter(s=>s.admin_class_id==='AC2');this.tc1=this.students.filter(s=>s.teaching_class_id==='TC_G10_1');this.tc2=this.students.filter(s=>s.teaching_class_id==='TC_G10_2');this.tc3=this.students.filter(s=>s.teaching_class_id==='TC_G10_3');this.tcS=[this.tc1,this.tc2,this.tc3];this.tcI=['TC_G10_1','TC_G10_2','TC_G10_3'];this.tcR=['R1','R2','R2']}
  getRule(id){return this.rules.rules.find(r=>r.id===id)}
  _add(stu,cid,sid,cls,ctype,room,tid,A){stu.forEach(s=>A.push({task_id:cls+'_'+cid+'_'+s.id,slot_id:sid,room_id:room,course_id:cid,class_id:cls,class_type:ctype,teacher_id:tid,student_id:s.id}))}
  generateInitial(){
    const A=[];const grade=10;
    // Fixed admin (no DUTY for G10)
    this.rules.rules.filter(r=>(r.fixed_slot||r.fixed_slots)&&(!r.grades||r.grades.includes(grade))).forEach(r=>{(r.fixed_slot?[r.fixed_slot]:r.fixed_slots).forEach(s=>{this._add(this.ac1,r.course,s,'AC1','admin','R1',null,A);this._add(this.ac2,r.course,s,'AC2','admin','R2',null,A)})});
    const adminT={GRAMMAR:'T_JIZHUREN',CHIN:'T_EXP_A',HIST:'T_EXP_B',GEOG:'T_EXP_C',ART:'T_EXP_D',GUIDANCE:'T_GUIDANCE'};
    (this.rules.admin_pairs?.slots||[]).forEach(p=>{const origSlot=p.slot,origP=parseInt(origSlot.substring(3));const newP=origP<=5?origP:origP-4;const slot=origSlot.substring(0,2)+'P'+newP;this._add(this.ac1,p.ac1,slot,'AC1','admin','R1',adminT[p.ac1],A);this._add(this.ac2,p.ac2,slot,'AC2','admin','R2',adminT[p.ac2],A)});
    // SAT solve per TC
    const cT={MATH_PRECAL:'T_CUIXIAOPENG',AP_PHYS1:'T_XIEHAOYANG',CHEM_PRE:'T_ZHANGRAN',BIO_PRE:'T_LIYIXUAN',ENG_LS:'T_BIFEI',ENG_RW:'T_NIUYONGMEI',ENG_LIT:'T_RACHEL',ENG_SURVEY:'T_VINCENT',PE:'T_VINCENT'};
    const cH={MATH_PRECAL:6,AP_PHYS1:5,CHEM_PRE:5,BIO_PRE:5,ENG_LS:3,ENG_RW:3,ENG_LIT:4,ENG_SURVEY:2,PE:2};
    const courses=Object.entries(cH).map(([cid,hrs])=>[cid,hrs,cT[cid]]);courses.push(['SELF_STUDY',2,null]);
    this.tcS.forEach((stu,ti)=>{
      const tcId=this.tcI[ti],room=this.tcR[ti];
      const blocked=new Set();stu.forEach(s=>{A.filter(a=>a.student_id===s.id).forEach(a=>blocked.add(a.slot_id))});
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of courses){for(let h=0;h<hrs;h++){const sv={};for(const sid of allSlots){if(tid&&A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&!stu.some(s=>s.id===x.student_id)))continue;sv[sid]=`${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      // Per-slot: at most 1 course per slot (no student overlap)
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      // Distribution: ≤5hr max 1/day
      for(const[cid,hrs]of courses){if(hrs>5)continue;for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      // No daily constraint — fill runs after SAT
      // MATH_PRECAL (6hrs): allow 2/day but consecutive
      const mv=varMap.filter(vm=>vm.cid==='MATH_PRECAL');for(let d=1;d<=5;d++){const dv=[];for(const vm of mv){for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>2){for(let i=0;i<dv.length;i++)for(let j=i+1;j<dv.length;j++){const si=dv[i].match(/P(\d+)/)[1];const sj=dv[j].match(/P(\d+)/)[1];if(Math.abs(parseInt(si)-parseInt(sj))!==1)solver.require(Logic.not(Logic.and(dv[i],dv[j])))}}}
      const solution=solver.solve();if(!solution)return;
      const trueVars=solution.getTrueVars();
      for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=courses.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add(stu,vm.cid,sid,tcId,'teaching',room,tid,A);break}}}
    });
    // Fill remaining empty slots with SELF_STUDY
    // Smart fill: never put SELF_STUDY in morning. Instead, move afternoon courses to morning.
    this.students.forEach(stu=>{const room=stu.admin_class_id==='AC1'?'R1':'R2';const daily=[0,0,0,0,0],occ=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>{daily[parseInt(a.slot_id.charAt(1))-1]++;occ.add(a.slot_id)});
      // Fill afternoon with SELF_STUDY
      for(let d=1;d<=5;d++){while(daily[d-1]<10){let f=false;for(const p of[10,9,8,7,6]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}if(!f)break;}}
      // For remaining morning gaps: move afternoon courses to morning, then fill afternoon with SS
      for(let d=1;d<=5;d++){while(daily[d-1]<10){
        let moved=false;
        for(const pp of[6,7,8,9,10]){const afterSid='D'+d+'P'+pp;
          const moveA=A.find(a=>a.student_id===stu.id&&a.slot_id===afterSid&&a.class_type!=='admin'&&a.course_id!=='SELF_STUDY'&&!['DUTY','MEETING','CLUB'].includes(a.course_id));
          if(!moveA)continue;
          for(const mp of[5,4,3,2,1]){const morningSid='D'+d+'P'+mp;if(occ.has(morningSid))continue;
            if(moveA.teacher_id&&A.some(a=>a.teacher_id===moveA.teacher_id&&a.slot_id===morningSid&&a.student_id!==stu.id))continue;
            moveA.slot_id=morningSid;occ.add(morningSid);occ.delete(afterSid);
            this._add([stu],'SELF_STUDY',afterSid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(afterSid);moved=true;break;
          }if(moved)break;
        }
        if(!moved)break;
      }}
    });
    return A;
  }
  evaluate(A){let sc=0;const exp={MATH_PRECAL:6,AP_PHYS1:5,CHEM_PRE:5,BIO_PRE:5,ENG_LS:3,ENG_RW:3,ENG_LIT:4,ENG_SURVEY:2,PE:2};this.tcS.forEach(stu=>{const s=stu[0];Object.entries(exp).forEach(([cid,hrs])=>{sc+=Math.abs(A.filter(a=>a.student_id===s.id&&a.course_id===cid).length-hrs)*100});const daily=[0,0,0,0,0];A.filter(a=>a.student_id===s.id).forEach(a=>daily[a.slot_id.charAt(1)-1]++);if(daily.some(d=>d!==10))sc+=1000});const s1=this.ac1[0],s2=this.ac2[0];let pi=0;for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(A.some(a=>a.student_id===s1.id&&a.slot_id===sid&&a.class_type==='admin')!==A.some(a=>a.student_id===s2.id&&a.slot_id===sid&&a.class_type==='admin'))pi++}sc+=pi*100;return sc}
  anneal(initial,iters=3000){const cur=initial.map(a=>({...a}));let curS=this.evaluate(cur),best=cur.map(a=>({...a})),bestS=curS,temp=200;for(let i=0;i<iters&&temp>0.05;i++){const stu=this.students[Math.floor(Math.random()*this.students.length)];const sA=cur.filter(a=>a.student_id===stu.id&&(a.class_type==='teaching'||a.class_type==='filler'));if(sA.length<2)continue;const[ai,aj]=[Math.floor(Math.random()*sA.length),Math.floor(Math.random()*sA.length)];if(ai===aj)continue;const[a1,a2]=[sA[ai],sA[aj]];if(a1.slot_id===a2.slot_id)continue;const[t1,t2,o1,o2]=[a1.teacher_id,a2.teacher_id,a1.slot_id,a2.slot_id];const tcId=a1.class_id;if(!tcId?.startsWith('TC_'))continue;const tcStu=this.students.filter(s=>s.teaching_class_id===tcId);let ok=true;for(const a of cur)if(!tcStu.some(s=>s.id===a.student_id)&&((a.slot_id===o2&&a.teacher_id===t1)||(a.slot_id===o1&&a.teacher_id===t2))){ok=false;break}if(!ok)continue;tcStu.forEach(s=>cur.forEach(a=>{if(a.student_id===s.id){if(a.slot_id===o1)a.slot_id=o2;else if(a.slot_id===o2)a.slot_id=o1}}));const ns=this.evaluate(cur);if(ns<curS||Math.random()<Math.exp(-(ns-curS)/temp)){curS=ns;if(ns<bestS){best=cur.map(a=>({...a}));bestS=ns}}else{tcStu.forEach(s=>cur.forEach(a=>{if(a.student_id===s.id){if(a.slot_id===o2)a.slot_id=o1;else if(a.slot_id===o1)a.slot_id=o2}}))}temp*=0.9995}return{assignments:best,score:bestS}}
}
module.exports={SchedulingEngine};
