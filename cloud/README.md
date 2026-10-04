# True Cut phrase transfer

Frontend: `C:/Users/user/trump-cut-calculator.html` (published as `index.html`).
API: `https://true-cut-phrases.a-line.workers.dev`.

Deploy the API from the repository root:

```powershell
npx.cmd wrangler deploy --config cloud/wrangler.jsonc
```

Uses the existing Cloudflare login and a dedicated KV namespace. No credentials
are embedded in the frontend or this directory.

`POST /upload` accepts all 52 phrase entries and returns a new random 128-bit
access code. Each upload is an independent snapshot, without an automatic
expiration. Knowing the code grants read access. `POST /download` accepts
`{ "code": "..." }` and returns the snapshot. Codes are sent in the request body.

Origins: GitHub Pages (`https://e-effect.github.io`) and local-file (`null`).
Payloads are limited to 128 KiB, each phrase to 2,000 characters, and requests
to 20 per minute per IP. KV may take time to propagate to another location.
The UI requests confirmation before replacing local settings.
