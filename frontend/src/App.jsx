import { useState } from 'react';
import AuthGate from './components/AuthGate.jsx';
import Uploader from './components/Uploader.jsx';
import ManualEntry from './components/ManualEntry.jsx';
import IngestionSummary from './components/IngestionSummary.jsx';
import UploadErrorBanner from './components/UploadErrorBanner.jsx';
import Overview from './components/Overview.jsx';

function Workspace({ user, org, onLogout }) {
  const [report, setReport] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);

  function handleResult(json) {
    setUploadError(null);
    setReport(json);
    setDataVersion((v) => v + 1);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--page)' }}>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              AscendDV
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {org.name} · {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Sign out
          </button>
        </header>

        <Uploader onResult={handleResult} onError={setUploadError} />
        <ManualEntry onEntered={() => setDataVersion((v) => v + 1)} />
        <UploadErrorBanner message={uploadError} onDismiss={() => setUploadError(null)} />
        {report && <IngestionSummary report={report} onDismiss={() => setReport(null)} />}

        <main>
          <Overview key={dataVersion} />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <AuthGate>{(auth) => <Workspace {...auth} />}</AuthGate>;
}
