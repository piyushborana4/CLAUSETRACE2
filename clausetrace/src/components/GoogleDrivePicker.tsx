import React, { useState, useEffect } from 'react';
import { 
  HardDrive, 
  Search, 
  Loader2, 
  FileText, 
  RefreshCw, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { 
  listGoogleDriveFiles, 
  downloadDriveFileForAnalysis, 
  DriveFileItem,
  getDriveAccessToken 
} from '../lib/googleDriveService';

interface GoogleDrivePickerProps {
  onFileSelected: (importedData: {
    base64Data?: string;
    textContent?: string;
    mimeType: string;
    title: string;
  }) => void;
  onCancel?: () => void;
}

export const GoogleDrivePicker: React.FC<GoogleDrivePickerProps> = ({
  onFileSelected,
  onCancel,
}) => {
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DriveFileItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const fetchFiles = async (query = '') => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const driveFiles = await listGoogleDriveFiles(query);
      setFiles(driveFiles);
      setIsConnected(true);
      if (driveFiles.length > 0 && !selectedFile) {
        setSelectedFile(driveFiles[0]);
      }
    } catch (err: any) {
      console.error('Drive fetch error:', err);
      setIsConnected(false);
      setErrorMessage(err.message || 'Could not connect to Google Drive. Click below to authorize access.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleConnectDrive = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await getDriveAccessToken(true);
      await fetchFiles();
    } catch (err: any) {
      setErrorMessage(err.message || 'Google Drive authorization failed.');
      setIsLoading(false);
    }
  };

  const handleImportSelected = async () => {
    if (!selectedFile) return;
    setIsImporting(true);
    setErrorMessage(null);

    try {
      const imported = await downloadDriveFileForAnalysis(selectedFile);
      onFileSelected(imported);
    } catch (err: any) {
      console.error('Drive import error:', err);
      setErrorMessage(err.message || 'Failed to download document from Google Drive.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Banner / Header */}
      <div className="p-4 rounded-2xl bg-[#E8F0FE] border border-[#D2E3FC] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white text-[#1A73E8] flex items-center justify-center shadow-2xs shrink-0">
            <HardDrive className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-[#1F1F1F] flex items-center gap-1.5">
              <span>Google Drive Integration</span>
              {isConnected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E6F4EA] text-[#137333] text-[10px] font-semibold border border-[#CEEAD6]">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </span>
              )}
            </h4>
            <p className="text-[11px] text-[#5F6368] mt-0.5">
              Pick PDFs, Google Docs, or agreements directly from your Google Drive
            </p>
          </div>
        </div>

        {!isConnected && (
          <button
            type="button"
            onClick={handleConnectDrive}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] text-white text-xs font-semibold shadow-2xs transition-colors shrink-0 cursor-pointer disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect Drive'}
          </button>
        )}
      </div>

      {errorMessage && (
        <div 
          role="alert" 
          className="p-3.5 rounded-2xl bg-[#FCE8E6] border border-[#FAD2CF] flex items-start gap-2.5 text-xs text-[#C5221F]"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 leading-relaxed">{errorMessage}</div>
          <button
            type="button"
            onClick={handleConnectDrive}
            className="text-xs font-bold underline hover:no-underline shrink-0"
          >
            Retry Connection
          </button>
        </div>
      )}

      {isConnected && (
        <>
          {/* Search Bar & Refresh */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#70757A] absolute left-3.5 top-3" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  fetchFiles(e.target.value);
                }}
                placeholder="Search Google Drive documents…"
                className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#DADCE0] text-xs text-[#1F1F1F] focus:outline-none focus:border-[#1A73E8]"
              />
            </div>

            <button
              type="button"
              onClick={() => fetchFiles(searchQuery)}
              disabled={isLoading}
              title="Refresh Drive files"
              className="p-2 rounded-xl border border-[#DADCE0] hover:bg-[#F8F9FA] text-[#5F6368] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#1A73E8]' : ''}`} />
            </button>
          </div>

          {/* File List */}
          <div className="border border-[#DADCE0] rounded-2xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-[#F1F3F4] bg-white">
            {isLoading && files.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5F6368] space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#1A73E8] mx-auto" />
                <p>Loading files from Google Drive…</p>
              </div>
            ) : files.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <FileText className="w-8 h-8 text-[#BDC1C6] mx-auto" />
                <div className="text-xs font-semibold text-[#1F1F1F]">No documents found</div>
                <p className="text-[11px] text-[#5F6368] max-w-xs mx-auto">
                  No matching PDFs, Google Docs, or text files were found in your Google Drive root.
                </p>
              </div>
            ) : (
              files.map((file) => {
                const isSelected = selectedFile?.id === file.id;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-4 py-3 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#E8F0FE] text-[#1A73E8] font-semibold' : 'hover:bg-[#F8F9FA] text-[#1F1F1F]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#5F6368]'
                      }`}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{file.name}</div>
                        <div className="text-[11px] text-[#5F6368] flex items-center gap-2 mt-0.5">
                          <span>{file.size}</span>
                          {file.modifiedTime && <span>· Modified {file.modifiedTime}</span>}
                        </div>
                      </div>
                    </div>

                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-[#1A73E8] shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Import Action Footer */}
          <div className="pt-2 flex items-center justify-between gap-3">
            <div className="text-[11px] text-[#137333] flex items-center gap-1 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Read-only Drive stream</span>
            </div>

            <button
              type="button"
              id="import-drive-file-btn"
              onClick={handleImportSelected}
              disabled={!selectedFile || isImporting}
              className="px-5 py-2.5 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] disabled:bg-[#DADCE0] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Downloading from Drive…</span>
                </>
              ) : (
                <>
                  <span>Import & Analyze Selected File</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
