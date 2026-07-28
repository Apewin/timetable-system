/**
 * G11 高二引擎 — SAT求解器 (logic-solver) + batch AP
 */
const fs=require('fs');const Logic=require('logic-solver');
class G11Engine{
  constructor(rulesPath,dataPath){this.rules=JSON.parse(fs.readFileSync(rulesPath,'utf-8'));this.data=JSON.parse(fs.readFileSync(dataPath,'utf-8'));this.students=this.data.students.filter(s=>s.grade===11);this.ac3=this.students.filter(s=>s.admin_class_id==='AC3');this.ac4=this.students.filter(s=>s.admin_class_id==='AC4');this.tc1=this.students.filter(s=>s.teaching_class_id==='TC_G11_1');this.tc2=this.students.filter(s=>s.teaching_class_id==='TC_G11_2');this.tc3=this.students.filter(s=>s.teaching_class_id==='TC_G11_3');this.tcS=[this.tc1,this.tc2,this.tc3];this.tcI=['TC_G11_1','TC_G11_2','TC_G11_3'];this.tcR=['R5','R6','R6']}
  _add(stu,cid,sid,cls,ctype,room,tid,A){stu.forEach(s=>A.push({task_id:cls+'_'+cid+'_'+s.id,slot_id:sid,room_id:room,course_id:cid,class_id:cls,class_type:ctype,teacher_id:tid,student_id:s.id}))}
  generateInitial(){
    const A=[];
    this._add(this.ac3,'DUTY','D1P10','AC3','admin','R5',null,A);this._add(this.ac4,'DUTY','D1P10','AC4','admin','R6',null,A);
    this.rules.rules.filter(r=>(r.fixed_slot||r.fixed_slots)&&(r.course==='MEETING'||r.course==='CLUB')).forEach(r=>{(r.fixed_slot?[r.fixed_slot]:r.fixed_slots).forEach(s=>{this._add(this.ac3,r.course,s,'AC3','admin','R5',null,A);this._add(this.ac4,r.course,s,'AC4','admin','R6',null,A)})});
    const pairs=[{s:'D1P2',a3:'MATH_CN',a4:'CHIN'},{s:'D1P3',a3:'CHIN',a4:'MATH_CN'},{s:'D1P4',a3:'POL',a4:'GUIDANCE'},{s:'D2P2',a3:'GUIDANCE',a4:'POL'},{s:'D2P3',a3:'PE',a4:'IT'},{s:'D2P4',a3:'IT',a4:'PE'},{s:'D3P2',a3:'MATH_CN',a4:'CHIN'},{s:'D3P3',a3:'CHIN',a4:'MATH_CN'},{s:'D3P4',a3:'POL',a4:'GUIDANCE'},{s:'D4P2',a3:'GUIDANCE',a4:'POL'},{s:'D4P3',a3:'PE',a4:'SELF_STUDY'},{s:'D5P2',a3:'SELF_STUDY',a4:'PE'},{s:'D5P3',a3:'SELF_STUDY',a4:'SELF_STUDY'}];
    const aT={MATH_CN:'T_EXP_E',CHIN:'T_EXP_F',POL:'T_EXP_G',IT:'T_EXP_J',GUIDANCE:'T_GUIDANCE',PE:'T_EXP_H1',SELF_STUDY:null};
    pairs.forEach(p=>{this._add(this.ac3,p.a3,p.s,'AC3','admin','R5',p.a3==='PE'?'T_EXP_H1':aT[p.a3],A);this._add(this.ac4,p.a4,p.s,'AC4','admin','R6',p.a4==='PE'?'T_EXP_H2':aT[p.a4],A)});
    // AP courses handled by per-student SAT below (not batch)
    const apCfg={AP_PHYS2:'T_ZHANGZUOPING',AP_CHEM:'T_YANGHONGXU',AP_BIO:'T_FANZHENGWEI',AP_CS:'T_SUNHUA',AP_PSYCH:'T_FUXIAOMENG',AP_ENVSCI:'T_ZHUJIE',AP_MACRO:'T_QINXINXUAN',AP_ARTHIST:'T_ZHANGHUIHUI',AP_MICRO:'T_GLENN'};
    // SAT per TC
    const common=[['AP_CALC_BC',5,'T_WANGLILI'],['ENG_COMP',4,'T_YULIN'],['PRE_AP_LIT',2,'T_RACHEL'],['PHYS_CN',2,'T_BAIRUSHUANG']];
    const l12=[['TOEFL',3,'T_WEIWEI'],['HONOR_LC',2,'T_LUKE']],l3=[['AP_LC',5,'T_HANPENG']];
    this.tcS.forEach((stu,ti)=>{
      const courses=ti===2?[...common,...l3]:[...common,...l12];
      const blocked=new Set();stu.forEach(s=>{A.filter(a=>a.student_id===s.id).forEach(a=>blocked.add(a.slot_id))});
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of courses){for(let h=0;h<hrs;h++){const sv={};for(const sid of allSlots){if(tid&&A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&!stu.some(s=>s.id===x.student_id)))continue;sv[sid]=`${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      for(const[cid,hrs]of courses){if(hrs>5)continue;for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      const solution=solver.solve();if(!solution)return;
      const trueVars=solution.getTrueVars();
      for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=courses.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add(stu,vm.cid,sid,ti===2?'TC_G11_3':ti===0?'TC_G11_1':'TC_G11_2','teaching',ti===2?'R6':'R5',tid,A);break}}}
    });
    // Per-student SAT for AP courses (use admin+teaching as blocked)
    this.students.forEach(stu=>{
      const apList=(stu.ap_courses||[]).filter(c=>c!=='AP_CALC_BC');
      if(!apList.length)return;
      const apCourses=apList.map(cid=>{const tid=apCfg[cid];return[cid,5,tid]});
      const blocked=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>blocked.add(a.slot_id));
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      if(allSlots.length<apCourses.reduce((s,c)=>s+c[1],0))return; // not enough slots
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of apCourses){for(let h=0;h<hrs;h++){const sv={};for(const sid of allSlots){if(tid&&A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&x.student_id!==stu.id))continue;sv[sid]=`ap_${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      for(const[cid,hrs]of apCourses){for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      const solution=solver.solve();if(!solution)return;
      const trueVars=solution.getTrueVars();
      for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=apCourses.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add([stu],vm.cid,sid,stu.id,'ap','R8',tid,A);break}}}
    });
    // Fill
    this.students.forEach(stu=>{const room=stu.admin_class_id==='AC3'?'R5':'R6';const daily=[0,0,0,0,0],occ=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>{daily[parseInt(a.slot_id.charAt(1))-1]++;occ.add(a.slot_id)});for(let d=1;d<=5;d++){while(daily[d-1]<10){let f=false;for(const p of[10,9,8,7,6]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}if(!f){for(const p of[5,4,3,2,1]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}}if(!f)break;}}});
    return A;
  }
  evaluate(A){let sc=0;const exp={ENG_COMP:4,AP_CALC_BC:5,PRE_AP_LIT:2,PHYS_CN:2};this.tcS.forEach(stu=>{const s=stu[0];const te={...exp};if(s.teaching_class_id==='TC_G11_3')te.AP_LC=5;else{te.HONOR_LC=2;te.TOEFL=3}Object.entries(te).forEach(([cid,hrs])=>{sc+=Math.abs(A.filter(a=>a.student_id===s.id&&a.course_id===cid).length-hrs)*100});const daily=[0,0,0,0,0];A.filter(a=>a.student_id===s.id).forEach(a=>daily[a.slot_id.charAt(1)-1]++);if(daily.some(d=>d!==10))sc+=1000});return sc}
  anneal(initial,iters=3000){const cur=initial.map(a=>({...a}));let curS=this.evaluate(cur),best=cur.map(a=>({...a})),bestS=curS,temp=200;for(let i=0;i<iters&&temp>0.05;i++){const stu=this.students[Math.floor(Math.random()*this.students.length)];const sA=cur.filter(a=>a.student_id===stu.id&&a.class_type!=='admin');if(sA.length<2)continue;const[ai,aj]=[Math.floor(Math.random()*sA.length),Math.floor(Math.random()*sA.length)];if(ai===aj)continue;const[a1,a2]=[sA[ai],sA[aj]];if(a1.slot_id===a2.slot_id)continue;const[t1,t2,o1,o2]=[a1.teacher_id,a2.teacher_id,a1.slot_id,a2.slot_id];let ok=true;for(const a of cur)if(a.student_id!==stu.id&&((a.slot_id===o2&&a.teacher_id===t1)||(a.slot_id===o1&&a.teacher_id===t2))){ok=false;break}if(!ok)continue;cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o1)a.slot_id=o2;else if(a.slot_id===o2)a.slot_id=o1}});const ns=this.evaluate(cur);if(ns<curS||Math.random()<Math.exp(-(ns-curS)/temp)){curS=ns;if(ns<bestS){best=cur.map(a=>({...a}));bestS=ns}}else{cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o2)a.slot_id=o1;else if(a.slot_id===o1)a.slot_id=o2}})}temp*=0.9995}return{assignments:best,score:bestS}}
}
module.exports={G11Engine};
