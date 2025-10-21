import { Sun, Moon, Globe, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "react-i18next";
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
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.language === "ar" ? "rtl" : "ltr";
  }, [i18n.language]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
            <Sun className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Dair Home</h1>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            aria-label="Refresh Data"
          >
            <RefreshCw className="h-5 w-5" />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-sm text-muted-foreground cursor-help">
                {formatRelativeTime(lastUpdated)}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {formatAbsoluteTime(lastUpdated, timezone)}
            </TooltipContent>
          </Tooltip>

          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              i18n.changeLanguage(i18n.language === "en" ? "ar" : "en")
            }
            title={i18n.language === "en" ? "العربية" : "English"}
          >
            <Globe className="h-5 w-5" />
            <span className="ml-1 text-xs font-semibold">
              {i18n.language === "en" ? "EN" : "AR"}
            </span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
