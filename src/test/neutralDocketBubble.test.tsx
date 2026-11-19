import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageBubble } from "@/components/MessageBubble";
import { TooltipProvider } from "@/components/ui/tooltip";
vi.mock("@/integrations/supabase/client",()=>({supabase:{}}));
describe("neutral docket actual bubble",()=>{
 it("does not label the source foreign even with a foreign scope",()=>{
  render(<TooltipProvider><MessageBubble msg={{role:"assistant",content:"140/00\n⚠️ נא להוסיף סוג הליך או שמות הצדדים."}} detectedType="unknown" onChangeSourceType={vi.fn()} foreignScope={{accountId:"fixture",itemKey:"fixture",input:"140/00"}} /></TooltipProvider>);
  expect(screen.getByText("לא מזוהה")).toBeTruthy();
  expect(screen.queryByText("מקור לועזי")).toBeNull();
  expect(screen.queryByText("פסיקה לועזית")).toBeNull();
 });
});
