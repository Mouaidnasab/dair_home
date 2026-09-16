import { Coins, Globe, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CURRENCIES, useCurrency } from "@/contexts/CurrencyContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn, formatClock } from "@/lib/utils";

interface HeaderProps {
  updatedTs: number | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function Header({ updatedTs, loading, onRefresh }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { currency, setCurrency } = useCurrency();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.language === "ar" ? "rtl" : "ltr";
  }, [i18n.language]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="container flex h-14 items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-sm font-bold tracking-tight sm:text-base">{t("app.title")}</h1>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button variant="ghost" size="sm" className="gap-1.5 rounded-full px-2" onClick={onRefresh} aria-label={t("common.refresh")}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {updatedTs ? formatClock(updatedTs, i18n.language) : "—"}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 rounded-full px-2" title={t("common.currency")}>
                <Coins className="hidden h-4 w-4 text-primary sm:block" />
                <span className="text-xs font-semibold">{currency}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CURRENCIES.map(c => (
                <DropdownMenuItem key={c} onClick={() => setCurrency(c)} className="text-xs font-semibold">
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 rounded-full px-2"
            onClick={() => i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar")}
          >
            <Globe className="hidden h-4 w-4 text-primary sm:block" />
            <span className="text-xs font-semibold">{i18n.language === "ar" ? "EN" : "ع"}</span>
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={toggleTheme} aria-label={t("common.theme")}>
            {theme === "dark" ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4 text-blue-600" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
