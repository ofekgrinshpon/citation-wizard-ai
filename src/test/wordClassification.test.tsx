import {act,renderHook,render,fireEvent,screen,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import {useForeignClassification} from '@/hooks/useForeignClassification';
import {ForeignSourcePicker} from '@/components/ForeignSourcePicker';
beforeEach(()=>localStorage.clear());
it('keeps document classification entirely in memory, reuses existing typed jurisdiction plan, resets on input change',()=>{
 const {result,rerender}=renderHook(({input})=>useForeignClassification({accountId:'word',itemKey:'word:1',input,transient:true}),{initialProps:{input:'R v Test [2020] UKSC 1'}});
 act(()=>result.current.setOverride({scalars:{family:'decision',jurisdiction:'t2:united-kingdom'}}));
 expect(result.current.plan?.manualChoice).toMatchObject({jurisdiction:'UK'});
 expect(localStorage.length).toBe(0);
 rerender({input:'New source'});expect(result.current.plan).toBeNull();expect(localStorage.length).toBe(0);
});
it('the shared picker can report a transient typed plan without saving document text',async()=>{
 const onChange=vi.fn();render(<ForeignSourcePicker transient accountId="word" itemKey="word:1" input="R v Test [2020] UKSC 1" onChange={onChange}/>);
 fireEvent.click(screen.getByRole('button',{name:'שינוי סיווג'}));
 await waitFor(()=>expect(onChange).toHaveBeenCalled());expect(localStorage.length).toBe(0);
});
