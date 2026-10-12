# AR Methods Leads

Internal lead finder and team performance app for AR Methods.
Live at **https://armethods.web.app**

- **Find leads:** search a Perth suburb and business type. Businesses come from OpenStreetMap
  (and TomTom if a key is set in `src/config.js`). Results are grouped into no website,
  social/booking page only, and has website.
- **Claim and call:** workers claim a business (one person per business), log each call
  (No answer, Call back, Interested, Not interested, Won) with notes and call-back times.
- **Competition:** daily and weekly leaderboards, points (call 1, Interested +3, Won +10),
  daily goal, streaks and personal bests.
- **Admin:** live activity feed, per-worker stats and 14-day charts, all leads with bulk
  assignment, team management (create, deactivate workers), CSV exports.

## How it works
- Static site in `public/`, built from `src/` with esbuild (`npm run build`).
- Firebase Auth (email/password) and Cloud Firestore on the free Spark plan.
- `firestore.rules` enforce who can see and change what. Tests: `npm run test:rules`
  (runs against the local Firebase emulator, needs Java).
- Every push to `main` runs the rule tests, then deploys hosting and rules using the
  `FIREBASE_SERVICE_ACCOUNT` repository secret.

## First run
1. Open the site and choose **Owner setup**, then create the account for amanraju024@gmail.com.
   That account becomes the admin.
2. Go to **Admin → Team** to create logins for workers.

Made by AR Methods · CEO Aman Raju
