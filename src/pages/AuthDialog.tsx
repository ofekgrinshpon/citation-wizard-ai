/**
 * OAuth callback page for the Office Add-in dialog.
 * Opens inside Office.context.ui.displayDialogAsync(),
 * completes the OAuth flow, and sends the token back to the parent Task Pane
 * via Office.context.ui.messageParent().
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";


function isOfficeAddinRoute() {
  try {
    return new URLSearchParams(window.location.search).get("addin") === "1";
  } catch {
    return false;
  }
}

function getRedirectUrl() {
  const params = new URLSearchParams(window.location.search);
  const addin = params.get("addin");
  const ref = params.get("ref");
  if (ref && ref.length >= 4 && ref.length <= 16) {
    try { sessionStorage.setItem("relex_ref_code", ref.toUpperCase()); } catch { /* ignore */ }
  }
  const base = `${window.location.origin}/auth-dialog`;
  const qs = [addin ? `addin=${addin}` : null, ref ? `ref=${ref}` : null].filter(Boolean).join("&");
  return qs ? `${base}?${qs}` : base;
}

function sendToParent(message: object) {
  const Office = (window as any).Office;
  if (Office?.context?.ui?.messageParent) {
    Office.context.ui.messageParent(JSON.stringify(message));
    return true;
  }
  return false;
}

export default function AuthDialog() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let handled = false;

    // Listen for auth state changes — this catches the session from URL hash tokens
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (handled) return;
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        handled = true;
        const sent = sendToParent({
          type: "auth-success",
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (sent) {
          setStatus("success");
        } else {
          // Not inside Office dialog — redirect to app
          window.location.href = isOfficeAddinRoute() ? "/app?addin=1" : "/app";
        }
      }
    });

    // Check if there's already a session, or start OAuth
    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          sendToParent({ type: "auth-error", message: error.message });
          return;
        }

        // If session exists already (e.g. hash was processed before this runs)
        if (session && !handled) {
          handled = true;
          const sent = sendToParent({
            type: "auth-success",
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
          if (sent) {
            setStatus("success");
          } else {
            window.location.href = isOfficeAddinRoute() ? "/app?addin=1" : "/app";
          }
          return;
        }

        // No session and no hash — start Google OAuth flow
        if (!session && !window.location.hash.includes("access_token")) {
          const redirectUri = getRedirectUrl();

          const { error: oauthError } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: redirectUri,
              queryParams: { prompt: "select_account" },
            },
          });

          if (oauthError) {
            const msg = oauthError.message || "OAuth failed";
            setErrorMsg(msg);
            setStatus("error");
            sendToParent({ type: "auth-error", message: msg });
            return;
          }

          // If redirected, browser navigates to Google — nothing more to do
          // If not redirected, onAuthStateChange will fire when session is set
        }
      } catch (err: any) {
        const msg = err.message || "Unknown error";
        setErrorMsg(msg);
        setStatus("error");
        sendToParent({ type: "auth-error", message: msg });
      }
    };

    initAuth();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <div
      className="flex items-center justify-center min-h-screen bg-background"
      dir="rtl"
    >
      <div className="text-center p-6">
        {status === "loading" && (
          <p className="text-muted-foreground">מתחבר...</p>
        )}
        {status === "success" && (
          <p className="text-primary font-medium">ההתחברות הצליחה! ניתן לסגור חלון זה.</p>
        )}
        {status === "error" && (
          <div>
            <p className="text-destructive font-medium mb-2">שגיאה בהתחברות</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
