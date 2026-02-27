# Titanium AI Services Website

A full multi-page website for Titanium AI Services offer, including:
- Professional homepage, features, pricing, and booking pages.
- Live availability picker from Google Calendar.
- Demo booking flow with automatic confirmation email.
- Automatic reminder email 1 hour before the demo.

## Pages
- `/` Home
- `/features.html`
- `/pricing.html`
- `/book-demo.html`

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

Open: `http://localhost:3000`

## Connect Google Calendar + Gmail

1. Create a Google Cloud project.
2. Enable APIs:
   - Google Calendar API
   - Gmail API
3. Create OAuth client credentials.
4. Generate a refresh token (OAuth playground or your own OAuth flow).
5. Set these in `.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `GMAIL_USER`
   - `GOOGLE_CALENDAR_ID` (usually `primary`)

When connected:
- booking page only shows open slots from your calendar
- each booking creates a calendar event + invite
- customer receives confirmation email
- customer receives reminder email 1 hour before demo

## Fallback mode

If Google credentials are missing:
- booking still works
- availability is generated from configured business hours
- email sending is skipped unless SMTP fallback is configured

## API endpoints
- `GET /api/health`
- `GET /api/availability?date=YYYY-MM-DD`
- `POST /api/book-demo`

## Notes
- Keep the server running continuously in production so reminders can send on time.
