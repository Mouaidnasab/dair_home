import { useTranslation } from "react-i18next";

interface FooterProps {
  location: {
    city: string;
    country: string;
  };
  currency: string;
}

export default function Footer({ location, currency }: FooterProps) {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border bg-muted/30 py-6">
      <div className="container">
        <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <div>
            {t(location.city)}, {t(location.country)} • {t(currency)}
          </div>
          <div className="flex items-center gap-4">
            {/* <span>•</span> */}

            <span>
              {t("Copyright Saved")} © {new Date().getFullYear()}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
