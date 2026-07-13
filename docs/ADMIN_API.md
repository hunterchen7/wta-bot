# Admin API and MCP

The dashboard, automation API, and MCP server all run inside the same Cloudflare
Worker. D1 and R2 bindings exist only inside that Worker; browsers and MCP
clients never receive database credentials and cannot submit SQL.

## Personal MCP token

Sign in as an organizer and open **Admin → MCP**. The page shows the MCP URL and
your personal organizer token. The token is masked by default and can be revealed
or copied when needed. Resetting it immediately invalidates the previous token.

WTA stores a SHA-256 hash for authentication and an AES-GCM-encrypted copy for
owner-only display in the dashboard. The encryption key comes from the Worker's
secret configuration; plaintext tokens and database credentials are never sent
to the browser bundle.

Available scopes:

- `admin:read` — roster, sessions, rounds, forms metadata, questions, operations,
  and aggregate stats. Required for every token.
- `participants:write` — participant status changes.
- `problems:write` — create Markdown-backed question-bank entries.
- `program:write` — reserved for future cohort and pairing mutations.
- `operations:write` — reserved for future delivery operations.

Tokens stop working if their owner is no longer a current organizer.

## JSON API

Base URL: `https://wta.hunterchen.ca/api/admin/v1`

Send the token with every request:

```sh
curl -H "Authorization: Bearer $WTA_ADMIN_TOKEN" \
  https://wta.hunterchen.ca/api/admin/v1/overview
```

Current endpoints:

- `GET /` — API identity and granted scopes
- `GET /overview`
- `GET /participants?search=&status=&limit=`
- `GET /participants/:id`
- `PATCH /participants/:id/status`
- `GET /rounds?weekId=`
- `GET /problems`
- `POST /problems`

All inputs are bounded and passed through prepared D1 statements. Mutations are
written to `audit_log` with the token owner's participant ID.

## MCP

Streamable HTTP endpoint: `https://wta.hunterchen.ca/mcp`

Configure the MCP client to send the same bearer token. This is a stateless,
JSON-response MCP server built with the official stable TypeScript SDK. Its tool
list is generated from the token's scopes.

Current tools:

- `get_overview`
- `list_participants`
- `get_participant`
- `list_rounds`
- `list_problems`
- `set_participant_status` (`participants:write`)
- `create_problem` (`problems:write`)

The MCP layer calls typed application services. It does not have a generic SQL
tool, arbitrary HTTP proxy, filesystem access, or secret-reading tool.

## Security model

- Browser sessions are signed, `Secure`, `HttpOnly`, and `SameSite=Lax`.
- Organizer access is revalidated against the current email allowlist or Discord
  organizer role for every privileged request; the seven-day cookie claim alone
  is insufficient.
- Cross-origin browser mutations carrying a dashboard cookie are rejected.
- Admin bearer tokens are random 256-bit secrets with a one-way authentication
  hash and a separately encrypted, owner-readable copy. They are scoped,
  revocable, and tied to a current organizer.
- MCP validates the request URL host against `PUBLIC_ORIGIN` and does not enable
  browser CORS.
- Signed enrollment, report, problem, and export URLs remain purpose-specific
  bearer links with expirations. A global `no-referrer` policy prevents those
  tokens from leaking through outbound links.

API tokens are still credentials: do not paste them into chat, commit them, or
put them in browser JavaScript. For a multi-user external integration, add an
OAuth 2.1 flow rather than distributing one shared token.
