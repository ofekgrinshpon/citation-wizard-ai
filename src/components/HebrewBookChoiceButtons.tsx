import { useRef, useState } from 'react';
import type { HebrewBookChoice } from '@/lib/citationPlanner';
export function HebrewBookChoiceButtons({choice,onSelect,disabled}:{choice:HebrewBookChoice;onSelect:(id:string)=>boolean|void;disabled?:boolean}){
 const busy=useRef(false);const [selected,setSelected]=useState(false);
 const choose=(id:string)=>{if(busy.current||disabled)return;busy.current=true;setSelected(true);let applied:boolean|void=false;try{applied=onSelect(id);}finally{if(applied===false){busy.current=false;setSelected(false);}}};
 return <div role="group" aria-label="בחירת ספר ומהדורה" dir="rtl" className="mt-2 space-y-2">
 <p className="text-xs text-muted-foreground">בחרו את הספר שבידכם. הבחירה אינה מבצעת חיפוש נוסף ואינה מחייבת שוב.</p>
 {choice.options.map(o=><div key={o.id} className="flex gap-2"><button type="button" disabled={disabled||selected} onClick={()=>choose(o.id)} className="flex-1 rounded border p-2 text-right">{o.author} · {o.title} · {o.year??'שנה לא אומתה'}{o.edition?` · מהדורה ${o.edition}`:''}</button><a href={o.url} target="_blank" rel="noopener noreferrer">מקור</a></div>)}
 <button type="button" disabled={disabled||selected} onClick={()=>choose('keep-missing')} className="rounded border p-2">להשאיר את פרטי הספר חסרים</button>
 </div>;
}
