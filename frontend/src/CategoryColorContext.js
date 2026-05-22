import { createContext, useContext, useState, useCallback } from 'react';
import { getCategoryColor as getDefaultColor } from './categoryColors';

const STORAGE_KEY = 'categoryColorOverrides';

const CategoryColorContext = createContext(null);

export function CategoryColorProvider({ children }) {
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  });

  const getColor = useCallback(
    (category) => overrides[category] || getDefaultColor(category),
    [overrides]
  );

  const setColor = useCallback((category, color) => {
    setOverrides(prev => {
      const next = { ...prev, [category]: color };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <CategoryColorContext.Provider value={{ getColor, setColor }}>
      {children}
    </CategoryColorContext.Provider>
  );
}

export function useCategoryColors() {
  return useContext(CategoryColorContext);
}
