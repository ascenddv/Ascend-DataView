import { useEffect, useState } from 'react';
import Uploader from './Uploader.jsx';
import MappingConfirmation from './MappingConfirmation.jsx';
import UploadErrorBanner from './UploadErrorBanner.jsx';
import { fetchSchema } from '../lib/api.js';
import { downloadTemplateCsv } from '../lib/csvTemplate.js';

/**
 * First-run wizard (Phase 17). One focus per step, clear progress. Step 2 offers
 * the two ways to get data in — upload a file, or download a schema-shaped CSV
 * template to fill in — and both converge on a successful ingestion, which ends
 * the wizard and hands control back so the tour can start on real data.
 *
 * Skipping is always allowed; the caller marks onboarding done either way so the
 * wizard never reappears.
 */
const TOTAL_STEPS = 2;

export default function OnboardingWizard({ onComplete, onSkip }) {
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSchema()
      .then((d) => setFields(d.fields))
      .catch(() => setFields([]));
  }, []);

  function handleResult(report) {
    setError(null);
    setPending(null);
    onComplete({ uploaded: true, report });
  }

  const dot = (i) => (
    <span
      key={i}
      className="h-1.5 w-6 rounded-full"
      style={{ background: i <= step ? 'var(--series-1)' : 'var(--border)' }}
    />
  );

  return (
    <section
      className="rounded-xl border p-6"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      data-testid="onboarding-wizard"
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">{[1, 2].map(dot)}</div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Step {step} of {TOTAL_STEPS}
        </span>
      </div>

      {step === 1 && (
        <div className="mt-5">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Welcome to AscendDV
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            AscendDV turns whatever data you have — even if it's patchy — into a dashboard of
            what your organization can actually measure. Nothing is invented: a card only
            appears when there's enough data behind it. Let's get your first period of data in,
            then we'll walk through what it means.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
              style={{ background: 'var(--series-1)' }}
            >
              Get started
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-5">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Add your first data
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Upload a CSV or Excel export. Not sure of the format? Download a template with every
            column AscendDV understands, fill in the rows you have, and upload it here.
          </p>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => downloadTemplateCsv(fields || [])}
              disabled={!fields}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              Download the CSV template
            </button>
          </div>

          <div className="mt-4">
            {pending ? (
              <MappingConfirmation
                pending={pending}
                onConfirmed={handleResult}
                onCancel={() => setPending(null)}
              />
            ) : (
              <Uploader
                onResult={handleResult}
                onError={setError}
                onNeedsConfirmation={setPending}
              />
            )}
          </div>

          <UploadErrorBanner message={error} onDismiss={() => setError(null)} />

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Skip for now
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
