require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOOKINGS_PATH = path.join(__dirname, 'data', 'bookings.json');

const SLOT_MINUTES = Number(process.env.SLOT_MINUTES || 30);
const DEMO_DURATION_MINUTES = Number(process.env.DEMO_DURATION_MINUTES || 30);
const WORKDAY_START_HOUR = Number(process.env.WORKDAY_START_HOUR || 9);
const WORKDAY_END_HOUR = Number(process.env.WORKDAY_END_HOUR || 17);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ownerEmail = process.env.OWNER_EMAIL;
const fromEmail = process.env.FROM_EMAIL || process.env.GMAIL_USER || process.env.SMTP_USER;

const smtpReady =
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  fromEmail;

const gmailOAuthReady =
  process.env.GMAIL_USER &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_REFRESH_TOKEN;

const calendarReady =
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_REFRESH_TOKEN &&
  process.env.GOOGLE_CALENDAR_ID;

const oauth2Client = calendarReady || gmailOAuthReady
  ? new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
    )
  : null;

if (oauth2Client) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}

const calendarClient = calendarReady ? google.calendar({ version: 'v3', auth: oauth2Client }) : null;

const transporter = gmailOAuthReady
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.GMAIL_USER,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      },
    })
  : smtpReady
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    : null;

async function ensureBookingsFile() {
  try {
    await fs.access(BOOKINGS_PATH);
  } catch {
    await fs.writeFile(BOOKINGS_PATH, '[]', 'utf8');
  }
}

async function readBookings() {
  await ensureBookingsFile();
  const raw = await fs.readFile(BOOKINGS_PATH, 'utf8');
  return JSON.parse(raw);
}

async function writeBookings(bookings) {
  await fs.writeFile(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildConfirmationTemplate(booking) {
  const demoDate = new Date(booking.demoDateTime).toLocaleString();
  return `
    <h2>Your AI Receptionist demo is confirmed 🎉</h2>
    <p>Hi ${booking.contactName},</p>
    <p>You're booked for <strong>${demoDate}</strong>.</p>
    <p><strong>Business:</strong> ${booking.businessName}</p>
    <p>You'll see exactly how your AI receptionist can handle calls 24/7 for $497/month.</p>
  `;
}

function buildReminderTemplate(booking) {
  const demoDate = new Date(booking.demoDateTime).toLocaleString();
  return `
    <h2>Reminder: your demo starts in 1 hour ⏰</h2>
    <p>Hi ${booking.contactName},</p>
    <p>This is a quick reminder that your demo is at <strong>${demoDate}</strong>.</p>
    <p>Reply to this email if you need to reschedule.</p>
  `;
}

async function sendEmail({ to, subject, html }) {
  if (!transporter) {
    console.warn('Email skipped: configure Gmail OAuth2 or SMTP to send emails.');
    return;
  }

  await transporter.sendMail({
    from: `AI Receptionist Pro <${fromEmail}>`,
    to,
    subject,
    html,
  });
}

function toDateAtHour(dateInput, hour, minutes = 0) {
  const date = new Date(`${dateInput}T00:00:00`);
  date.setHours(hour, minutes, 0, 0);
  return date;
}

function generateDailySlots(dateInput) {
  const slots = [];
  let slot = toDateAtHour(dateInput, WORKDAY_START_HOUR);
  const dayEnd = toDateAtHour(dateInput, WORKDAY_END_HOUR);

  while (slot < dayEnd) {
    const end = new Date(slot.getTime() + DEMO_DURATION_MINUTES * 60 * 1000);
    if (end <= dayEnd) {
      slots.push({ start: new Date(slot), end });
    }
    slot = new Date(slot.getTime() + SLOT_MINUTES * 60 * 1000);
  }

  return slots;
}

function overlaps(slotStart, slotEnd, busyStart, busyEnd) {
  return slotStart < busyEnd && slotEnd > busyStart;
}

async function getBusyWindows(timeMin, timeMax) {
  if (!calendarClient) {
    return [];
  }

  const response = await calendarClient.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: process.env.GOOGLE_CALENDAR_ID }],
    },
  });

  return response.data.calendars?.[process.env.GOOGLE_CALENDAR_ID]?.busy || [];
}

async function getAvailableSlots(dateInput) {
  const slots = generateDailySlots(dateInput);

  if (!calendarClient) {
    return slots.filter((slot) => slot.start > new Date());
  }

  const dayStart = toDateAtHour(dateInput, WORKDAY_START_HOUR).toISOString();
  const dayEnd = toDateAtHour(dateInput, WORKDAY_END_HOUR).toISOString();
  const busy = await getBusyWindows(dayStart, dayEnd);

  return slots.filter((slot) => {
    if (slot.start <= new Date()) {
      return false;
    }

    return !busy.some((window) =>
      overlaps(slot.start, slot.end, new Date(window.start), new Date(window.end))
    );
  });
}

async function createCalendarEvent(booking) {
  if (!calendarClient) {
    return null;
  }

  const start = new Date(booking.demoDateTime);
  const end = new Date(start.getTime() + DEMO_DURATION_MINUTES * 60 * 1000);

  const response = await calendarClient.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    sendUpdates: 'all',
    requestBody: {
      summary: `Demo: ${booking.businessName}`,
      description: `AI Receptionist demo booked by ${booking.contactName} (${booking.email}).`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: [{ email: booking.email }],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'email', minutes: 60 }],
      },
    },
  });

  return response.data.htmlLink || null;
}

app.get('/api/availability', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Provide date as YYYY-MM-DD.' });
    }

    const slots = await getAvailableSlots(date);
    res.json({
      date,
      slotMinutes: SLOT_MINUTES,
      demoDurationMinutes: DEMO_DURATION_MINUTES,
      slots: slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
      calendarConnected: Boolean(calendarClient),
    });
  } catch (error) {
    console.error('Availability error:', error);
    res.status(500).json({ message: 'Could not fetch availability.' });
  }
});

app.post('/api/book-demo', async (req, res) => {
  try {
    const { businessName, contactName, email, phone, demoDateTime } = req.body;

    if (!businessName || !contactName || !email || !demoDateTime) {
      return res.status(400).json({
        message: 'businessName, contactName, email, and demoDateTime are required.',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    const demoStart = new Date(demoDateTime);
    if (Number.isNaN(demoStart.getTime()) || demoStart <= new Date()) {
      return res.status(400).json({ message: 'Please choose a valid future date/time.' });
    }

    const dateInput = demoStart.toISOString().slice(0, 10);
    const availableSlots = await getAvailableSlots(dateInput);
    const selectedSlot = availableSlots.find((slot) => slot.start.toISOString() === demoStart.toISOString());

    if (!selectedSlot) {
      return res.status(409).json({ message: 'That time is no longer available. Please pick another slot.' });
    }

    const newBooking = {
      id: uuidv4(),
      businessName,
      contactName,
      email,
      phone: phone || '',
      demoDateTime: demoStart.toISOString(),
      createdAt: new Date().toISOString(),
      confirmationSentAt: null,
      reminderSentAt: null,
      calendarEventLink: null,
    };

    const bookings = await readBookings();
    bookings.push(newBooking);
    await writeBookings(bookings);

    newBooking.calendarEventLink = await createCalendarEvent(newBooking);

    await sendEmail({
      to: email,
      subject: 'Demo confirmed: AI Receptionist Pro',
      html: buildConfirmationTemplate(newBooking),
    });

    if (ownerEmail) {
      await sendEmail({
        to: ownerEmail,
        subject: `New demo booked: ${businessName}`,
        html: `
          <h2>New demo request</h2>
          <p><strong>Business:</strong> ${businessName}</p>
          <p><strong>Name:</strong> ${contactName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
          <p><strong>Demo Time:</strong> ${demoStart.toLocaleString()}</p>
          ${newBooking.calendarEventLink ? `<p><a href="${newBooking.calendarEventLink}">Open calendar event</a></p>` : ''}
        `,
      });
    }

    newBooking.confirmationSentAt = new Date().toISOString();
    const saved = await readBookings();
    const idx = saved.findIndex((item) => item.id === newBooking.id);
    if (idx >= 0) {
      saved[idx] = newBooking;
      await writeBookings(saved);
    }

    res.status(201).json({
      message: 'Demo booked successfully.',
      calendarEventLink: newBooking.calendarEventLink,
    });
  } catch (error) {
    console.error('Booking error:', error);
    res.status(500).json({ message: 'Could not submit your booking right now.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    calendarConnected: Boolean(calendarClient),
    emailConnected: Boolean(transporter),
  });
});

async function processReminders() {
  const bookings = await readBookings();
  const now = new Date();
  const windowStart = new Date(now.getTime() + 59 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 61 * 60 * 1000);
  let changed = false;

  for (const booking of bookings) {
    if (booking.reminderSentAt) {
      continue;
    }

    const demoDate = new Date(booking.demoDateTime);
    if (demoDate >= windowStart && demoDate <= windowEnd) {
      await sendEmail({
        to: booking.email,
        subject: 'Reminder: your demo starts in 1 hour',
        html: buildReminderTemplate(booking),
      });

      booking.reminderSentAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) {
    await writeBookings(bookings);
  }
}

setInterval(() => {
  processReminders().catch((error) => console.error('Reminder processor failed:', error));
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`AI Receptionist website running at http://localhost:${PORT}`);
  if (!calendarClient) {
    console.log('Google Calendar is not connected yet. Set Google env vars to enable live availability.');
  }
  if (!transporter) {
    console.log('Email is not connected yet. Set Gmail OAuth2 or SMTP env vars to enable messages.');
  }
});
