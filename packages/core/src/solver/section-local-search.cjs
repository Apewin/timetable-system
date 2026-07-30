const { makeTaskId } = require('../constants.cjs');

function slots() { const out=[]; for(let d=1;d<=5;d++) for(let p=1;p<=10;p++) out.push(`D${d}P${p}`); return out; }
function day(slot) { return Number(slot.slice(1, slot.indexOf('P'))); }
function period(slot) { return Number(slot.slice(slot.indexOf('P') + 1)); }
function rng(seed) { let s=seed>>>0; return () => ((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296); }

/** Fast min-conflicts solver for fixed section membership. */
class SectionLocalSearch {
  constructor(sections, rules, seed = 20260730) {
    this.sections = sections;
    this.rules = rules || { rules: [] };
    this.allSlots = slots();
    this.random = rng(seed);
    this.occurrences = [];
    for (const section of sections) for (let index=0; index<section.weekly_hours; index++) {
      const fixed = this.fixedSlots(section)[index] || null;
      const candidates = fixed ? [fixed] : section.weekly_hours === 5
        ? this.allSlots.filter(s => day(s) === index + 1)
        : section.course_id === 'SELF_STUDY' ? this.allSlots.filter(s => period(s) >= 6) : this.allSlots;
      this.occurrences.push({ section, index, fixed, candidates, slot: null });
    }
  }
  fixedSlots(section) {
    if (section.fixed_slots) return section.fixed_slots;
    const rule = (this.rules.rules || []).find(r => r.course === section.course_id && (r.fixed_slot || r.fixed_slots));
    return rule ? (rule.fixed_slot ? [rule.fixed_slot] : rule.fixed_slots) : [];
  }
  initialise() {
    this.occurrences.forEach(occ=>occ.slot=null);
    this.teacher=new Map(); this.room=new Map(); this.student=new Map(); this.sectionSlot=new Map(); this.total=0;
    const ordered=[...this.occurrences].sort((a,b)=>Number(Boolean(b.fixed))-Number(Boolean(a.fixed)) || b.section.student_ids.length-a.section.student_ids.length || Number(Boolean(b.section.teacher_id))-Number(Boolean(a.section.teacher_id)));
    for(const occ of ordered) {
      let chosen=null, score=Infinity;
      for(const candidate of [...occ.candidates].sort(()=>this.random()-.5)) {
        if(!this.legal(occ,candidate)) continue;
        this.apply(occ,candidate,1); const value=this.total; this.apply(occ,candidate,-1);
        if(value<score){score=value;chosen=candidate;}
      }
      chosen=chosen||occ.candidates[0]; occ.slot=chosen; this.apply(occ,chosen,1);
    }
  }
  rebuildIndexes() {
    this.teacher=new Map(); this.room=new Map(); this.student=new Map(); this.sectionSlot=new Map(); this.total=0;
    for(const occ of this.occurrences) this.apply(occ, occ.slot, 1);
  }
  update(map, key, weight, delta) {
    const before=map.get(key)||0;
    this.total += delta > 0 ? weight*before : -weight*(before-1);
    const after=before+delta;
    if(after) map.set(key,after); else map.delete(key);
  }
  apply(occ, slot, delta) {
    const s=occ.section;
    this.update(this.sectionSlot,`${s.id}@${slot}`,1000000000,delta);
    if(s.teacher_id) this.update(this.teacher,`${s.teacher_id}@${slot}`,100000000,delta);
    if(s.room_id) this.update(this.room,`${s.room_id}@${slot}`,1000000,delta);
    for(const id of s.student_ids) this.update(this.student,`${id}@${slot}`,10000,delta);
  }
  legal(occ, slot) {
    const same=this.occurrences.filter(x=>x!==occ && x.section.id===occ.section.id && x.slot);
    if(same.some(x=>x.slot===slot)) return false;
    const onDay=same.filter(x=>day(x.slot)===day(slot));
    if(occ.section.weekly_hours<=5 && onDay.length) return false;
    if(occ.section.weekly_hours>5 && onDay.length>=2) return false;
    if(occ.section.weekly_hours>5 && onDay.length===1 && Math.abs(period(onDay[0].slot)-period(slot))!==1) return false;
    return true;
  }
  conflicted(occ) {
    const s=occ.section, slot=occ.slot;
    if((this.sectionSlot.get(`${s.id}@${slot}`)||0)>1) return true;
    if(s.teacher_id && (this.teacher.get(`${s.teacher_id}@${slot}`)||0)>1) return true;
    if(s.room_id && (this.room.get(`${s.room_id}@${slot}`)||0)>1) return true;
    return s.student_ids.some(id=>(this.student.get(`${id}@${slot}`)||0)>1);
  }
  moveStudent(studentId, section, delta) {
    for(const occ of this.occurrences) if(occ.section.id===section.id) this.update(this.student,`${studentId}@${occ.slot}`,10000,delta);
  }
  swapStudents() {
    const byCourse=new Map();
    for(const section of this.sections) if((section.class_type==='ap'||section.class_type==='elective') && section.student_ids.length){const list=byCourse.get(section.course_id)||[];list.push(section);byCourse.set(section.course_id,list);}
    const candidates=[...byCourse.values()].filter(list=>list.length>1);
    if(!candidates.length) return false;
    const conflicts=[...this.student.entries()].filter(([,count])=>count>1);
    let list=null, a=null;
    if(conflicts.length) {
      const [key]=conflicts[Math.floor(this.random()*conflicts.length)]; const split=key.lastIndexOf('@'); const studentId=key.slice(0,split); const slot=key.slice(split+1);
      const occupied=this.sections.filter(s=>s.student_ids.includes(studentId) && this.occurrences.some(o=>o.section.id===s.id&&o.slot===slot) && (s.class_type==='ap'||s.class_type==='elective'));
      if(occupied.length) { const source=occupied[Math.floor(this.random()*occupied.length)]; list=byCourse.get(source.course_id); a=studentId; }
    }
    list=list||candidates[Math.floor(this.random()*candidates.length)];
    let left=list[Math.floor(this.random()*list.length)]; let right=list[Math.floor(this.random()*list.length)]; if(left===right) return false;
    if(a && !left.student_ids.includes(a) && right.student_ids.includes(a)) [left,right]=[right,left];
    a=a||left.student_ids[Math.floor(this.random()*left.student_ids.length)];
    const b=right.student_ids[Math.floor(this.random()*right.student_ids.length)];
    const before=this.total; this.moveStudent(a,left,-1);this.moveStudent(a,right,1);this.moveStudent(b,right,-1);this.moveStudent(b,left,1);
    if(this.total<=before){left.student_ids[left.student_ids.indexOf(a)]=b;right.student_ids[right.student_ids.indexOf(b)]=a;return true;}
    this.moveStudent(a,right,-1);this.moveStudent(a,left,1);this.moveStudent(b,left,-1);this.moveStudent(b,right,1);return false;
  }
  pickConflictOccurrence(step) {
    const source = step % 3 === 0 ? this.student : step % 3 === 1 ? this.teacher : this.room;
    const keys=[...source.entries()].filter(([,count])=>count>1).map(([key])=>key);
    if(!keys.length) return null;
    const key=keys[Math.floor(this.random()*keys.length)]; const split=key.lastIndexOf('@'); const id=key.slice(0,split), slot=key.slice(split+1);
    const matches=this.occurrences.filter(occ=>!occ.fixed && occ.slot===slot && (source===this.student ? occ.section.student_ids.includes(id) : source===this.teacher ? occ.section.teacher_id===id : occ.section.room_id===id));
    return matches[Math.floor(this.random()*matches.length)]||null;
  }
  swapOccurrences(step) {
    const left=this.pickConflictOccurrence(step); if(!left) return false;
    const options=this.occurrences.filter(o=>o!==left&&!o.fixed&&o.candidates.includes(left.slot)&&left.candidates.includes(o.slot));
    if(!options.length) return false;
    const right=options[Math.floor(this.random()*options.length)], a=left.slot, b=right.slot, before=this.total;
    this.apply(left,a,-1); this.apply(right,b,-1); left.slot=null; right.slot=null;
    const legal=this.legal(left,b)&&this.legal(right,a);
    if(legal){ this.apply(left,b,1); this.apply(right,a,1); left.slot=b; right.slot=a; }
    if(!legal||this.total>before){
      if(legal){this.apply(left,b,-1);this.apply(right,a,-1);}
      left.slot=a;right.slot=b;this.apply(left,a,1);this.apply(right,b,1);return false;
    }
    return true;
  }
  solve(maxSteps=100000) {
    this.initialise(); let best=this.total; let bestSlots=this.occurrences.map(o=>o.slot); let bestMembers=this.sections.map(s=>[...s.student_ids]);
    for(let step=0;step<maxSteps && best>0;step++) {
      if(step%10===0){this.swapOccurrences(step);if(this.total<best){best=this.total;bestSlots=this.occurrences.map(o=>o.slot);bestMembers=this.sections.map(s=>[...s.student_ids]);}continue;}
      if(step%2===0){ this.swapStudents(); if(this.total<best){best=this.total;bestSlots=this.occurrences.map(o=>o.slot);bestMembers=this.sections.map(s=>[...s.student_ids]);} continue; }
      const bad=this.occurrences.filter(o=>!o.fixed&&this.conflicted(o));
      const movable=this.occurrences.filter(o=>!o.fixed);
      const occ=this.pickConflictOccurrence(step)||(bad.length?bad:movable)[Math.floor(this.random()*(bad.length||movable.length))];
      if(!occ) break;
      const original=occ.slot; this.apply(occ,original,-1);
      let chosen=original, localBest=Infinity, evaluated=[];
      const choices=[...occ.candidates].sort(()=>this.random()-.5).slice(0,30);
      for(const candidate of choices) {
        if(!this.legal(occ,candidate)) continue;
        this.apply(occ,candidate,1); const value=this.total; this.apply(occ,candidate,-1);
        evaluated.push([candidate,value]); if(value<localBest){localBest=value;chosen=candidate;}
      }
      if(evaluated.length && this.random()<0.015) { const escaped=evaluated[Math.floor(this.random()*evaluated.length)]; chosen=escaped[0]; localBest=escaped[1]; }
      if(localBest===Infinity) { chosen=original; localBest=this.total; }
      this.apply(occ,chosen,1); occ.slot=chosen;
      if(this.total<best) { best=this.total; bestSlots=this.occurrences.map(o=>o.slot); bestMembers=this.sections.map(s=>[...s.student_ids]); }
    }
    this.occurrences.forEach((o,i)=>o.slot=bestSlots[i]);
    this.sections.forEach((section,index)=>section.student_ids=bestMembers[index]);
    this.rebuildIndexes();
    return { ok: this.total===0, score: this.total, meetings: this.occurrences.map(o=>({section_id:o.section.id,slot_id:o.slot})) };
  }
  assignments(meetings) {
    const sections=new Map(this.sections.map(s=>[s.id,s])); const out=[];
    for(const meeting of meetings){const s=sections.get(meeting.section_id); for(const student_id of s.student_ids) out.push({task_id:makeTaskId(s.id,s.course_id,student_id,meeting.slot_id),slot_id:meeting.slot_id,room_id:s.room_id,course_id:s.course_id,class_id:s.id,class_type:s.class_type,teacher_id:s.teacher_id,student_id});}
    return out;
  }
}
module.exports={SectionLocalSearch};
