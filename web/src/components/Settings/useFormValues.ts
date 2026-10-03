import { useState } from 'react';

/** Form state plus a typed single-field updater. */
export function useFormValues<TValues extends object>(initial: TValues | (() => TValues)) {
  const [values, setValues] = useState<TValues>(initial);

  const updateValue = <TField extends keyof TValues>(field: TField, value: TValues[TField]): void => {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
  };

  return {
    values,
    setValues,
    updateValue,
  };
}
