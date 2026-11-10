// Shared display formats. Times and dates are always shown in India Standard Time.
export const MONEY=(n:number)=>'₹'+n.toLocaleString('en-IN');
export const clock=(s:string)=>new Date(s).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
export const date=(s:string)=>new Date(s).toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'});
export const duration=(m:number)=>`${Math.floor(m/60)}h${m%60?' '+Math.round(m%60)+'m':''}`;
// A calendar day such as "2026-11-26" as "Thu 26".
export const weekday=(day:string)=>new Date(day+'T12:00:00+05:30').toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata',weekday:'short',day:'numeric'});
// The India calendar date of an instant, such as "2026-11-26".
export const istDay=(s:string)=>new Date(s).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
