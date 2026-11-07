// Curated discovery points, not a timetable or proof that any service operates.
// lat/lon are approximate city centres, used only to pick connection hubs on the way.
export const PLACES = [
  { id:'gurugram', name:'Gurugram', state:'Haryana', aliases:['Gurgaon'], rail:['GUR','NDLS','ANVT','DLI','NZM'], airports:['DEL'], lat:28.46, lon:77.03 },
  { id:'delhi', name:'New Delhi', state:'Delhi', aliases:['Delhi','NCR'], rail:['NDLS','ANVT','DLI','NZM'], airports:['DEL'], lat:28.61, lon:77.21, hub:true },
  { id:'jamalpur', name:'Jamalpur', state:'Bihar', aliases:['JMP','Jamalpur Junction'], rail:['JMP'], airports:['PAT','DGH','GAY','DBR'], lat:25.31, lon:86.49 },
  { id:'munger', name:'Munger', state:'Bihar', aliases:['Monghyr'], rail:['MGR','JMP'], airports:['PAT','DGH','GAY','DBR'], lat:25.37, lon:86.47 },
  { id:'patna', name:'Patna', state:'Bihar', aliases:['PNBE','Danapur'], rail:['PNBE','DNR','PPTA'], airports:['PAT'], lat:25.59, lon:85.14, hub:true },
  { id:'gaya', name:'Gaya', state:'Bihar', aliases:['GAYA'], rail:['GAYA'], airports:['GAY'], lat:24.79, lon:85.00, hub:true },
  { id:'deoghar', name:'Deoghar', state:'Jharkhand', aliases:['Jasidih'], rail:['DGHR','JSME'], airports:['DGH'], lat:24.49, lon:86.69 },
  { id:'darbhanga', name:'Darbhanga', state:'Bihar', aliases:['DBG'], rail:['DBG'], airports:['DBR'], lat:26.15, lon:85.90 },
  { id:'bhagalpur', name:'Bhagalpur', state:'Bihar', aliases:['BGP'], rail:['BGP'], airports:['DGH','PAT'], lat:25.24, lon:86.98 },
  { id:'kiul', name:'Kiul', state:'Bihar', aliases:['KIUL','Lakhisarai'], rail:['KIUL','LKR'], airports:['PAT'], lat:25.17, lon:86.10, hub:true },
  { id:'mokama', name:'Mokama', state:'Bihar', aliases:['Mokameh','MKA'], rail:['MKA'], airports:['PAT'], lat:25.40, lon:85.92, hub:true },
  { id:'barauni', name:'Barauni', state:'Bihar', aliases:['BJU'], rail:['BJU','NBJU'], airports:['PAT','DBR'], lat:25.47, lon:85.97, hub:true },
  { id:'moradabad', name:'Moradabad', state:'Uttar Pradesh', aliases:['MB'], rail:['MB'], airports:['DEL'], lat:28.84, lon:78.77, hub:true },
  { id:'bareilly', name:'Bareilly', state:'Uttar Pradesh', aliases:['BE','Izzatnagar'], rail:['BE','BRY','IZN'], airports:['BEK'], lat:28.37, lon:79.43, hub:true },
  { id:'lucknow', name:'Lucknow', state:'Uttar Pradesh', aliases:['LKO','LJN'], rail:['LKO','LJN','GTNR'], airports:['LKO'], lat:26.85, lon:80.95, hub:true },
  { id:'kanpur', name:'Kanpur', state:'Uttar Pradesh', aliases:['CNB','Govindpuri'], rail:['CNB','GOY'], airports:['KNU'], lat:26.45, lon:80.33, hub:true },
  { id:'prayagraj', name:'Prayagraj', state:'Uttar Pradesh', aliases:['Allahabad','PRYJ','Subedarganj'], rail:['PRYJ','SFG','PYGS'], airports:['IXD'], lat:25.44, lon:81.85, hub:true },
  { id:'varanasi', name:'Varanasi', state:'Uttar Pradesh', aliases:['Banaras','BSB'], rail:['BSB','BSBS','DDU'], airports:['VNS'], lat:25.32, lon:82.97, hub:true },
  { id:'gorakhpur', name:'Gorakhpur', state:'Uttar Pradesh', aliases:['GKP'], rail:['GKP'], airports:['GOP'], lat:26.76, lon:83.37, hub:true },
  { id:'agra', name:'Agra', state:'Uttar Pradesh', aliases:['AGC','Tundla'], rail:['AGC','TDL'], airports:['AGR'], lat:27.18, lon:78.01, hub:true },
  { id:'jaipur', name:'Jaipur', state:'Rajasthan', aliases:['JP'], rail:['JP'], airports:['JAI'], lat:26.91, lon:75.79, hub:true },
  { id:'jhansi', name:'Jhansi', state:'Uttar Pradesh', aliases:['VGLJ','Virangana Lakshmibai'], rail:['VGLJ'], airports:['GWL'], lat:25.45, lon:78.57, hub:true },
  { id:'bhopal', name:'Bhopal', state:'Madhya Pradesh', aliases:['BPL','Rani Kamlapati'], rail:['BPL','RKMP'], airports:['BHO'], lat:23.26, lon:77.41, hub:true },
  { id:'ujjain', name:'Ujjain', state:'Madhya Pradesh', aliases:['UJN','Avantika'], rail:['UJN'], airports:['IDR'], lat:23.18, lon:75.78 },
  { id:'kolkata', name:'Kolkata', state:'West Bengal', aliases:['Calcutta','Howrah'], rail:['HWH','SDAH','KOAA'], airports:['CCU'], lat:22.57, lon:88.36, hub:true },
  { id:'mumbai', name:'Mumbai', state:'Maharashtra', aliases:['Bombay'], rail:['CSMT','LTT','MMCT'], airports:['BOM'], lat:19.08, lon:72.88, hub:true },
  { id:'pune', name:'Pune', state:'Maharashtra', aliases:['PUNE'], rail:['PUNE'], airports:['PNQ'], lat:18.52, lon:73.86, hub:true },
  { id:'hyderabad', name:'Hyderabad', state:'Telangana', aliases:['Secunderabad'], rail:['SC','HYB','KCG'], airports:['HYD'], lat:17.39, lon:78.49, hub:true },
  { id:'bengaluru', name:'Bengaluru', state:'Karnataka', aliases:['Bangalore'], rail:['SBC','YPR','SMVB'], airports:['BLR'], lat:12.97, lon:77.59, hub:true },
  { id:'chennai', name:'Chennai', state:'Tamil Nadu', aliases:['Madras'], rail:['MAS','MS'], airports:['MAA'], lat:13.08, lon:80.27, hub:true },
  { id:'ahmedabad', name:'Ahmedabad', state:'Gujarat', aliases:['ADI'], rail:['ADI'], airports:['AMD'], lat:23.02, lon:72.57, hub:true },
];
export const findPlace = id => PLACES.find(p=>p.id===id);
// Best match first: an exact name or alias, then a name or alias starting with the term, then an
// exact station or airport code, then any partial match. A code ranks by its position in that
// city's own station or airport list, so a city's own code beats a nearby city listing it later;
// on a tie the city with fewer codes wins (cities without their own airport list several nearby).
export function searchPlaces(term) {
  const t=term.trim().toLowerCase();if(!t)return [...PLACES];
  const rank=p=>{
    const names=[p.name,...p.aliases].map(w=>w.toLowerCase());
    if(names.includes(t))return 0;
    if(names.some(w=>w.startsWith(t)))return 1;
    const codeRanks=[p.rail,p.airports].map(list=>{const at=list.findIndex(c=>c.toLowerCase()===t);return at<0?Infinity:2+at/100+list.length/10000;});
    if(Math.min(...codeRanks)<Infinity)return Math.min(...codeRanks);
    return [...names,p.state,...p.rail,...p.airports].join(' ').toLowerCase().includes(t)?3:Infinity;
  };
  return PLACES.map(p=>[p,rank(p)]).filter(([,r])=>r<Infinity).sort((a,b)=>a[1]-b[1]).map(([p])=>p);
}
export const SOURCE_NAMES = {confirmtkt:'ConfirmTkt',skyscanner:'Skyscanner',blablacar:'BlaBlaCar'};
