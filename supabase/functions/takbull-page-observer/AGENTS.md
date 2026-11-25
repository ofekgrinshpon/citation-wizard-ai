# takbull-page-observer

- `takbull-page-observer` logs one `TAKBULL_PAGE_REQUEST_SHAPE_V1` line per request (`shape.ts`, via a cloned request, never affecting the response): method, URL without query values, query/header names, allowlisted transport header values, signature-like header length/format flag, body byte count and top-level key types — never other header, query or body values. Why: Takbull has no delivery log, so we need to see what actually arrives without logging personal or secret data.
