import { auth, googleProvider, signInWithPopup } from './firebase';
import { GoogleAuthProvider } from 'firebase/auth';

// Register all configured Google Workspace scopes on the provider
const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

WORKSPACE_SCOPES.forEach(scope => {
  try {
    googleProvider.addScope(scope);
  } catch (err) {
    // Scope might already be added
  }
});

let cachedAccessToken: string | null = null;

export async function getWorkspaceAccessToken(forcePrompt = false): Promise<string> {
  if (cachedAccessToken && !forcePrompt) {
    return cachedAccessToken;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
      return cachedAccessToken;
    }
    throw new Error('Google Workspace access token not returned.');
  } catch (err: any) {
    console.error('Workspace Auth Error:', err);
    throw new Error(err.message || 'Failed to authenticate with Google Workspace.');
  }
}

export function clearWorkspaceAccessToken() {
  cachedAccessToken = null;
}
