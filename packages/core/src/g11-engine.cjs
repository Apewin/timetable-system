/**
 * G11 高二引擎 — admin + batchAP + per-TC教学 + fill
 */
const fs = require('fs');

class G11Engine {
  constructor(rulesPath, dataPath) {
    this.rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    this.students = this.data.students.filter(s => s.grade === 11);
    this.ac3 = this.students.filter(s => s.admin_class_id === 'AC3');
    this.ac4 = this.students.filter(s => s.admin_class_id === 'AC4');
    this.tc1 = this.students.filter(s => s.teaching_class_id === 'TC_G11_1');
    this.tc2 = this.students.filter(s => s.teaching_class_id === 'TC_G11_2');
    this.tc3 = this.students.filter(s => s.teaching_class_id === 'TC_G11_3');
    this.tcS = [this.tc1, this.tc2, this.tc3];
    this.tcI = ['TC_G11_1', 'TC_G11_2', 'TC_G11_3'];
    this.tcR = ['R5', 'R6', 'R6'];
  }
  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    stu.forEach(s => A.push({ task_id: cls+'_'+cid+'_'+s.id, slot_id: sid, room_id: room, course_id: cid, class_id: cls, class_type: ctype, teacher_id: tid, student_id: s.id }));
  }

  generateInitial() {
    const A = [];
    // === Fixed ===
    this._add(this.ac3, 'DUTY', 'D1P10', 'AC3', 'admin', 'R5', null, A);
    this._add(this.ac4, 'DUTY', 'D1P10', 'AC4', 'admin', 'R6', null, A);
    this._add(this.ac3, 'MEETING', 'D1P9', 'AC3', 'admin', 'R5', null, A);
    this._add(this.ac4, 'MEETING', 'D1P9', 'AC4', 'admin', 'R6', null, A);
    this._add(this.ac3, 'CLUB', 'D2P10', 'AC3', 'admin', 'R5', null, A);
    this._add(this.ac4, 'CLUB', 'D2P10', 'AC4', 'admin', 'R6', null, A);
    this._add(this.ac3, 'CLUB', 'D5P10', 'AC3', 'admin', 'R5', null, A);
    this._add(this.ac4, 'CLUB', 'D5P10', 'AC4', 'admin', 'R6', null, A);

    // Admin pairs
    const pairs = [
      {s:'D1P2',a3:'MATH_CN',a4:'CHIN'},{s:'D1P3',a3:'CHIN',a4:'MATH_CN'},{s:'D1P4',a3:'POL',a4:'GUIDANCE'},
      {s:'D2P2',a3:'GUIDANCE',a4:'POL'},{s:'D2P3',a3:'PE',a4:'IT'},{s:'D2P4',a3:'IT',a4:'PE'},
      {s:'D3P2',a3:'MATH_CN',a4:'CHIN'},{s:'D3P3',a3:'CHIN',a4:'MATH_CN'},{s:'D3P4',a3:'POL',a4:'GUIDANCE'},
      {s:'D4P2',a3:'GUIDANCE',a4:'POL'},{s:'D4P3',a3:'PE',a4:'SELF_STUDY'},
      {s:'D5P2',a3:'SELF_STUDY',a4:'PE'},{s:'D5P3',a3:'SELF_STUDY',a4:'SELF_STUDY'},
    ];
    const adminT = { MATH_CN:'T_EXP_E',CHIN:'T_EXP_F',POL:'T_EXP_G',IT:'T_EXP_J',GUIDANCE:'T_GUIDANCE',PE:'T_EXP_H1',SELF_STUDY:null };
    pairs.forEach(p => {
      const t3 = p.a3==='PE'?'T_EXP_H1':adminT[p.a3]; // AC3 PE uses H1
      const t4 = p.a4==='PE'?'T_EXP_H2':adminT[p.a4]; // AC4 PE uses H2
      this._add(this.ac3, p.a3, p.s, 'AC3', 'admin', 'R5', t3, A);
      this._add(this.ac4, p.a4, p.s, 'AC4', 'admin', 'R6', t4, A);
    });

    // === Batch AP ===
    const apCfg = { AP_PHYS2:'T_ZHANGZUOPING',AP_CHEM:'T_YANGHONGXU',AP_BIO:'T_FANZHENGWEI',AP_CS:'T_SUNHUA',AP_PSYCH:'T_FUXIAOMENG',AP_ENVSCI:'T_ZHUJIE',AP_MACRO:'T_QINXINXUAN',AP_ARTHIST:'T_ZHANGHUIHUI',AP_MICRO:'T_GLENN' };
    Object.entries(apCfg).forEach(([cid,tid])=>{
      const stus=this.students.filter(s=>(s.ap_courses||[]).includes(cid));
      if(!stus.length)return;
      const nS=2,perS=Math.ceil(stus.length/nS);
      const secs=[];for(let i=0;i<nS;i++)secs.push(stus.slice(i*perS,(i+1)*perS));
      secs.forEach((secStu,si)=>{
        let as=0;
        for(let d=1;d<=5&&as<5;d++)for(const p of[1,2,3,4,5,8,9,10,6,7]){
          if(as>=5)break;const sid='D'+d+'P'+p;
          if(secStu.some(s=>A.some(x=>x.student_id===s.id&&x.slot_id===sid)))continue;
          if(A.some(x=>x.teacher_id===tid&&x.slot_id===sid))continue;
          this._add(secStu,cid,sid,cid+'_S'+(si+1),'ap','R8',tid,A);as++;break;
        }
        for(let d=1;d<=5&&as<5;d++)for(const p of[1,2,3,4,5,8,9,10,6,7]){
          if(as>=5)break;const sid='D'+d+'P'+p;
          if(A.some(x=>x.teacher_id===tid&&x.slot_id===sid))continue;
          secStu.forEach(s=>{const i=A.findIndex(x=>x.student_id===s.id&&x.slot_id===sid&&x.class_type!=='admin');if(i>=0)A.splice(i,1)});
          this._add(secStu,cid,sid,cid+'_S'+(si+1),'ap','R8',tid,A);as++;break;
        }
      });
    });

    // AP per-student fallback
    Object.entries(apCfg).forEach(([cid,tid])=>{
      this.students.filter(s=>(s.ap_courses||[]).includes(cid)).forEach(stu=>{
        let cur=A.filter(a=>a.student_id===stu.id&&a.course_id===cid).length;
        for(let d=1;d<=5&&cur<5;d++)for(const p of[1,2,3,4,5,6,7,8,9,10]){
          if(cur>=5)break;const sid='D'+d+'P'+p;
          if(A.some(a=>a.student_id===stu.id&&a.slot_id===sid&&a.class_type==='admin'))continue;
          const i=A.findIndex(a=>a.student_id===stu.id&&a.slot_id===sid&&a.class_type!=='admin');
          if(i>=0)A.splice(i,1);
          this._add([stu],cid,sid,stu.id,'ap','R8',tid,A);cur++;
        }
      });
    });

    // === Per-TC teaching rebuild ===
    this.tcS.forEach((tcStu,ti)=>{
      const tcId=this.tcI[ti],room=this.tcR[ti];
      const tcOcc=new Set();
      tcStu.forEach(s=>{A.filter(a=>a.student_id===s.id&&(a.class_type==='admin'||a.class_type==='ap')).forEach(a=>tcOcc.add(a.slot_id))});
      const tcCourses=ti===2
        ?[['ENG_COMP',4,'T_YULIN'],['AP_CALC_BC',5,'T_WANGLILI'],['PRE_AP_LIT',2,'T_RACHEL'],['PHYS_CN',2,'T_BAIRUSHUANG'],['AP_LC',5,'T_HANPENG']]
        :[['ENG_COMP',4,'T_YULIN'],['AP_CALC_BC',5,'T_WANGLILI'],['PRE_AP_LIT',2,'T_RACHEL'],['PHYS_CN',2,'T_BAIRUSHUANG'],['TOEFL',3,'T_WEIWEI'],['HONOR_LC',2,'T_LUKE']];
      tcCourses.forEach(([cid,hrs,tid])=>{
        let added=A.filter(a=>a.student_id===tcStu[0].id&&a.course_id===cid).length;
        const dc=[0,0,0,0,0,0];
        for(let d=1;d<=5&&added<hrs;d++){for(const p of[1,2,3,4,5,8,9,10,6,7]){
          if(added>=hrs)break;const sid='D'+d+'P'+p;
          if(tcOcc.has(sid))continue;
          if(tcStu.some(s=>A.some(x=>x.student_id===s.id&&x.slot_id===sid)))continue;
          if(dc[d]>=1&&hrs<=5)continue;
          if(dc[d]>=1&&hrs>5){const ex=A.filter(a=>tcStu.some(s=>s.id===a.student_id)&&a.course_id===cid&&a.slot_id.startsWith('D'+d));if(ex.length>0&&Math.abs(p-parseInt(ex[0].slot_id.substring(3)))!==1)continue}
          this._add(tcStu,cid,sid,tcId,'teaching',room,tid,A);dc[d]++;added++;break;
        }}
        for(let d=1;d<=5&&added<hrs;d++){for(const p of[1,2,3,4,5,6,7,8,9,10]){
          if(added>=hrs)break;const sid='D'+d+'P'+p;
          if(tcOcc.has(sid))continue;
          if(tcStu.some(s=>A.some(x=>x.student_id===s.id&&x.slot_id===sid)))continue;
          if(hrs<=5||dc[d]>=2)continue;
          const ex=A.filter(a=>tcStu.some(s=>s.id===a.student_id)&&a.course_id===cid&&a.slot_id.startsWith('D'+d));
          if(ex.length>0&&Math.abs(p-parseInt(ex[0].slot_id.substring(3)))!==1)continue;
          this._add(tcStu,cid,sid,tcId,'teaching',room,tid,A);dc[d]++;added++;break;
        }}
        for(let d=1;d<=5&&added<hrs;d++){for(const p of[1,2,3,4,5,6,7,8,9,10]){
          if(added>=hrs)break;const sid='D'+d+'P'+p;
          if(tcOcc.has(sid))continue;
          if(tcStu.some(s=>A.some(x=>x.student_id===s.id&&x.slot_id===sid)))continue;
          this._add(tcStu,cid,sid,tcId,'teaching',room,tid,A);dc[d]++;added++;break;
        }}
      });
    });

    // === Fill empty slots ===
    this.students.forEach(stu=>{
      const room=stu.admin_class_id==='AC3'?'R5':'R6';
      const daily=[0,0,0,0,0],occ=new Set();
      A.filter(a=>a.student_id===stu.id).forEach(a=>{daily[parseInt(a.slot_id.charAt(1))-1]++;occ.add(a.slot_id)});
      for(let d=1;d<=5;d++){while(daily[d-1]<10){let f=false;
        for(const p of[10,9,8,7,6]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}
        if(!f){for(const p of[5,4,3,2,1]){const sid='D'+d+'P'+p;if(!occ.has(sid)){this._add([stu],'SELF_STUDY',sid,stu.id,'filler',room,null,A);daily[d-1]++;occ.add(sid);f=true;break}}}
        if(!f)break;
      }}
    });
    return A;
  }

  evaluate(A){let sc=0;const exp={ENG_COMP:4,AP_CALC_BC:5,PRE_AP_LIT:2,PHYS_CN:2};this.tcS.forEach(stu=>{for(let i=0;i<Math.min(3,stu.length);i++){const s=stu[Math.floor(i*stu.length/Math.min(3,stu.length))];const tcExp={...exp};if(s.teaching_class_id==='TC_G11_3'){tcExp.AP_LC=5}else{tcExp.HONOR_LC=2;tcExp.TOEFL=3}Object.entries(tcExp).forEach(([cid,hrs])=>{sc+=Math.abs(A.filter(a=>a.student_id===s.id&&a.course_id===cid).length-hrs)*100});const apIds=(s.ap_courses||[]).filter(c=>c!=='AP_CALC_BC');if(apIds.length>0){const apTotal=apIds.reduce((sum,cid)=>sum+A.filter(a=>a.student_id===s.id&&a.course_id===cid).length,0);sc+=Math.abs(apTotal-apIds.length*5)*100}const daily=[0,0,0,0,0];A.filter(a=>a.student_id===s.id).forEach(a=>daily[a.slot_id.charAt(1)-1]++);if(daily.some(d=>d!==10))sc+=1000;const ssAM=A.filter(a=>a.student_id===s.id&&a.course_id==='SELF_STUDY'&&parseInt(a.slot_id.substring(3))<=5).length;if(ssAM>0)sc+=ssAM*5000}});const s1=this.ac3[0],s2=this.ac4[0];let pi=0;for(let d=1;d<=5;d++)for(let p=1;p<=10;p++){const sid='D'+d+'P'+p;if(A.some(a=>a.student_id===s1.id&&a.slot_id===sid&&a.class_type==='admin')!==A.some(a=>a.student_id===s2.id&&a.slot_id===sid&&a.class_type==='admin'))pi++}sc+=pi*100;return sc;}
  anneal(initial,iters=3000){const cur=initial.map(a=>({...a}));let curS=this.evaluate(cur),best=cur.map(a=>({...a})),bestS=curS,temp=200;for(let i=0;i<iters&&temp>0.05;i++){const stu=this.students[Math.floor(Math.random()*this.students.length)];const sA=cur.filter(a=>a.student_id===stu.id&&a.class_type!=='admin');if(sA.length<2)continue;const[ai,aj]=[Math.floor(Math.random()*sA.length),Math.floor(Math.random()*sA.length)];if(ai===aj)continue;const[a1,a2]=[sA[ai],sA[aj]];if(a1.slot_id===a2.slot_id)continue;const[t1,t2,o1,o2]=[a1.teacher_id,a2.teacher_id,a1.slot_id,a2.slot_id];let ok=true;for(const a of cur)if(a.student_id!==stu.id&&((a.slot_id===o2&&a.teacher_id===t1)||(a.slot_id===o1&&a.teacher_id===t2))){ok=false;break}if(!ok)continue;cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o1)a.slot_id=o2;else if(a.slot_id===o2)a.slot_id=o1}});const ns=this.evaluate(cur);if(ns<curS||Math.random()<Math.exp(-(ns-curS)/temp)){curS=ns;if(ns<bestS){best=cur.map(a=>({...a}));bestS=ns}}else{cur.forEach(a=>{if(a.student_id===stu.id){if(a.slot_id===o2)a.slot_id=o1;else if(a.slot_id===o1)a.slot_id=o2}})}temp*=0.9995}return{assignments:best,score:bestS}}
}
module.exports={G11Engine};
