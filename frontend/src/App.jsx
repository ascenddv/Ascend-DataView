import { Suspense, lazy, useEffect, useState } from 'react';
import AuthGate from './components/AuthGate.jsx';
import { PreferencesProvider } from './components/PreferencesProvider.jsx';
import AppShell from './components/AppShell.jsx';
import Uploader from './components/Uploader.jsx';
import ManualEntry from './components/ManualEntry.jsx';
import IngestionSummary from './components/IngestionSummary.jsx';
import MappingConfirmation from './components/MappingConfirmation.jsx';
import UploadErrorBanner from './components/UploadErrorBanner.jsx';
import Overview from './components/Overview.jsx';
import SettingsPage from './components/SettingsPage.jsx';
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard.jsx'));
import AscendAiPanel from './components/AscendAiPanel.jsx';
import VerifyEmailBanner from './components/VerifyEmailBanner.jsx';
import { completeOnboarding } from './lib/api.js';

const SECTIONS = ['dashboard', 'data', 'settings'];

function sectionFromHash() {
  if (typeof window === 'undefined') return 'dashboard';
  const m = /^#\/([a-z]+)/.exec(window.location.hash || '');
  return m && SECTIONS.includes(m[1]) ? m[1] : 'dashboard';
}

function stackStyle() {
  return { display: 'flex', flexDirection: 'column', gap: 'var(--stack-gap)' };
}

/** The Data section — the upload / manual-entry inputs, on their own tab. */
function DataSection({
  pendingMapping,
  onResult,
  onError,
  onNeedsConfirmation,
  onCancelMapping,
  onEntered,
}) {
  return (
    <div style={stackStyle()}>
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Add data
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Upload a CSV or Excel export, or add a single period by hand. Uploads merge into your
          stored history — they never replace it.
        </p>
      </div>
      {pendingMapping ? (
        <MappingConfirmation
          pending={pendingMapping}
          onConfirmed={onResult}
          onCancel={onCancelMapping}
        />
      ) : (
        <Uploader onResult={onResult} onError={onError} onNeedsConfirmation={onNeedsConfirmation} />
      )}
      <ManualEntry onEntered={onEntered} />
    </div>
  );
}

function Workspace({ user, org, onLogout, onLogoutAll }) {
  const [report, setReport] = useState(null);
  const [pendingMapping, setPendingMapping] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [onboarded, setOnboarded] = useState(org.onboardingCompleted === true);
  const [autoTour, setAutoTour] = useState(false);
  const [section, setSection] = useState(sectionFromHash);

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(next) {
    setSection(next);
    if (typeof window === 'undefined') return;
    // Only ever touch the hash — the path is reserved for AuthGate's email-link routing.
    if (next === 'dashboard') {
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } else if (window.location.hash !== `#/${next}`) {
      window.history.replaceState(null, '', `#/${next}`);
    }
  }

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
    go('dashboard');
  }

  function handleNeedsConfirmation(json) {
    setUploadError(null);
    setReport(null);
    setPendingMapping(json);
  }

  function handleWizardComplete(result) {
    // Leave the wizard and start the tour, but DON'T persist onboarding yet —
    // that waits until the tour is finished or skipped.
    setOnboarded(true);
    setAutoTour(true);
    handleResult(result.report);
  }

  if (!onboarded) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--page)' }}>
        <div className="mx-auto max-w-2xl px-6 py-10" style={stackStyle()}>
          <header className="flex items-center justify-between">
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              AscendDV
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="text-xs underline"
              style={{ color: 'var(--text-muted)' }}
            >
              Sign out
            </button>
          </header>

          {user.emailVerified === false && <VerifyEmailBanner email={user.email} />}

          <Suspense fallback={null}>
            <OnboardingWizard onComplete={handleWizardComplete} onSkip={markOnboardingDone} />
          </Suspense>

          <footer className="pt-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            <a href="/legal/terms" style={{ textDecoration: 'underline' }}>
              Terms
            </a>
            {' · '}
            <a href="/legal/privacy" style={{ textDecoration: 'underline' }}>
              Privacy
            </a>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <>
      <AppShell
        user={user}
        org={org}
        section={section}
        onSection={go}
        onLogout={onLogout}
        onLogoutAll={onLogoutAll}
        banner={
          user.emailVerified === false ? <VerifyEmailBanner email={user.email} /> : null
        }
      >
        {section === 'dashboard' && (
          <div style={stackStyle()}>
            <UploadErrorBanner message={uploadError} onDismiss={() => setUploadError(null)} />
            {report && <IngestionSummary report={report} onDismiss={() => setReport(null)} />}
            <Overview
              key={dataVersion}
              autoStartTour={autoTour}
              onTourDone={() => {
                setAutoTour(false);
                markOnboardingDone();
              }}
            />
          </div>
        )}

        {section === 'data' && (
          <DataSection
            pendingMapping={pendingMapping}
            onResult={handleResult}
            onError={setUploadError}
            onNeedsConfirmation={handleNeedsConfirmation}
            onCancelMapping={() => setPendingMapping(null)}
            onEntered={() => {
              setDataVersion((v) => v + 1);
              go('dashboard');
            }}
          />
        )}

        {section === 'settings' && (
          <SettingsPage
            org={org}
            currentUser={user}
            onReset={() => setDataVersion((v) => v + 1)}
          />
        )}
      </AppShell>

      {/* AscendAI — available from every section once past onboarding */}
      <AscendAiPanel />
    </>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <AuthGate>{(auth) => <Workspace {...auth} />}</AuthGate>
    </PreferencesProvider>
  );
}
