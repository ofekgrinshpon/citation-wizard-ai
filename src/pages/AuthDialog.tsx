/**
 * OAuth callback page for the Office Add-in dialog.
 * This page opens inside Office.context.ui.displayDialogAsync(),
 * completes the OAuth flow, and sends the token back to the parent Task Pane
 * via Office.context.ui.messageParent().
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export default function AuthDialog() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const handleAuth = async () => {
      try {
        // Check if we have a session from the OAuth redirect
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          return;
        }

        if (session) {
          // Send the session tokens back to the parent Task Pane
          const Office = (window as any).Office;
          if (Office?.context?.ui?.messageParent) {
            Office.context.ui.messageParent(
              JSON.stringify({
                type: "auth-success",
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              })
            );
            setStatus("success");
          } else {
            // Not inside Office dialog — redirect normally
            window.location.href = "/app";
          }
          return;
        }

        // No session yet — initiate Google OAuth
        const result = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: window.location.origin + "/auth-dialog",
        });

        if (result.error) {
          setErrorMsg(result.error.message || "OAuth failed");
          setStatus("error");
          return;
        }

        if (result.redirected) {
          // Browser will redirect to Google
          return;
        }

        // If tokens were returned directly
        const Office = (window as any).Office;
        if (Office?.context?.ui?.messageParent) {
          const { data: { session: newSession } } = await supabase.auth.getSession();
          if (newSession) {
            Office.context.ui.messageParent(
              JSON.stringify({
                type: "auth-success",
                access_token: newSession.access_token,
                refresh_token: newSession.refresh_token,
              })
            );
            setStatus("success");
          }
        }
      } catch (err: any) {
        setErrorMsg(err.message || "Unknown error");
        setStatus("error");
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
