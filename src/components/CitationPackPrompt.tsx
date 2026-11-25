import { Button } from "@/components/ui/button";

export function CitationPackPrompt({ onChoose }: { onChoose: React.MouseEventHandler<HTMLButtonElement> }) {
  return (
    <div dir="rtl" role="status" className="my-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
      <p>ניצלת את כל האזכורים החינמיים. רוצה להמשיך?</p>
      <Button type="button" size="sm" aria-haspopup="dialog" onClick={onChoose}>לבחירת חבילה</Button>
    </div>
  );
}
