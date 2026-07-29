/**
 * G12 高三引擎 — SAT求解器 (logic-solver) + batch AP/elective
 *
 * 排课顺序: Admin → Batch(第二外语+小选修) → TC SAT → Per-student SAT → Fill
 * Batch课程确保同组排在同一时段（同格），分散在不同天（无连堂）
 */
const fs=require('fs');const Logic=require('logic-solver');
class G12Engine{
  constructor(rulesPath,dataPath){this.rules=JSON.parse(fs.readFileSync(rulesPath,'utf-8'));this.data=JSON.parse(fs.readFileSync(dataPath,'utf-8'));this.students=this.data.students.filter(s=>s.grade===12);this.ac5=this.students.filter(s=>s.admin_class_id==='AC5');this.ac6=this.students.filter(s=>s.admin_class_id==='AC6');this.tc1=this.students.filter(s=>s.teaching_class_id==='TC_G12_1');this.tc2=this.students.filter(s=>s.teaching_class_id==='TC_G12_2');this.tc3=this.students.filter(s=>s.teaching_class_id==='TC_G12_3');this.tcS=[this.tc1,this.tc2,this.tc3];this.tcI=['TC_G12_1','TC_G12_2','TC_G12_3'];this.tcR=['R9','R10','R10'];this.globalTeacher={};(this.data.assignments||[]).forEach(a=>{if(a.teacher_id){if(!this.globalTeacher[a.teacher_id])this.globalTeacher[a.teacher_id]=new Set();this.globalTeacher[a.teacher_id].add(a.slot_id)}})}
  _add(stu,cid,sid,cls,ctype,room,tid,A){stu.forEach(s=>A.push({task_id:cls+'_'+cid+'_'+s.id,slot_id:sid,room_id:room,course_id:cid,class_id:cls,class_type:ctype,teacher_id:tid,student_id:s.id}))}
  teacherBusy(tid,sid){return this.globalTeacher[tid]?.has(sid)||false}

  /** Pick N afternoon slots (P6-P10) on N different days, preferring days with most free periods */
  _pickBatchSlots(students, count, A) {
    const slots=[],blocked=new Set();
    students.forEach(s=>{A.filter(a=>a.student_id===s.id).forEach(a=>blocked.add(a.slot_id))});
    const dayFree=[];for(let d=1;d<=5;d++){let c=0;for(let p=6;p<=10;p++)if(!blocked.has('D'+d+'P'+p))c++;dayFree.push({d,c})}
    dayFree.sort((a,b)=>b.c-a.c);
    for(let i=0;i<dayFree.length&&slots.length<count;i++){const d=dayFree[i].d;for(const p of[7,8,9,6]){const sid='D'+d+'P'+p;if(!blocked.has(sid)&&!slots.some(s=>s.startsWith('D'+d))){slots.push(sid);break}}}
    return slots;
  }

  generateInitial(){
    const A=[];
    // ===== Phase 1: Admin (fixed slots) =====
    this._add(this.ac5,'DUTY','D1P10','AC5','admin','R9',null,A);this._add(this.ac6,'DUTY','D1P10','AC6','admin','R10',null,A);
    this._add(this.ac5,'MEETING','D1P9','AC5','admin','R9',null,A);this._add(this.ac6,'MEETING','D1P9','AC6','admin','R10',null,A);
    this._add(this.ac5,'CLUB','D2P10','AC5','admin','R9',null,A);this._add(this.ac6,'CLUB','D2P10','AC6','admin','R10',null,A);
    this._add(this.ac5,'CLUB','D5P10','AC5','admin','R9',null,A);this._add(this.ac6,'CLUB','D5P10','AC6','admin','R10',null,A);
    [{s:'D1P2',a5:'CHIN',a6:'PE'},{s:'D1P3',a5:'PE',a6:'CHIN'},{s:'D2P2',a5:'CHIN',a6:'PE'},{s:'D2P3',a5:'PE',a6:'CHIN'}].forEach(p=>{this._add(this.ac5,p.a5,p.s,'AC5','admin','R9',p.a5==='CHIN'?'T_EXP_K':'T_EXP_L',A);this._add(this.ac6,p.a6,p.s,'AC6','admin','R10',p.a6==='CHIN'?'T_EXP_K':'T_EXP_L',A)});

    // Teacher configs
    const apCfg={AP_PHYSC:'T_BAIRUSHUANG',AP_CHEM:'T_YANGHONGXU',AP_BIO:'T_FANZHENGWEI',AP_CS:'T_SUNHUA',AP_ENVSCI:'T_ZHUJIE',AP_PSYCH:'T_XINLI',AP_ARTHIST:'T_ZHANGHUIHUI',AP_MACRO:'T_YUYUANYING'};
    const eT={AP_LANG:'T_HANPENG',AP_LIT:'T_WEIWEI',HONOR_LIT:'T_ZHANGHUIHUI',LINEAR_ALG:'T_ZHANGZUOPING',BUSINESS:'T_QINXINXUAN',MECH_BASIS:'T_YUYUANYING',JAPANESE:'T_NIUYONGMEI',FRENCH:'T_BIFEI',GERMAN:'T_GLENN'};
    const langGroup=['JAPANESE','FRENCH','GERMAN'],minorGroup=['BUSINESS','MECH_BASIS','LINEAR_ALG'];

    // ===== Phase 2: Batch — 第二外语 + 小选修 =====
    const langStudents=this.students.filter(s=>{const ec=s.elective_choices||{};return langGroup.includes(ec.group_c)});
    if(langStudents.length>0){const slots=this._pickBatchSlots(langStudents,2,A);langStudents.forEach(s=>{const cid=s.elective_choices.group_c;slots.forEach(sid=>this._add([s],cid,sid,s.id,'batch','R8',eT[cid],A))})}
    const minorStudents=this.students.filter(s=>{const ec=s.elective_choices||{};return minorGroup.includes(ec.group_b)});
    if(minorStudents.length>0){const slots=this._pickBatchSlots(minorStudents,4,A);minorStudents.forEach(s=>{const cid=s.elective_choices.group_b;slots.forEach(sid=>this._add([s],cid,sid,s.id,'batch','R8',eT[cid],A))})}

    // ===== Phase 3: TC SAT (per teaching class) =====
    const tc=[['AP_STAT',5,'T_JAIME'],['ENG_CW',5,'T_LUKE'],['COLLEGE_APP',4,null],['SELF_STUDY',2,null]];
    this.tcS.forEach((stu,ti)=>{
      const blocked=new Set();stu.forEach(s=>{A.filter(a=>a.student_id===s.id).forEach(a=>blocked.add(a.slot_id))});
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of tc){for(let h=0;h<hrs;h++){const sv={};const slots=cid==='SELF_STUDY'?allSlots.filter(sid=>parseInt(sid.substring(3))>=6):allSlots;for(const sid of slots){if(tid&&A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&!stu.some(s=>s.id===x.student_id)))continue;if(tid&&this.teacherBusy(tid,sid))continue;sv[sid]=`${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      for(const[cid,hrs]of tc){if(hrs>5)continue;for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      const solution=solver.solve();
      if(!solution)return;
      const trueVars=solution.getTrueVars();
      for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=tc.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add(stu,vm.cid,sid,this.tcI[ti],'teaching',this.tcR[ti],tid,A);break}}}
    });

    // ===== Phase 4: Per-student SAT for AP + remaining electives =====
    this.students.forEach(stu=>{
      const stuCourses=[];
      (stu.ap_courses||[]).forEach(cid=>stuCourses.push([cid,5,apCfg[cid]]));
      const ec=stu.elective_choices||{};
      if(ec.group_a)stuCourses.push([ec.group_a,5,eT[ec.group_a]]);
      if(ec.group_b&&!minorGroup.includes(ec.group_b))stuCourses.push([ec.group_b,4,eT[ec.group_b]]);
      if(ec.group_c&&!langGroup.includes(ec.group_c))stuCourses.push([ec.group_c,2,eT[ec.group_c]]);
      if(!stuCourses.length)return;
      const blocked=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>blocked.add(a.slot_id));
      const allSlots=[];for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(!blocked.has(sid))allSlots.push(sid)}
      if(allSlots.length<stuCourses.reduce((s,c)=>s+c[1],0))return;
      const solver=new Logic.Solver();const varMap=[];
      for(const[cid,hrs,tid]of stuCourses){for(let h=0;h<hrs;h++){const sv={};for(const sid of allSlots){if(tid&&(A.some(x=>x.teacher_id===tid&&x.slot_id===sid&&x.student_id!==stu.id)||this.teacherBusy(tid,sid)))continue;sv[sid]=`st_${cid}_${h}_${sid}`}varMap.push({cid,h,slotVars:sv});solver.require(Logic.exactlyOne(Object.values(sv)))}}
      for(const sid of allSlots){const sv=[];for(const vm of varMap){const vname=vm.slotVars[sid];if(vname)sv.push(vname)}if(sv.length>1)solver.require(Logic.atMostOne(sv))}
      for(const[cid,hrs]of stuCourses){if(hrs>5)continue;for(let d=1;d<=5;d++){const dv=[];for(const vm of varMap){if(vm.cid!==cid)continue;for(const[sid,vname]of Object.entries(vm.slotVars)){if(sid.startsWith('D'+d))dv.push(vname)}}if(dv.length>1)solver.require(Logic.atMostOne(dv))}}
      const solution=solver.solve();
      if(solution){const trueVars=solution.getTrueVars();for(const vm of varMap){for(const[sid,vname]of Object.entries(vm.slotVars)){if(trueVars.includes(vname)){const[cid,,tid]=stuCourses.find(c=>c[0]===vm.cid)||[vm.cid,0,null];this._add([stu],vm.cid,sid,stu.id,'ap','R8',tid,A);break}}}}
      else{stuCourses.forEach(([cid,hrs,tid])=>{let a=0;const dc=[0,0,0,0,0,0];for(let d=1;d<=5&&a<hrs;d++){for(const p of[1,2,3,4,5,8,9,10,6,7]){if(a>=hrs)break;const sid='D'+d+'P'+p;if(blocked.has(sid))continue;if(A.some(x=>x.student_id===stu.id&&x.slot_id===sid))continue;if(dc[d]>=1&&hrs<=5)continue;this._add([stu],cid,sid,stu.id,'ap','R8',tid,A);blocked.add(sid);dc[d]++;a++;break}}for(let d=1;d<=5&&a<hrs;d++){for(const p of[1,2,3,4,5,6,7,8,9,10]){if(a>=hrs)break;const sid='D'+d+'P'+p;if(blocked.has(sid))continue;if(A.some(x=>x.student_id===stu.id&&x.slot_id===sid))continue;this._add([stu],cid,sid,stu.id,'ap','R8',tid,A);blocked.add(sid);a++;break}}})}
    });

    // ===== Phase 5: Smart fill (SELF_STUDY in afternoon, move courses to morning) =====
    this.students.forEach(stu=>{const room=stu.admin_class_id==='AC5'?'R9':'R10';const daily=[0,0,0,0,0],occ=new Set();A.filter(a=>a.student_id===stu.id).forEach(a=>{daily[parseInt(a.slot_id.charAt(1))-1]++;occ.add(a.slot_id)});for(let d=1;d<=5;d++){while(daily[d-1]<10){let f=false;for(const p of[10,9,8,7,6]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}if(!f)break;}}for(let d=1;d<=5;d++){while(daily[d-1]<10){let moved=false;for(const pp of[6,7,8,9,10]){const afterSid='D'+d+'P'+pp;const moveA=A.find(a=>a.student_id===stu.id&&a.slot_id===afterSid&&a.class_type!=='admin'&&a.class_type!=='batch'&&a.course_id!=='SELF_STUDY'&&!['DUTY','MEETING','CLUB'].includes(a.course_id));if(!moveA)continue;for(const mp of[5,4,3,2,1]){const morningSid='D'+d+'P'+mp;if(occ.has(morningSid))continue;if(moveA.teacher_id&&A.some(a=>a.teacher_id===moveA.teacher_id&&a.slot_id===morningSid&&a.student_id!==stu.id))continue;moveA.slot_id=morningSid;occ.add(morningSid);occ.delete(afterSid);this._add([stu],'SELF_STUDY',afterSid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(afterSid);moved=true;break;}if(moved)break;}if(!moved)break;}}});
    return A;
  }

  evaluate(A){let sc=0;const exp={AP_STAT:5,ENG_CW:5,COLLEGE_APP:4};this.tcS.forEach(stu=>{const s=stu[0];Object.entries(exp).forEach(([cid,hrs])=>{sc+=Math.abs(A.filter(a=>a.student_id===s.id&&a.course_id===cid).length-hrs)*100});const daily=[0,0,0,0,0];A.filter(a=>a.student_id===s.id).forEach(a=>daily[a.slot_id.charAt(1)-1]++);if(daily.some(d=>d!==10))sc+=1000});this.students.forEach(s=>{const sA=A.filter(a=>a.student_id===s.id);const count={};sA.forEach(a=>{count[a.course_id]=(count[a.course_id]||0)+1});(s.ap_courses||[]).forEach(cid=>{sc+=Math.abs((count[cid]||0)-5)*200});const ec=s.elective_choices||{};if(ec.group_a)sc+=Math.abs((count[ec.group_a]||0)-5)*200;if(ec.group_b)sc+=Math.abs((count[ec.group_b]||0)-4)*200;if(ec.group_c)sc+=Math.abs((count[ec.group_c]||0)-2)*200});return sc}

  anneal(initial,iters=3000){const cur=initial.map(a=>({...a}));let curS=this.evaluate(cur),best=cur.map(a=>({...a})),bestS=curS,temp=200;for(let i=0;i<iters&&temp>0.05;i++){const stu=this.students[Math.floor(Math.random()*this.students.length)];const sA=cur.filter(a=>a.student_id===stu.id&&(a.class_type==='teaching'||a.class_type==='filler'));if(sA.length<2)continue;const[ai,aj]=[Math.floor(Math.random()*sA.length),Math.floor(Math.random()*sA.length)];if(ai===aj)continue;const[a1,a2]=[sA[ai],sA[aj]];if(a1.slot_id===a2.slot_id)continue;const[t1,t2,o1,o2]=[a1.teacher_id,a2.teacher_id,a1.slot_id,a2.slot_id];let ok=true;for(const a of cur)if(a.student_id!==stu.id&&((a.slot_id===o2&&a.teacher_id===t1)||(a.slot_id===o1&&a.teacher_id===t2))){ok=false;break}if(!ok)continue;cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o1)a.slot_id=o2;else if(a.slot_id===o2)a.slot_id=o1}});const ns=this.evaluate(cur);if(ns<curS||Math.random()<Math.exp(-(ns-curS)/temp)){curS=ns;if(ns<bestS){best=cur.map(a=>({...a}));bestS=ns}}else{cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o2)a.slot_id=o1;else if(a.slot_id===o1)a.slot_id=o2}})}temp*=0.9995}return{assignments:best,score:bestS}}
}
module.exports={G12Engine};
