import HealthCheck from './components/HealthCheck.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">AscendDV</h1>
          <p className="mt-1 text-sm text-slate-600">
            Analytics that adapt to the data you actually have.
          </p>
        </header>

        <main className="mt-8">
          <HealthCheck />
        </main>
      </div>
    </div>
  );
}
