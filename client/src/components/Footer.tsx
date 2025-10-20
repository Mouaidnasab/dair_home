import { useLanguage } from "@/contexts/LanguageContext";

interface FooterProps {
  location: {
    city: string;
    country: string;
  };
  currency: string;
}

export default function Footer({ location, currency }: FooterProps) {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-border bg-muted/30 py-6">
      <div className="container">
        <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <div>
            {location.city}, {location.country} • {currency}
          </div>
          <div className="flex items-center gap-4">
            <span>{t("footer.version")}</span>
            <span>•</span>
            <span>{t("footer.real_time")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

