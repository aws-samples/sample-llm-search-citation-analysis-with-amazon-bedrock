import {
  useState, useEffect, useCallback
} from 'react';
import {
  API_BASE_URL, authenticatedFetch
} from '../../infrastructure';

interface QueryPrompt {
  id: string;
  name: string;
  template: string;
  enabled: boolean;
}

interface PersonaSelectorProps {
  readonly selectedPersonaId: string | null;
  readonly onPersonaChange: (personaId: string | null) => void;
}

export function PersonaSelector({ selectedPersonaId, onPersonaChange }: PersonaSelectorProps) {
  const [personas, setPersonas] = useState<QueryPrompt[]>([]);

  useEffect(() => {
    const fetchPersonas = async () => {
      try {
        const response = await authenticatedFetch(`${API_BASE_URL}/query-prompts`);
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (Array.isArray(data)) {
          setPersonas(data as QueryPrompt[]);
        }
      } catch {
        setPersonas([]);
      }
    };
    fetchPersonas();
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onPersonaChange(value === '' ? null : value);
  }, [onPersonaChange]);

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">Filter by persona</label>
      <select
        value={selectedPersonaId ?? ''}
        onChange={handleChange}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 text-sm bg-gray-50"
      >
        <option value="">All Personas</option>
        {personas.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}
