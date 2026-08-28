import { createContext, useContext } from 'react';

export const SuperadminContext = createContext(null);

export function useSuperadmin() {
  const contexto = useContext(SuperadminContext);
  if (!contexto) throw new Error('useSuperadmin precisa ser usado dentro de SuperadminProvider.');
  return contexto;
}
