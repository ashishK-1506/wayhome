// Historical timetable-shaped TEST DATA only. Never imported by the app.
export const NOW=Date.parse('2026-11-04T10:13:00+05:30');
export const QUERY={originId:'gurugram',destinationId:'jamalpur',date:'2026-11-05',passengers:1,modes:['train','flight','bus','carpool'],depth:'extended',flexibility:0,budget:null,maxHours:72,availabilityOnly:true};
const terminal=(code,cityId)=>({id:'rail:'+code,name:code,cityId});
function service(number,from,to,departAt,arriveAt,amount,seats,classCode){return {id:number,number,name:'Fixture '+number,mode:'train',from,to,departAt,arriveAt,offers:[{id:number+'-'+classCode,status:'available',classCode,seats,amount,currency:'INR',priceBasis:'person',partySize:1,checkedAt:'2026-11-04T10:12:00+05:30',source:'fixture'}]};}
export const SERVICES=[
  service('05576',terminal('ANVT','delhi'),terminal('MB','moradabad'),'2026-11-05T05:15:00+05:30','2026-11-05T09:05:00+05:30',1010,10,'3E'),
  service('13152',terminal('MB','moradabad'),terminal('BE','bareilly'),'2026-11-05T10:00:00+05:30','2026-11-05T11:53:00+05:30',520,1,'3A'),
  service('14236',terminal('BE','bareilly'),terminal('LKO','lucknow'),'2026-11-05T16:45:00+05:30','2026-11-05T21:50:00+05:30',520,31,'3A'),
  service('22549',terminal('LKO','lucknow'),terminal('PRYJ','prayagraj'),'2026-11-06T10:30:00+05:30','2026-11-06T13:35:00+05:30',855,629,'CC'),
  service('04066',terminal('SFG','prayagraj'),terminal('JMP','jamalpur'),'2026-11-06T15:50:00+05:30','2026-11-07T04:50:00+05:30',1155,24,'3A'),
];
export const TRANSFERS=[{fromId:'rail:PRYJ',toId:'rail:SFG',minutes:30,bufferMinutes:60,cost:null,evidence:'Controlled test assumption, not a real transfer quote'}];
