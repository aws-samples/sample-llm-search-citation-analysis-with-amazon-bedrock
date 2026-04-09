import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { TooltipItem } from 'chart.js';
import type { PersonaRankingsResponse } from '../../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface PersonaComparisonChartProps { readonly data: PersonaRankingsResponse | null; }

function computeAverageRank(brands: ReadonlyArray<{ rank: number }>): number | null {
  if (brands.length === 0) return null;
  const sum = brands.reduce((acc, b) => acc + b.rank, 0);
  return sum / brands.length;
}

export function PersonaComparisonChart({ data }: PersonaComparisonChartProps) {
  if (!data) return null;

  const personasWithResults = data.personas.filter((p) => p.brands.length > 0);

  if (personasWithResults.length < 2) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Brand Ranking by Persona</h3>
        <p className="text-center text-gray-500 text-sm">
          At least two personas are needed for comparison.
        </p>
      </div>
    );
  }

  const labels = personasWithResults.map((p) => p.persona_name);

  const firstPartyAverages = personasWithResults.map((p) => {
    const matching = p.brands.filter((b) => b.classification === 'first_party');
    return computeAverageRank(matching);
  });

  const competitorAverages = personasWithResults.map((p) => {
    const matching = p.brands.filter((b) => b.classification === 'competitor');
    return computeAverageRank(matching);
  });

  const firstPartyCounts = personasWithResults.map(
    (p) => p.brands.filter((b) => b.classification === 'first_party').length
  );

  const competitorCounts = personasWithResults.map(
    (p) => p.brands.filter((b) => b.classification === 'competitor').length
  );

  const chartData = {
    labels,
    datasets: [
      {
        label: 'First-party brands',
        data: firstPartyAverages,
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
        borderColor: 'rgb(16, 185, 129)',
        borderWidth: 1,
      },
      {
        label: 'Competitor brands',
        data: competitorAverages,
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const },
      tooltip: {
        callbacks: {
          label(context: TooltipItem<'bar'>) {
            const personaIndex = context.dataIndex;
            const persona = personasWithResults[personaIndex];
            const isFirstParty = context.datasetIndex === 0;
            const brandType = isFirstParty ? 'First-party' : 'Competitor';
            const avgRank = context.parsed.y ?? 0;
            const brandCount = isFirstParty
              ? firstPartyCounts[personaIndex]
              : competitorCounts[personaIndex];
            return `${persona.persona_name} — ${brandType}: avg rank ${avgRank.toFixed(1)} (${brandCount} brands)`;
          },
        },
      },
    },
    scales: {
      y: {
        reverse: true,
        beginAtZero: false,
        title: {
          display: true,
          text: 'Average Brand Rank (lower is better)',
        },
      },
      x: {
        title: {
          display: true,
          text: 'Persona',
        },
      },
    },
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">Brand Ranking by Persona</h3>
      <Bar data={chartData} options={options} />
    </div>
  );
}

export default PersonaComparisonChart;
