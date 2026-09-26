import { auth, googleProvider, signInWithPopup } from './firebase';
import { GoogleAuthProvider } from 'firebase/auth';

// In-memory token cache for Workspace APIs
let cachedWorkspaceAccessToken: string | null = null;

/**
 * Configure all requested Google Workspace scopes on GoogleAuthProvider
 */
export function configureWorkspaceScopes() {
  googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
  googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
  googleProvider.addScope('https://www.googleapis.com/auth/gmail.send');
  googleProvider.addScope('https://www.googleapis.com/auth/gmail.readonly');
  googleProvider.addScope('https://www.googleapis.com/auth/chat.messages.create');
  googleProvider.addScope('https://www.googleapis.com/auth/chat.spaces.readonly');
  googleProvider.addScope('https://www.googleapis.com/auth/calendar.events');
  googleProvider.addScope('https://www.googleapis.com/auth/calendar.readonly');
}

configureWorkspaceScopes();

/**
 * Gets or prompts for Workspace OAuth Access Token
 */
export async function getWorkspaceAccessToken(forcePrompt = false): Promise<string> {
  if (cachedWorkspaceAccessToken && !forcePrompt) {
    return cachedWorkspaceAccessToken;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedWorkspaceAccessToken = credential.accessToken;
      return cachedWorkspaceAccessToken;
    }
    throw new Error('Workspace OAuth token not returned.');
  } catch (err: any) {
    console.error('Workspace Auth Error:', err);
    throw new Error(err.message || 'Failed to authenticate with Google Workspace.');
  }
}

/**
 * Clears cached Workspace access token
 */
export function clearWorkspaceAccessToken() {
  cachedWorkspaceAccessToken = null;
}

// ==========================================
// 1. GMAIL SERVICE
// ==========================================

export interface SendEmailParams {
  to: string;
  subject: string;
  bodyText: string;
}

/**
 * Encodes subject & body into RFC 2822 base64url string
 */
function createRawEmailString({ to, subject, bodyText }: SendEmailParams): string {
  const email = [
    `To: ${to}`,
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    bodyText,
  ].join('\r\n');

  return btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sends email directly via Gmail API
 * MANDATORY: Prompts user with confirmation dialog before sending email!
 */
export async function sendEmailViaGmail(
  params: SendEmailParams,
  skipConfirmation = false
): Promise<{ id: string; threadId: string }> {
  if (!skipConfirmation) {
    const confirmed = window.confirm(
      `Send email via Gmail?\n\nTo: ${params.to}\nSubject: ${params.subject}\n\nClick OK to confirm sending.`
    );
    if (!confirmed) {
      throw new Error('User cancelled sending email.');
    }
  }

  const token = await getWorkspaceAccessToken();
  const raw = createRawEmailString(params);

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearWorkspaceAccessToken();
      const freshToken = await getWorkspaceAccessToken(true);
      const retryRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${freshToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
      if (!retryRes.ok) {
        throw new Error(`Gmail API error (${retryRes.status})`);
      }
      return await retryRes.json();
    }
    throw new Error(`Gmail API error (${response.status})`);
  }

  return await response.json();
}

// ==========================================
// 2. GOOGLE CALENDAR SERVICE
// ==========================================

export interface CalendarEventParams {
  summary: string;
  description: string;
  startIsoDate: string; // e.g. YYYY-MM-DD
  endIsoDate?: string;
  location?: string;
}

/**
 * Creates a deadline / reminder event in Google Calendar
 * MANDATORY: Prompts user with confirmation dialog before creating calendar event!
 */
export async function createGoogleCalendarEvent(
  params: CalendarEventParams,
  skipConfirmation = false
): Promise<{ id: string; htmlLink?: string }> {
  if (!skipConfirmation) {
    const confirmed = window.confirm(
      `Schedule event in Google Calendar?\n\nTitle: ${params.summary}\nDate: ${params.startIsoDate}\n\nClick OK to confirm.`
    );
    if (!confirmed) {
      throw new Error('User cancelled Calendar event creation.');
    }
  }

  const token = await getWorkspaceAccessToken();

  const startDate = params.startIsoDate.includes('T')
    ? params.startIsoDate
    : `${params.startIsoDate}T09:00:00Z`;

  const endDate = params.endIsoDate
    ? (params.endIsoDate.includes('T') ? params.endIsoDate : `${params.endIsoDate}T10:00:00Z`)
    : `${params.startIsoDate}T10:00:00Z`;

  const eventPayload = {
    summary: params.summary,
    description: params.description,
    location: params.location || 'CLAUSETRACE Legal Alert',
    start: { dateTime: startDate },
    end: { dateTime: endDate },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 1440 }, // 1 day before
        { method: 'popup', minutes: 120 },  // 2 hours before
      ],
    },
  };

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventPayload),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearWorkspaceAccessToken();
      const freshToken = await getWorkspaceAccessToken(true);
      const retryRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${freshToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      });
      if (!retryRes.ok) {
        throw new Error(`Google Calendar API error (${retryRes.status})`);
      }
      return await retryRes.json();
    }
    throw new Error(`Google Calendar API error (${response.status})`);
  }

  return await response.json();
}

// ==========================================
// 3. GOOGLE CHAT SERVICE
// ==========================================

export interface ChatSpaceItem {
  name: string; // e.g. spaces/AAAA1234
  displayName?: string;
  type?: string;
}

/**
 * Lists Google Chat spaces accessible to user
 */
export async function listGoogleChatSpaces(): Promise<ChatSpaceItem[]> {
  const token = await getWorkspaceAccessToken();

  const response = await fetch('https://chat.googleapis.com/v1/spaces', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearWorkspaceAccessToken();
      const freshToken = await getWorkspaceAccessToken(true);
      const retryRes = await fetch('https://chat.googleapis.com/v1/spaces', {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!retryRes.ok) {
        throw new Error(`Google Chat API error (${retryRes.status})`);
      }
      const data = await retryRes.json();
      return data.spaces || [];
    }
    throw new Error(`Google Chat API error (${response.status})`);
  }

  const data = await response.json();
  return data.spaces || [];
}

/**
 * Posts a message to a Google Chat space
 * MANDATORY: Prompts user with confirmation dialog before posting to Chat!
 */
export async function postMessageToGoogleChat(
  spaceName: string,
  messageText: string,
  skipConfirmation = false
): Promise<{ name: string; text: string }> {
  if (!skipConfirmation) {
    const confirmed = window.confirm(
      `Post message to Google Chat?\n\nMessage:\n${messageText.slice(0, 150)}…\n\nClick OK to confirm.`
    );
    if (!confirmed) {
      throw new Error('User cancelled Google Chat message.');
    }
  }

  const token = await getWorkspaceAccessToken();

  const response = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: messageText,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Chat post error (${response.status})`);
  }

  return await response.json();
}
