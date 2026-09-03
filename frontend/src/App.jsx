import { useState } from 'react';
import AuthGate from './components/AuthGate.jsx';
import Uploader from './components/Uploader.jsx';
import ManualEntry from './components/ManualEntry.jsx';
import IngestionSummary from './components/IngestionSummary.jsx';
import MappingConfirmation from './components/MappingConfirmation.jsx';
import UploadErrorBanner from './components/UploadErrorBanner.jsx';
import Overview from './components/Overview.jsx';
import DangerZone from './components/DangerZone.jsx';
import OnboardingWizard from './components/OnboardingWizard.jsx';
import AscendAiPanel from './components/AscendAiPanel.jsx';
import { completeOnboarding } from './lib/api.js';

function Workspace({ user, org, onLogout, onLogoutAll }) {
  const [report, setReport] = useState(null);
  const [pendingMapping, setPendingMapping] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [onboarded, setOnboarded] = useState(org.onboardingCompleted === true);
  const [autoTour, setAutoTour] = useState(false);

  // Persist onboarding as done. Per the spec this happens ONLY on tour
  // completion, an explicit tour skip, or an explicit wizard skip — never just
  // because a file was uploaded.
  function markOnboardingDone() {
    setOnboarded(true);
    completeOnboarding(org.id).catch(() => {
      /* non-critical: the wizard/tour just won't be suppressed until the next successful call */
    });
  }

  function handleResult(json) {
    setUploadError(null);
    setPendingMapping(null);
    setReport(json);
    setDataVersion((v) => v + 1);
  }

  function handleNeedsConfirmation(json) {
    setUploadError(null);
    setReport(null);
    setPendingMapping(json);
  }

  function handleWizardComplete(result) {
    // Leave the wizard and start the tour, but DON'T persist onboarding yet —
    // that waits until the tour is finished or skipped. If the user closes the
    // tab now, next login re-runs onboarding so the tour still gets shown.
    setOnboarded(true);
    setAutoTour(true);
    handleResult(result.report);
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
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Sign out
            </button>
            <button
              type="button"
              onClick={onLogoutAll}
              className="text-xs underline"
              style={{ color: 'var(--text-muted)' }}
            >
              Sign out of all devices
            </button>
          </div>
        </header>

        {!onboarded ? (
          <OnboardingWizard onComplete={handleWizardComplete} onSkip={markOnboardingDone} />
        ) : (
          <>
            <Uploader
              onResult={handleResult}
              onError={setUploadError}
              onNeedsConfirmation={handleNeedsConfirmation}
            />
            <ManualEntry onEntered={() => setDataVersion((v) => v + 1)} />
            <UploadErrorBanner message={uploadError} onDismiss={() => setUploadError(null)} />
            {pendingMapping && (
              <MappingConfirmation
                pending={pendingMapping}
                onConfirmed={handleResult}
                onCancel={() => setPendingMapping(null)}
              />
            )}
            {report && <IngestionSummary report={report} onDismiss={() => setReport(null)} />}

            <main>
              <Overview
                key={dataVersion}
                autoStartTour={autoTour}
                onTourDone={() => {
                  setAutoTour(false);
                  markOnboardingDone();
                }}
              />
            </main>

            <DangerZone org={org} onReset={() => setDataVersion((v) => v + 1)} />
          </>
        )}
      </div>

      {/* AscendAI — available from every dashboard view once past onboarding */}
      {onboarded && <AscendAiPanel />}
    </div>
  );
}

export default function App() {
  return <AuthGate>{(auth) => <Workspace {...auth} />}</AuthGate>;
}
