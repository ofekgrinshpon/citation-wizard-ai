import { supabase } from "@/integrations/supabase/client";

/**
 * Opens the Office dialog for Google OAuth and returns a promise
 * that resolves when auth succeeds or rejects on error/cancel.
 */
export function signInWithOfficeDialog(): Promise<void> {
  return new Promise((resolve, reject) => {
    const Office = (window as any).Office;

    if (!Office?.context?.ui?.displayDialogAsync) {
      reject(new Error("Office dialog API not available"));
      return;
    }

    const dialogUrl = `${window.location.origin}/auth-dialog?addin=1`;

    Office.context.ui.displayDialogAsync(
      dialogUrl,
      { width: 50, height: 60, displayInIframe: false },
      (asyncResult: any) => {
        if (asyncResult.status !== "succeeded" /* Office.AsyncResultStatus.Succeeded */) {
          reject(new Error(asyncResult.error?.message || "Failed to open dialog"));
          return;
        }

        const dialog = asyncResult.value;

        dialog.addEventHandler(
          12006 /* Office.EventType.DialogMessageReceived */,
          async (arg: any) => {
            dialog.close();

            try {
              const msg = JSON.parse(arg.message || arg.value);

              if (msg.type === "auth-success" && msg.access_token && msg.refresh_token) {
                const { error } = await supabase.auth.setSession({
                  access_token: msg.access_token,
                  refresh_token: msg.refresh_token,
                });

                if (error) {
                  reject(error);
                } else {
                  resolve();
                }
              } else if (msg.type === "auth-error") {
                reject(new Error(msg.message || "Authentication failed"));
              } else {
                reject(new Error("Unknown dialog message"));
              }
            } catch (e) {
              reject(e);
            }
          }
        );

        dialog.addEventHandler(
          12002 /* Office.EventType.DialogEventReceived */,
          (arg: any) => {
            // 12006 = user closed, 12003 = navigation error
            reject(new Error(`Dialog closed (code ${arg.error})`));
          }
        );
      }
    );
  });
}
