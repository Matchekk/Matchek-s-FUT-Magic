# Security architecture

- EA controllers exist only behind the signed, allowlisted MAIN-world RPC.
- The isolated runtime owns plans, workflow execution, approval, and recovery.
- The Side Panel and cloud issue intent-level commands only.
- Cloud never receives EA credentials, cookies, authorization headers, session
  tokens, controller objects, DOM, or persistent owned-item IDs where avoidable.
- Remote inputs are schema-versioned data. No remote JS/WASM, eval, arbitrary
  expressions, selectors, or downloaded executable workflows.
- All queues, payloads, logs, retries, histories, and diagnostics are bounded.
- Diagnostics redact secrets and sensitive URLs before persistence/export.
- Unknown capability or game semantics disable the affected destructive action,
  not the whole product.

Future Pro requests use random request-local handles. Hard-protected cards,
persistent EA owned-item/definition identifiers, player/project names, cookies,
tokens, sessions and route data are excluded. Responses must match the exact
request id, contract, sanitized-payload fingerprint and expiry; foreign or
reused handles fail closed. Remote compatibility data is downgrade-only.

The public CloudPlannerProvider accepts only an injected transport and ships no
default origin or direct `fetch`. A live adapter may later exist only in the MV3
service worker with a fixed allowlisted HTTPS route, bounded response reading,
manual redirect rejection, cancellation/deadline enforcement and token
isolation. It must pass purpose-specific consent before sending data and local
safety revalidation before compiling a proposal.

The inherited FUT.GG adapter is hard-disabled and has no host permission or CSP
connection in this release. It must remain disabled until written provider
authorization, purpose-specific consent, exact response schemas, content-type
and byte limits, redirect rejection, requested-ID coverage, bounded caches/
queues and malicious-provider tests are complete.

Legacy player/league/nation metadata formerly persisted on the EA origin is
purged on bridge startup; replacement caches are memory-only. Web-accessible
resources are limited to the two supported EA Web App URL patterns.

No public vulnerability-reporting operator/channel is configured. A commercial
release must name one, publish scope and response expectations, and keep manual
diagnostic sharing separate from telemetry or automatic upload.

Security-sensitive work must preserve the existing verified/not-applied/
ambiguous/unavailable outcome model and multi-tab workflow lease.
