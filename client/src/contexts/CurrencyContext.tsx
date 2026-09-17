import { createContext, useContext, useState } from "react";

export const CURRENCIES = ["SYP", "NEW SYP", "SAR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

function stored(): Currency {
  try {
    const v = localStorage.getItem("app_currency");
    return (CURRENCIES as readonly string[]).includes(v ?? "") ? (v as Currency) : "SYP";
  } catch {
    return "SYP";
  }
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(stored);
  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem("app_currency", c);
    } catch {
      /* private mode */
    }
  };
  return <CurrencyContext.Provider value={{ currency, setCurrency }}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) throw new Error("useCurrency must be used within a CurrencyProvider");
  return context;
}
