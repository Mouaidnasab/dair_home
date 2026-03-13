import { Sun, Moon, Globe, RefreshCw, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import { useCurrency, Currency } from "@/contexts/CurrencyContext";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime, formatAbsoluteTime } from "@/lib/utils";
import { useEffect } from "react";

interface HeaderProps {
  lastUpdated: string;
  timezone?: string;
  onRefresh: () => void;
}

export default function Header({
  lastUpdated,
  timezone,
  onRefresh,
}: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { currency, setCurrency } = useCurrency();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.language === "ar" ? "rtl" : "ltr";
  }, [i18n.language]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-center relative">
        <div className="flex items-center gap-2 sm:gap-2">
          {/* Refresh & Status Group */}
          <div className="flex items-center gap-2  hover:bg-muted/60 transition-colors rounded-full p-1 pe-4  h-9">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full hover:bg-background/80 flex items-center justify-center shrink-0"
              onClick={onRefresh}
              aria-label="Refresh Data"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-[10px] font-bold text-muted-foreground cursor-help whitespace-nowrap leading-none flex items-center">
                  {formatRelativeTime(lastUpdated)}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px] font-medium">
                {formatAbsoluteTime(lastUpdated, timezone)}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="h-6 w-[1px] bg-border/60 mx-1 hidden sm:block" />

          {/* Settings Group */}
          <div className="flex items-center gap-1 sm:gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 sm:px-3 gap-2 rounded-full hover:bg-muted font-bold transition-all"
                  title="Currency"
                >
                  <Coins className="h-4 w-4 text-primary" />
                  <span className="text-xs tracking-tight">{currency}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="rounded-xl border-border/50 shadow-xl"
              >
                {(["SYP", "NEW SYP", "SAR", "USD"] as Currency[]).map((c) => (
                  <DropdownMenuItem
                    key={c}
                    onClick={() => setCurrency(c)}
                    className="rounded-lg text-xs font-bold"
                  >
                    {c}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 sm:px-3 gap-2 rounded-full hover:bg-muted font-bold transition-all"
              onClick={() =>
                i18n.changeLanguage(i18n.language === "en" ? "ar" : "en")
              }
              title={i18n.language === "en" ? "العربية" : "English"}
            >
              <Globe className="h-4 w-4 text-primary" />
              <span className="text-xs">
                {i18n.language === "en" ? "EN" : "AR"}
              </span>
            </Button>
          </div>

          <div className="h-6 w-[1px] bg-border/60 mx-1" />

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full hover:bg-muted transition-transform active:scale-95"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5 text-amber-500 fill-amber-500/10" />
            ) : (
              <Moon className="h-5 w-5 text-blue-600 fill-blue-600/10" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
