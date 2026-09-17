import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

interface DayNavProps {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}

export default function DayNav({ label, onPrev, onNext, nextDisabled }: DayNavProps) {
  const { i18n } = useTranslation();
  const rtl = i18n.language === "ar";
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev} aria-label="previous">
        <Prev className="h-4 w-4" />
      </Button>
      <span className="min-w-24 text-center text-sm font-medium tabular-nums">{label}</span>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext} disabled={nextDisabled} aria-label="next">
        <Next className="h-4 w-4" />
      </Button>
    </div>
  );
}
