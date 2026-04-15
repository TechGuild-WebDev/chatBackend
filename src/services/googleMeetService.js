import { google } from 'googleapis';

const calendar = google.calendar('v3');

// Google OAuth2 client setup (authenticate using your credentials)
const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
auth.setCredentials({ refresh_token: REFRESH_TOKEN });

const createGoogleMeetLink = async (title, date) => {
    const event = {
        summary: title,
        start: { dateTime: date, timeZone: 'America/New_York' },
        end: { dateTime: new Date(date).setHours(new Date(date).getHours() + 1), timeZone: 'America/New_York' },
        conferenceData: {
            createRequest: {
                requestId: `sample${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
        },
    };

    try {
        const res = await calendar.events.insert({
            auth,
            calendarId: 'primary',
            resource: event,
            conferenceDataVersion: 1,
        });

        return res.data.hangoutLink; // Google Meet link
    } catch (error) {
        console.error('Error creating Google Meet meeting:', error);
        throw new Error('Google Meet meeting creation failed');
    }
};

export { createGoogleMeetLink };
