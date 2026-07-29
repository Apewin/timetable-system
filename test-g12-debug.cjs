const {CpSatG12Engine}=require('./packages/core/src/cpsat-g12-engine.cjs');
const e=new CpSatG12Engine('./rules.json','./timetable.json');

// Clear globalTeacher to isolate the issue
console.log('globalTeacher entries:',Object.keys(e.globalTeacher).length);
console.log('T_LUKE in globalTeacher:',e.globalTeacher['T_LUKE']?.size||0);
console.log('T_JAIME in globalTeacher:',e.globalTeacher['T_JAIME']?.size||0);

// Test without globalTeacher
e.globalTeacher={};
e.teacherBusy=function(){return false};

(async()=>{
  const A=await e.generateInitial();
  console.log('Assignments:',A.length);
  // Check if TC courses are placed
  const tc=[],ap=[];A.forEach(a=>{if(a.class_type==='teaching')tc.push(a);if(a.class_type==='ap')ap.push(a)});
  console.log('TC assignments:',tc.length,'AP assignments:',ap.length);
})();
