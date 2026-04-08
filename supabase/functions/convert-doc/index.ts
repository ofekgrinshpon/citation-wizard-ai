import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const CONVERTAPI_SECRET = Deno.env.get("CONVERTAPI_SECRET");
    if (!CONVERTAPI_SECRET) {
      throw new Error("CONVERTAPI_SECRET not configured");
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Forward to ConvertAPI
    const convertForm = new FormData();
    convertForm.append("File", file, file.name);
    convertForm.append("StoreFile", "true");

    const res = await fetch("https://v2.convertapi.com/convert/doc/to/docx", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONVERTAPI_SECRET}`,
      },
      body: convertForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("ConvertAPI error:", res.status, errText);
      throw new Error(`ConvertAPI failed (${res.status})`);
    }

    const result = await res.json();
    const fileUrl = result?.Files?.[0]?.Url;

    if (!fileUrl) {
      throw new Error("ConvertAPI returned no file URL");
    }

    // Download the converted file
    const docxRes = await fetch(fileUrl);
    if (!docxRes.ok) {
      throw new Error("Failed to download converted file");
    }

    const docxBuffer = await docxRes.arrayBuffer();

    return new Response(docxBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${file.name.replace(/\.doc$/i, ".docx")}"`,
      },
    });
  } catch (e) {
    console.error("convert-doc error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
