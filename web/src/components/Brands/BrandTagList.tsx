interface BrandTagListProps {
  readonly brands: string[];
  readonly selectedBrand: string | null;
  readonly colorScheme: 'emerald' | 'amber';
  readonly onSelect: (brand: string | null) => void;
  readonly onRemove: (brand: string) => void;
  readonly emptyMessage?: string;
}

export const BrandTagList = ({
  brands,
  selectedBrand,
  colorScheme,
  onSelect,
  onRemove,
  emptyMessage = 'None added',
}: BrandTagListProps) => {
  const colors = colorScheme === 'emerald'
    ? {
      selected: 'bg-emerald-600 text-white ring-2 ring-emerald-300',
      normal: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
      remove: 'text-emerald-600 hover:text-emerald-800',
      removeSelected: 'text-emerald-200 hover:text-white',
      empty: 'text-emerald-600',
    }
    : {
      selected: 'bg-amber-600 text-white ring-2 ring-amber-300',
      normal: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
      remove: 'text-amber-600 hover:text-amber-800',
      removeSelected: 'text-amber-200 hover:text-white',
      empty: 'text-amber-600',
    };

  if (brands.length === 0) {
    return <span className={`text-sm ${colors.empty} italic`}>{emptyMessage}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {brands.map((brand) => {
        const isSelected = selectedBrand === brand;
        return (
          <button
            key={brand}
            onClick={() => onSelect(isSelected ? null : brand)}
            className={`px-3 py-1 rounded-full text-sm flex items-center gap-2 transition-colors ${isSelected ? colors.selected : colors.normal}`}
          >
            {brand}
            <span
              onClick={(e) => {
                e.stopPropagation();
                onRemove(brand);
                if (isSelected) onSelect(null);
              }}
              className={`font-bold cursor-pointer ${isSelected ? colors.removeSelected : colors.remove}`}
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
};
