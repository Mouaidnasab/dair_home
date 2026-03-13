import { createContext, useContext, useEffect, useState } from "react";

export type Currency = "SYP" | "NEW SYP" | "SAR" | "USD";

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(
  undefined,
);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("SYP");

  useEffect(() => {
    const stored = localStorage.getItem("app_currency") as Currency;
    if (stored && ["SYP", "NEW SYP", "SAR", "USD"].includes(stored)) {
      setCurrencyState(stored);
    }
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("app_currency", c);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
