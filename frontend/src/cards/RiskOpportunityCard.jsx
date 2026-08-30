import CardShell, { CardLabel } from './CardShell.jsx';

/**
 * Risk / Opportunity card — a fired deterministic rule, narrated. Risk and
 * opportunity are visually distinct (accent colour + word label + icon), never
 * colour alone.
 */
export default function RiskOpportunityCard({ type, title, detail }) {
  const isRisk = type === 'risk';
  const accent = isRisk ? 'var(--status-critical)' : 'var(--status-good)';
  const kicker = isRisk ? 'Risk' : 'Opportunity';
  const icon = isRisk ? '▲' : '★';

  return (
    <CardShell accent={accent} tint>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" style={{ color: accent }}>
          {icon}
        </span>
        <CardLabel>{kicker}</CardLabel>
      </div>

      <div
        className="mt-2 text-base font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </div>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {detail}
      </p>
    </CardShell>
  );
}
