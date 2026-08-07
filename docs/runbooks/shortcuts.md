# Sending a prompt into VIZION from iOS

VIZION accepts a prompt through a `?draft=` URL parameter. That one seam
covers the Siri Shortcut, the iOS share sheet, a Home Screen bookmark, and a
link in a note — anything that can open a URL.

## Why a URL parameter and not a share target

The Web Share **Target** API — the thing that would put VIZION in the iOS
share sheet natively — is Chromium-only. It is unimplemented in WebKit, so on
an iPhone it does nothing at all. `docs/audits/VIZION-enhancement-evaluation.md`
(PWA-02) records that finding and recommends the paste affordance and a URL
intake instead. If WebKit ever ships `share_target`, the manifest is where it
would go and this file is the note to revisit.

## The Shortcut

Shortcuts app → **+** → add these actions:

1. **Receive** — set "Shortcut Input" to accept **Text**, and set *"If there's
   no input"* to **Ask For Text**. This is what makes it appear in the share
   sheet from any app that shares text.
2. **URL Encode** — action: *Text* → *URL Encode*, input: **Shortcut Input**.
   Non-optional: an un-encoded `&`, `#`, or `+` in the prompt truncates or
   corrupts it.
3. **Text** — build the address:
   ```
   https://vizion-io.vercel.app/enhance?draft=[URL Encoded Text]
   ```
   (substitute your own domain if you have one bound).
4. **Open URLs** — input: the Text from step 3.

Then: Shortcut settings → **Show in Share Sheet**, accepted types **Text**.
Name it something you'll say out loud — "Enhance this prompt" works, since
Siri triggers on the shortcut name.

## Behaviour once it opens

- **Empty composer** → the prompt is filled in, ready to run.
- **Composer already has something** → VIZION does **not** overwrite it. A
  banner appears above the composer showing the incoming prompt with *Replace
  draft* / *Discard it*. It has **no timer** — it stays until you answer it,
  and replacing is undoable to whatever the draft held at the moment you
  tapped. A Shortcut fired twice by accident can't destroy work in progress.
- **The parameter is stripped once resolved.** After it applies (or after you
  discard it), reloading the tab — or iOS restoring it days later — won't
  re-apply a prompt you have since edited or cleared. While an offer is
  outstanding the parameter deliberately stays in the URL, so even a reload
  or a backgrounded PWA can't lose the shared prompt.
- **Over 8 000 characters** → ignored rather than truncated. A silently
  shortened prompt is worse than one that plainly didn't arrive.

## The signed-out cold launch

If you are **already signed in** — the normal case for an installed PWA —
everything above just works.

If your session has expired, the behaviour depends on how you sign back in:

| Sign-in path | Prompt survives? |
|---|---|
| Already signed in | Yes |
| Email + password | Yes — middleware carries the query to `/sign-in`, and the form carries it back to `/enhance` |
| Magic link | **No** |
| OAuth (GitHub / Google) | **No** |

The last two leave the browser entirely: the link arrives in a mail client, or
control passes to a provider's consent screen, and comes back through
`/auth/callback` with no memory of where it started. It could be made to
survive by putting the prompt text into the magic-link URL or the OAuth state —
which would send your prompt through an email provider's servers and into
their logs. That is not a trade worth making for an edge case, so it isn't
made. Sign in first, then fire the Shortcut.

## Checking it works

Paste this into Safari on the device (signed in), and the composer should open
holding the text:

```
https://vizion-io.vercel.app/enhance?draft=write%20a%20haiku%20about%20latency
```

Then type something into the composer, run the same URL again, and confirm you
get the *Replace draft* offer rather than a silent overwrite.
