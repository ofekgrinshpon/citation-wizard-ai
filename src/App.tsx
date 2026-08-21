import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProjectsProvider } from "@/hooks/useProjects";
import { BibliographyProvider } from "@/hooks/useBibliography";
import { OfficeProvider } from "@/hooks/useOffice";
import Landing from "./pages/Landing.tsx";
import Auth from "./pages/Auth.tsx";
import Index from "./pages/Index.tsx";
import Admin from "./pages/Admin.tsx";
import Profile from "./pages/Profile.tsx";
import NotFound from "./pages/NotFound.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AuthDialog from "./pages/AuthDialog.tsx";
import VerifiedSources from "./pages/VerifiedSources.tsx";
import Legal from "./pages/Legal.tsx";
import Unsubscribe from "./pages/Unsubscribe.tsx";


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

function LegalQARedirect() {
  const search = window.location.search;
  const suffix = search ? `&${search.slice(1)}` : "";
  return <Navigate to={`/app?mode=legalqa${suffix}`} replace />;
}

function AuthLoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthRedirect() {
  const { user, isAdmin, loading, isAdminResolved } = useAuth();

  // Google signup doesn't go through signUp(), so stamp the consent the user
  // gave on the Auth page once their session exists. The RPC only ever fills
  // NULL consent fields, so this is safe to run on every login.
  useEffect(() => {
    if (!user) return;
    let version: string | null = null;
    try { version = sessionStorage.getItem("relex_legal_accepted"); } catch { /* ignore */ }
    if (!version) return;
    void supabase.rpc("record_legal_acceptance", { _version: version })
      .then(() => { try { sessionStorage.removeItem("relex_legal_accepted"); } catch { /* ignore */ } });
  }, [user]);

  // Wait for both session hydration AND role resolution
  if (loading || (user && !isAdminResolved)) {
    return <AuthLoadingSpinner />;
  }

  const addinSuffix = new URLSearchParams(window.location.search).get("addin") === "1" ? "?addin=1" : "";

  if (!user) return <Navigate to={`/auth${addinSuffix ? `?${addinSuffix.slice(1)}` : ""}`} replace />;

  // Always route to /app after login — admins can navigate to /admin manually
  // This prevents the heavy admin dashboard from blocking the post-login experience
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
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/app" element={<BibliographyProvider><Index /></BibliographyProvider>} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/verified-sources" element={<VerifiedSources />} />
                  <Route path="/legal-qa" element={<LegalQARedirect />} />
                  <Route path="/auth-redirect" element={<AuthRedirect />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/terms" element={<Legal doc="terms" />} />
                  <Route path="/privacy" element={<Legal doc="privacy" />} />
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
