# #BEmesh map: contract for partner tools (v1)

The #BEmesh map knows who claimed which MeshCore node in Belgium. People sign in with Discord;
only members of the #BEmesh Discord server can claim. Each node has one **owner** (who claimed it)
and any number of **managers** (people the owner invited). This document is for developers of
another project's tool that wants to show that information, or to let people sign in with their
#BEmesh account.

## Privacy first

- You never get a Discord id, username or avatar.
- Each person is known to you by a **subject**: a pairwise pseudonym, stable for that person and
  your tool, different for every other partner, and meaningless outside it.
- Each person decides on the map's account page:
  - **Show my name with my nodes** (on by default). Off: you get `displayName: null`.
  - **Share my nodes with partner tools** (on by default). Off: the person is left out of the
    claims feed entirely.
- A change reaches you at your next poll. Drop what is no longer in the feed.

## Registration

The map's operator adds your tool as a partner and gives you a **secret** (32 characters or
more) and your **partner key** (a short name, e.g. `analyzer`). Keep the secret on your server;
never send it to a browser. Your tool's address (`https://your.tool/`, ending in `/`) is part of
the registration: sign-in only ever returns there.

## Claims feed (phase 1)

```
GET {map}/api/v1/partner/claims
Authorization: Bearer {secret}
```

Server to server only: a request with an `Origin` header or a cookie is refused (400).

Answer:

```json
{
  "version": 1,
  "generatedAt": "2026-11-17T10:00:00Z",
  "claims": [
    {"publicKey": "<64 hex>", "role": "owner", "subject": "<22 chars>", "displayName": "Ann", "since": "2026-10-01T08:00:00Z"},
    {"publicKey": "<64 hex>", "role": "manager", "subject": "<22 chars>", "displayName": null, "since": "2026-11-02T09:30:00Z"}
  ]
}
```

- `publicKey`: the node's public key, lower-case hex. Only nodes currently on the map.
- `role`: `owner` or `manager`. A node has at most one owner.
- `subject`: base64url(HMAC-SHA256(map secret, `"partner:" + partnerKey + ":" + personId`)), the
  first 22 characters. The same person has the same subject in the feed and at sign-in.
- `displayName`: the name the person shows, or `null` when they hide it.
- `since`: when they became owner or manager (UTC), or `null` for claims older than the map's
  claim history.

Errors: 401 `{"error": "invalid_client"}` for a missing or wrong secret; 400
`{"error": "invalid_request"}` for a browser call.

Caching: poll at most every 5 minutes. Send the last `ETag` as `If-None-Match`; an unchanged feed
answers 304 without a body.

## Sign in with #BEmesh (phase 2)

People sign in to your tool with their #BEmesh account. Your sessions stay your own; you never
see the map's cookie.

1. Send the person's browser to
   `{map}/auth/authorize?tool={partnerKey}&state={random}` (`state`: 1–128 characters of
   `A-Z a-z 0-9 . _ ~ -`; check it when they come back). Add `&prompt=none` to check silently.
2. The map signs them in with Discord when needed. The first time, it asks them on the map's own
   page: "{your label} asks for: your display name, and the nodes you share with partner tools",
   Cancel or Allow. That choice is remembered; they can withdraw it on the map's account page.
3. The map sends the browser to `{your url}auth/callback` with one of:
   - `?code={code}&state={state}`;
   - `?error=access_denied&state={state}`: they pressed Cancel;
   - `?error=login_required&state={state}` or `?error=consent_required&state={state}`: only with
     `prompt=none`, when they aren't signed in on the map or haven't allowed your tool yet.
4. Your server swaps the code within 60 seconds:

   ```
   POST {map}/auth/token
   Authorization: Bearer {secret}
   Content-Type: application/json

   {"tool": "{partnerKey}", "code": "{code}"}
   ```

   Answer: `{"handle": "…", "user": {"subject": "<22 chars>", "displayName": "Ann" | null,
   "isMember": true | false}}`. `subject` is the same as in the claims feed. `isMember` says
   whether they are a member of the #BEmesh Discord server. A code works once; a wrong, used or
   expired code (or one made before they withdrew your tool) gives 400 `{"error": "invalid_grant"}`.
5. Later, to check that the person is still signed in on the map and still allows your tool:

   ```
   POST {map}/auth/alive
   Authorization: Bearer {secret}

   {"tool": "{partnerKey}", "handle": "{handle}"}
   ```

   Answer: `{"alive": true, "user": {…as above}}` or `{"alive": false}`.

Calls 4 and 5 are server to server: a request with an `Origin` header or a cookie is refused
(400), a wrong secret gets 401.
