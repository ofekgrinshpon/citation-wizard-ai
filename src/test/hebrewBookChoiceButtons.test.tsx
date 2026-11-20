import {it,expect,vi} from 'vitest';import {render,screen,fireEvent} from '@testing-library/react';
import {HebrewBookChoiceButtons} from '../components/HebrewBookChoiceButtons';
import {buildHebrewBookChoice} from '../../supabase/functions/_shared/citationPure/hebrewBookChoice';
const choice=buildHebrewBookChoice('דיני חוזים',{candidates:[{title:'דיני חוזים',author:'מחבר',sourceUrl:'https://nevo.co.il/book'}],sources:[{title:'דיני חוזים - מחבר',url:'https://nevo.co.il/book',snippet:''}]})!;
it('selection is local, one-shot, keep partial available',()=>{const selected=vi.fn(()=>true);render(<HebrewBookChoiceButtons choice={choice} onSelect={selected}/>);const b=screen.getByRole('button',{name:/מחבר ·/});fireEvent.click(b);fireEvent.click(b);expect(selected).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'להשאיר את פרטי הספר חסרים'})).toBeDisabled();});
