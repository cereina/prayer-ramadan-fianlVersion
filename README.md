# Prayer Times + Ramadan Calendar + Iftar Push (PWA)

## What this is
- Static PWA in `/public` (your app)
- Express API in `/server` (stores push subscriptions)
- Cron script in `/server/send-iftar.js` (sends Iftar push)

## Railway setup (high level)
1. Add a PostgreSQL plugin (gives you `DATABASE_URL` automatically).
2. Create VAPID keys locally:
   - `npx web-push generate-vapid-keys`
   Add these variables in Railway:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (e.g., `mailto:you@example.com`)
3. Run the SQL in `server/migrate.sql` (create `subscriptions` table).
4. Web/API service:
   - Start command: `npm start`
5. Cron service (separate Railway service from same repo):
   - Start command: `npm run cron`
   - Cron schedule: `* * * * *` (runs every minute)

## Enable push in the app
- Open the website in Chrome on Android
- Click **Enable Iftar Push**
- Accept notification permission
- (Optional) Install to home screen for better reliability
