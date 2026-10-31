# AR Methods: project notes for Claude

Owner: Aman Raju (CEO, AR Methods, Perth WA web design). Sales team cold-calls local businesses to sell websites.

## Two separate things (never mix them up)
- **armethods.web.app**: the team app in THIS repo (vanilla JS + esbuild, Firebase Spark: Auth, Firestore australia-southeast2, Hosting site `armethods`). Deploys on push to `main` via GitHub Actions (tests must pass).
- **armethods.com**: public studio website + NFC shop (Stripe), built in **Lovable** (project "AR METHODS", workspace "CLIENT WEBSITES"). Do NOT spend Lovable credits without asking: the owner needs them for client work. Free route: connect the Lovable project to GitHub and edit code directly.
- `site/` here = old public site on Hosting site `armethods-perth`; now redirects to armethods.com. Its `unsubscribe.html` is still used by follow-up emails.

## Hard rules
- No card details anywhere; stay on free tiers (Spark plan, so no Cloud Storage: chat files live in Firestore).
- No personal name or printed phone number on anything public. "Call us" button → tel:+61493523482. Instagram: https://www.instagram.com/ar.methods_/
- No fake testimonials/stats. Australian English. Must not look/sound AI-made.
- Never paste the service account JSON; it lives in the GitHub secret `FIREBASE_SERVICE_ACCOUNT`. Gmail app password is the secret `GMAIL_APP_PASSWORD`.

## Business numbers
- Packages: Starter $500, Pro $850, Premium $1200 (write prices without a thousands comma). Care plans $10/$20/$30/$45 a month.
- Commission: $100 per paid site of $500+, else 10%; only counts once "Paid in full".
- NFC: Google review card/stand (black or white), Facebook & Instagram cards (brand colours), $50 each, custom link +$2, shipping $5 flat (AU).
- No free mockups in sales scripts.

## Automations (GitHub Actions)
- `morning-brief.yml` 7:30am Perth: owner brief (email, iPhone spoken link, WhatsApp via CallMeBot when available) + worker progress emails on weekdays. Each channel sends once per day.
- Team WhatsApp group (`scripts/wa-group.mjs`, Green-API free plan, owner's own number linked): morning scoreboard + hourly deal alerts, ladder unlocks, enquiries/NFC orders. Quiet 9pm–7am Perth. Secrets GREEN_API_ID / GREEN_API_TOKEN, variables GREEN_API_URL / WA_GROUP_NAME. Off until those are set.
- `follow-ups.yml` hourly: website/NFC enquiries (email owner, auto-reply) and 4-step follow-up emails for Interested leads (weekdays 8am–6pm).

## Testing
- `npm run test:unit`, `npm run test:rules` (Firestore emulator). Keep rules tests green; add one for any new collection.
- Build: `npm run build` (src/index.html → public/index.html with hashed app js).
