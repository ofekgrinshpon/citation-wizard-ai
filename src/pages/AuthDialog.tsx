/**
 * OAuth callback page for the Office Add-in dialog.
 * Opens inside Office.context.ui.displayDialogAsync(),
 * completes the OAuth flow, and sends the token back to the parent Task Pane
 * via Office.context.ui.messageParent().
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const PUBLISHED_ORIGIN = "https://citation-wizard-ai.lovable.app";

function getRedirectOrigin() {
  // In production use the published URL; in dev use current origin
  if (window.location.hostname === "localhost" || window.location.hostname.includes("preview")) {
    return window.location.origin;
  }
  return PUBLISHED_ORIGIN;
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
    const handleAuth = async () => {
      try {
        // 1. Check if we already have a session (OAuth redirect landed here with tokens in hash)
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          sendToParent({ type: "auth-error", message: error.message });
          return;
        }

        if (session) {
          // We have tokens — send them back to the Task Pane
          const sent = sendToParent({
            type: "auth-success",
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });

          if (sent) {
            setStatus("success");
          } else {
            // Not inside Office dialog — redirect to app
            window.location.href = "/app";
          }
          return;
        }

        // 2. No session yet — start Google OAuth flow
        const redirectUri = getRedirectOrigin() + "/auth-dialog";

        const result = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: redirectUri,
        });

        if (result.error) {
          const msg = (result.error as any).message || "OAuth failed";
          setErrorMsg(msg);
          setStatus("error");
          sendToParent({ type: "auth-error", message: msg });
          return;
        }

        if (result.redirected) {
          // Browser will redirect to Google — nothing more to do
          return;
        }

        // 3. If tokens were returned directly (rare path)
        const { data: { session: newSession } } = await supabase.auth.getSession();
        if (newSession) {
          const sent = sendToParent({
            type: "auth-success",
            access_token: newSession.access_token,
            refresh_token: newSession.refresh_token,
          });
          if (sent) {
            setStatus("success");
          } else {
            window.location.href = "/app";
          }
        }
      } catch (err: any) {
        const msg = err.message || "Unknown error";
        setErrorMsg(msg);
        setStatus("error");
        sendToParent({ type: "auth-error", message: msg });
      }
    };

    handleAuth();
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
