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
