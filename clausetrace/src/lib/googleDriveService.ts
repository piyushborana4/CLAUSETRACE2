import { getWorkspaceAccessToken, clearWorkspaceAccessToken } from './googleWorkspaceAuth';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  iconLink?: string;
  webViewLink?: string;
}

export function configureDriveScopes() {
  // Configured in googleWorkspaceAuth
}

export async function getDriveAccessToken(forcePrompt = false): Promise<string> {
  return getWorkspaceAccessToken(forcePrompt);
}

export function clearDriveAccessToken() {
  clearWorkspaceAccessToken();
}

/**
 * Lists legal files/documents from user's Google Drive
 */
export async function listGoogleDriveFiles(searchQuery = ''): Promise<DriveFileItem[]> {
  const token = await getDriveAccessToken();

  // Query files that are documents, PDFs, text, or images (excluding folders)
  const mimeConditions = [
    "mimeType = 'application/pdf'",
    "mimeType = 'text/plain'",
    "mimeType = 'application/vnd.google-apps.document'",
    "mimeType = 'application/msword'",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    "mimeType contains 'image/'"
  ].join(' or ');

  let q = `trashed = false and (${mimeConditions})`;
  if (searchQuery.trim()) {
    const cleanSearch = searchQuery.trim().replace(/'/g, "\\'");
    q = `trashed = false and name contains '${cleanSearch}' and (${mimeConditions})`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size,iconLink,webViewLink)&pageSize=25&orderBy=modifiedTime%20desc`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Token expired, clear cache and retry
      clearDriveAccessToken();
      const freshToken = await getDriveAccessToken(true);
      const retryRes = await fetch(url, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!retryRes.ok) {
        throw new Error(`Google Drive API error (${retryRes.status})`);
      }
      const data = await retryRes.json();
      return (data.files || []).map(formatDriveItem);
    }
    throw new Error(`Google Drive API error (${response.status})`);
  }

  const data = await response.json();
  return (data.files || []).map(formatDriveItem);
}

function formatDriveItem(file: any): DriveFileItem {
  let readableSize = 'Drive Document';
  if (file.size) {
    const bytes = parseInt(file.size, 10);
    readableSize = `${Math.round(bytes / 1024)} KB`;
  } else if (file.mimeType === 'application/vnd.google-apps.document') {
    readableSize = 'Google Doc';
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : undefined,
    size: readableSize,
    iconLink: file.iconLink,
    webViewLink: file.webViewLink,
  };
}

/**
 * Downloads and prepares Google Drive file content for CLAUSETRACE X-Ray Analysis
 */
export async function downloadDriveFileForAnalysis(
  file: DriveFileItem
): Promise<{ base64Data?: string; textContent?: string; mimeType: string; title: string }> {
  const token = await getDriveAccessToken();

  // If it's a native Google Doc, export as plain text
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
    const response = await fetch(exportUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to export Google Doc text (${response.status})`);
    }
    const textContent = await response.text();
    return {
      textContent,
      mimeType: 'text/plain',
      title: file.name,
    };
  }

  // Standard files (PDF, images, text, docx)
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file from Google Drive (${response.status})`);
  }

  if (file.mimeType === 'text/plain') {
    const textContent = await response.text();
    return { textContent, mimeType: 'text/plain', title: file.name };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);

  return {
    base64Data,
    mimeType: file.mimeType || 'application/pdf',
    title: file.name,
  };
}

/**
 * Exports a summary report or analysis back to Google Drive
 * MANDATORY: Prompts user with window.confirm or custom dialog before writing files!
 */
export async function exportReportToGoogleDrive(
  fileName: string,
  reportText: string,
  skipConfirmation = false
): Promise<{ fileId: string; webViewLink?: string }> {
  if (!skipConfirmation) {
    const confirmed = window.confirm(
      `Save "${fileName}" to your Google Drive? This will create a new text report in your Google Drive storage.`
    );
    if (!confirmed) {
      throw new Error('User cancelled Drive export.');
    }
  }

  const token = await getDriveAccessToken();

  const metadata = {
    name: fileName,
    mimeType: 'text/plain',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', new Blob([reportText], { type: 'text/plain' }));

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to upload report to Google Drive (${response.status})`);
  }

  const data = await response.json();
  return {
    fileId: data.id,
    webViewLink: data.webViewLink,
  };
}
