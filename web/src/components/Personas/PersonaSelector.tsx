import {
  useEffect, useState, useCallback
} from 'react';
import {
  API_BASE_URL, authenticatedFetch
} from '../../infrastructure';

interface Persona {
  persona_id: string;
  persona_name: string;
}

interface PersonaSelectorProps {
  readonly selectedPersonaId: string | null;
  readonly onPersonaChange: (personaId: string | null) => void;
  readonly personas?: Persona[];
}

interface QueryPromptRecord {
  id: string;
  name: string;
}

function isQueryPromptArray(data: unknown): data is QueryPromptRecord[] {
  return Array.isArray(data) && data.every(
    (item) => typeof item === 'object' && item !== null && 'id' in item && 'name' in item
  );
}

export function PersonaSelector({
  selectedPersonaId, onPersonaChange, personas: externalPersonas
}: PersonaSelectorProps) {
  const [fetchedPersonas, setFetchedPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/query-prompts`);
      if (!response.ok) return;
      const json: unknown = await response.json();
      if (isQueryPromptArray(json)) {
        setFetchedPersonas(json.map((p) => ({
          persona_id: p.id,
          persona_name: p.name,
        })));
      }
    } catch {
      setFetchedPersonas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!externalPersonas) {
      fetchPersonas();
    }
  }, [externalPersonas, fetchPersonas]);

  const personaList = externalPersonas ?? fetchedPersonas;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onPersonaChange(value === '' ? null : value);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">Filter by persona</label>
      <select
        value={selectedPersonaId ?? ''}
        onChange={handleChange}
        disabled={loading}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 text-sm bg-gray-50"
      >
        <option value="">All Personas</option>
        {personaList.map((p) => (
          <option key={p.persona_id} value={p.persona_id}>{p.persona_name}</option>
        ))}
      </select>
    </div>
  );
}

export default PersonaSelector;
