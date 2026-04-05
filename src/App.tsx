import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProjectsProvider } from "@/hooks/useProjects";
import { BibliographyProvider } from "@/hooks/useBibliography";
import { OfficeProvider } from "@/hooks/useOffice";
import Landing from "./pages/Landing.tsx";
import Index from "./pages/Index.tsx";
import Admin from "./pages/Admin.tsx";
import Profile from "./pages/Profile.tsx";
import NotFound from "./pages/NotFound.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AuthDialog from "./pages/AuthDialog.tsx";

const queryClient = new QueryClient();

function isOfficeAddin() {
  try {
    if (new URLSearchParams(window.location.search).get("addin") === "1") return true;

    const win = window as Window & {
      Office?: {
        context?: {
          host?: string;
          ui?: unknown;
        };
      };
    };

    return Boolean(win.Office?.context?.host || win.Office?.context?.ui);
  }
  catch { return false; }
}

const Router = isOfficeAddin()
  ? ({ children }: { children: React.ReactNode }) => {
      const initialPath = window.location.pathname + window.location.search;
      return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
    }
  : BrowserRouter;

function AuthRedirect() {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return null;
  // Preserve ?addin=1 across redirects so Word add-in mode is not lost
  const addinSuffix = new URLSearchParams(window.location.search).get("addin") === "1" ? "?addin=1" : "";
  if (!user) return <Navigate to={`/${addinSuffix ? addinSuffix : ""}`} replace />;
  if (isAdmin) return <Navigate to={`/admin${addinSuffix}`} replace />;
  return <Navigate to={`/app${addinSuffix}`} replace />;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ProjectsProvider>
          <OfficeProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <Router>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/app" element={<BibliographyProvider><Index /></BibliographyProvider>} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/auth-redirect" element={<AuthRedirect />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/auth-dialog" element={<AuthDialog />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Router>
            </TooltipProvider>
          </OfficeProvider>
        </ProjectsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
