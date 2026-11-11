import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import PaymentReturn from "@/pages/PaymentReturn";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MALICIOUS = "/payment/return?status=success&paid=1&c_id=987654&order=ORD-1&event=20&amount=39"
  + "&message=%D7%94%D7%AA%D7%A9%D7%9C%D7%95%D7%9D%20%D7%90%D7%95%D7%A9%D7%A8&redirect=https%3A%2F%2Fevil.example"
  + "&note=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E";

function renderAt(url: string) {
  return render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/payment/return" element={<PaymentReturn />} /></Routes></MemoryRouter>);
}

describe("payment return page", () => {
  it("says returning is not proof and automatic confirmation is not connected", () => {
    renderAt("/payment/return");
    expect(screen.getByText("החזרה לעמוד זה אינה מהווה אישור לכך שהתשלום בוצע או התקבל.")).toBeInTheDocument();
    expect(screen.getByText(/אישור תשלום אוטומטי עדיין אינו מחובר לאתר/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לעמוד החשבון" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: "לדף הבית" })).toHaveAttribute("href", "/");
  });

  it("success-looking query values never change the page, are never echoed, and trigger no requests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clean = renderAt("/payment/return").container.innerHTML;
    cleanup();
    const { container } = renderAt(MALICIOUS);
    expect(container.innerHTML).toBe(clean);
    for (const v of ["987654", "ORD-1", "evil.example", "התשלום אושר", "onerror", "success"]) expect(container.textContent).not.toContain(v);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toMatch(/התשלום (אושר|התקבל בהצלחה)|הופעל|נוספו \d+/);
    expect(screen.getAllByRole("link").map(a => a.getAttribute("href"))).toEqual(["/profile", "/"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is registered at /payment/return and does not read the URL, call the server, or write data", () => {
    expect(readFileSync("src/App.tsx", "utf8")).toContain('<Route path="/payment/return" element={<PaymentReturn />} />');
    const src = readFileSync("src/pages/PaymentReturn.tsx", "utf8");
    for (const banned of ["useSearchParams", "location.search", "useLocation", "supabase", "fetch(", "localStorage", "sessionStorage", "invoke"]) expect(src).not.toContain(banned);
  });
});
