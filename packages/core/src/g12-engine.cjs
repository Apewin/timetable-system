/**
 * G12 高三引擎 — SAT求解器 (logic-solver) + batch AP/elective
 */
const fs=require('fs');const Logic=require('logic-solver');
class G12Engine{
  constructor(rulesPath,dataPath){this.rules=JSON.parse(fs.readFileSync(rulesPath,'utf-8'));this.data=JSON.parse(fs.readFileSync(dataPath,'utf-8'));this.students=this.data.students.filter(s=>s.grade===12);this.ac5=this.students.filter(s=>s.admin_class_id==='AC5');this.ac6=this.students.filter(s=>s.admin_class_id==='AC6');this.tc1=this.students.filter(s=>s.teaching_class_id==='TC_G12_1');this.tc2=this.students.filter(s=>s.teaching_class_id==='TC_G12_2');this.tc3=this.students.filter(s=>s.teaching_class_id==='TC_G12_3');this.tcS=[this.tc1,this.tc2,this.tc3];this.tcI=['TC_G12_1','TC_G12_2','TC_G12_3'];this.tcR=['R9','R10','R10'];this.globalTeacher={};(this.data.assignments||[]).forEach(a=>{if(a.teacher_id){if(!this.globalTeacher[a.teacher_id])this.globalTeacher[a.teacher_id]=new Set();this.globalTeacher[a.teacher_id].add(a.slot_id)}})}
  _add(stu,cid,sid,cls,ctype,room,tid,A){stu.forEach(s=>A.push({task_id:cls+'_'+cid+'_'+s.id,slot_id:sid,room_id:room,course_id:cid,class_id:cls,class_type:ctype,teacher_id:tid,student_id:s.id}))}
  teacherBusy(tid,sid){return this.globalTeacher[tid]?.has(sid)||false}
  generateInitial(){
    const A=[];
    this._add(this.ac5,'DUTY','D1P10','AC5','admin','R9',null,A);this._add(this.ac6,'DUTY','D1P10','AC6','admin','R10',null,A);
    this._add(this.ac5,'MEETING','D1P9','AC5','admin','R9',null,A);this._add(this.ac6,'MEETING','D1P9','AC6','admin','R10',null,A);
    this._add(this.ac5,'CLUB','D2P10','AC5','admin','R9',null,A);this._add(this.ac6,'CLUB','D2P10','AC6','admin','R10',null,A);
    this._add(this.ac5,'CLUB','D5P10','AC5','admin','R9',null,A);this._add(this.ac6,'CLUB','D5P10','AC6','admin','R10',null,A);
    [{s:'D1P2',a5:'CHIN',a6:'PE'},{s:'D1P3',a5:'PE',a6:'CHIN'},{s:'D2P2',a5:'CHIN',a6:'PE'},{s:'D2P3',a5:'PE',a6:'CHIN'}].forEach(p=>{this._add(this.ac5,p.a5,p.s,'AC5','admin','R9',p.a5==='CHIN'?'T_EXP_K':'T_EXP_L',A);this._add(this.ac6,p.a6,p.s,'AC6','admin','R10',p.a6==='CHIN'?'T_EXP_K':'T_EXP_L',A)});
    // AP + electives handled by per-student SAT below
    const apCfg={AP_PHYSC:'T_BAIRUSHUANG',AP_CHEM:'T_YANGHONGXU',AP_BIO:'T_FANZHENGWEI',AP_CS:'T_SUNHUA',AP_ENVSCI:'T_ZHUJIE',AP_PSYCH:'T_XINLI',AP_ARTHIST:'T_ZHANGHUIHUI',AP_MACRO:'T_YUYUANYING'};
    const eT={AP_LANG:'T_HANPENG',AP_LIT:'T_WEIWEI',HONOR_LIT:'T_ZHANGHUIHUI',LINEAR_ALG:'T_ZHANGZUOPING',BUSINESS:'T_QINXINXUAN',MECH_BASIS:'T_YUYUANYING',JAPANESE:'T_NIUYONGMEI',FRENCH:'T_BIFEI',GERMAN:'T_GLENN'};
    // SAT per TC
    const tc=[['AP_STAT',5,'T_JAIME'],['ENG_CW',5,'T_LUKE'],['COLLEGE_APP',4,null],['SELF_STUDY',2,null]];
    this.tcS.forEach((stu,ti)=>{
      const blocked=new Set();stu.forEach(s=>{A.filter(a=>a.student_id===s.id).forEach(a=>blocked.add(a.slot_id))});
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of tc){for(let h=0;h<hrs;h++){const sv={};for(const sid of allSlots){if(tid&&A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&!stu.some(s=>s.id===x.student_id)))continue;if(tid&&this.teacherBusy(tid,sid))continue;sv[sid]=`${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      for(const[cid,hrs]of tc){if(hrs>5)continue;for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      const solution=solver.solve();if(!solution)return;
      const trueVars=solution.getTrueVars();
      for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=tc.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add(stu,vm.cid,sid,this.tcI[ti],'teaching',this.tcR[ti],tid,A);break}}}
    });
    // Per-student SAT for AP + electives
    this.students.forEach(stu=>{
      const stuCourses=[];
      (stu.ap_courses||[]).forEach(cid=>stuCourses.push([cid,5,apCfg[cid]]));
      const ec=stu.elective_choices||{};
      if(ec.group_a)stuCourses.push([ec.group_a,5,eT[ec.group_a]]);
      if(ec.group_b)stuCourses.push([ec.group_b,4,eT[ec.group_b]]);
      if(ec.group_c)stuCourses.push([ec.group_c,2,eT[ec.group_c]]);
      if(!stuCourses.length)return;
      const blocked=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>blocked.add(a.slot_id));
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      if(allSlots.length<stuCourses.reduce((s,c)=>s+c[1],0))return;
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of stuCourses){for(let h=0;h<hrs;h++){const sv={};for(const sid of allSlots){if(tid&&(A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&x.student_id!==stu.id)||this.teacherBusy(tid,sid)))continue;sv[sid]=`st_${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      for(const[cid,hrs]of stuCourses){if(hrs>5)continue;for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      const solution=solver.solve();if(!solution)return;
      const trueVars=solution.getTrueVars();
      for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=stuCourses.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add([stu],vm.cid,sid,stu.id,'ap',tid==='T_JAIME'||tid==='T_LUKE'?'teaching':'ap','R8',tid,A);break}}}
    });
    // Fill
    this.students.forEach(stu=>{const room=stu.admin_class_id==='AC5'?'R9':'R10';const daily=[0,0,0,0,0],occ=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>{daily[parseInt(a.slot_id.charAt(1))-1]++;occ.add(a.slot_id)});for(let d=1;d<=5;d++){while(daily[d-1]<10){let f=false;for(const p of[10,9,8,7,6]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}if(!f){for(const p of[5,4,3,2,1]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}}if(!f)break;}}});
    return A;
  }
  evaluate(A){let sc=0;const exp={AP_STAT:5,ENG_CW:5,COLLEGE_APP:4};this.tcS.forEach(stu=>{const s=stu[0];Object.entries(exp).forEach(([cid,hrs])=>{sc+=Math.abs(A.filter(a=>a.student_id===s.id&&a.course_id===cid).length-hrs)*100});const daily=[0,0,0,0,0];A.filter(a=>a.student_id===s.id).forEach(a=>daily[a.slot_id.charAt(1)-1]++);if(daily.some(d=>d!==10))sc+=1000});return sc}
  anneal(initial,iters=3000){const cur=initial.map(a=>({...a}));let curS=this.evaluate(cur),best=cur.map(a=>({...a})),bestS=curS,temp=200;for(let i=0;i<iters&&temp>0.05;i++){const stu=this.students[Math.floor(Math.random()*this.students.length)];const sA=cur.filter(a=>a.student_id===stu.id&&a.class_type!=='admin');if(sA.length<2)continue;const[ai,aj]=[Math.floor(Math.random()*sA.length),Math.floor(Math.random()*sA.length)];if(ai===aj)continue;const[a1,a2]=[sA[ai],sA[aj]];if(a1.slot_id===a2.slot_id)continue;const[t1,t2,o1,o2]=[a1.teacher_id,a2.teacher_id,a1.slot_id,a2.slot_id];let ok=true;for(const a of cur)if(a.student_id!==stu.id&&((a.slot_id===o2&&a.teacher_id===t1)||(a.slot_id===o1&&a.teacher_id===t2))){ok=false;break}if(!ok)continue;cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o1)a.slot_id=o2;else if(a.slot_id===o2)a.slot_id=o1}});const ns=this.evaluate(cur);if(ns<curS||Math.random()<Math.exp(-(ns-curS)/temp)){curS=ns;if(ns<bestS){best=cur.map(a=>({...a}));bestS=ns}}else{cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o2)a.slot_id=o1;else if(a.slot_id===o1)a.slot_id=o2}})}temp*=0.9995}return{assignments:best,score:bestS}}
}
module.exports={G12Engine};
