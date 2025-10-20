import React, { createContext, useContext, useState, useEffect } from "react";

export type Language = "en" | "ar";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    "app.title": "Home Energy",
    "app.subtitle": "Real-time Energy Monitoring",
    "battery.title": "Battery",
    "battery.soc": "SOC",
    "battery.power": "Battery Power",
    "battery.discharging": "Discharging",
    "battery.charging": "Charging",
    "battery.idle": "Idle",
    "battery.runtime": "Estimated Runtime",
    "battery.at_load": "at load",
    "battery.info_positive": "Positive: Charging from solar/grid",
    "battery.info_negative": "Negative: Discharging to load",
    "battery.info_capacity": "Battery capacity",
    "battery.info_mock": "(mock)",
    "battery.info_runtime": "Calculated as: (SOC% × Capacity) / Load",
    "battery.info_assumptions": "Assumes constant load and no solar input",
    "inverter.pv_now": "PV Now",
    "inverter.today": "Today",
    "inverter.load": "Load",
    "inverter.rated_power": "Rated Power",
    "inverter.pv_total": "Total PV",
    "trends.title": "Trends (24h)",
    "trends.home": "Home",
    "trends.ground_floor": "Ground Floor",
    "trends.first_floor": "First Floor",
    "trends.no_data": "No data available",
    "trends.power_label": "Power (W)",
    "trends.soc_label": "SOC (%)",
    "trends.home_desc": "Combined data from both inverters",
    "trends.floor_desc": "Individual inverter trends",
    "trends.soc_desc": "Battery state of charge (right axis, %)",
    "legend.pv_power": "PV Power",
    "legend.load": "Load",
    "legend.battery": "Battery",
    "legend.grid": "Grid",
    "legend.generator": "Generator",
    "legend.soc": "SOC %",
    "government.title": "Government Electricity",
    "government.today": "Today",
    "government.intervals": "Intervals",
    "government.no_intervals": "No intervals recorded",
    "government.duration_min": "min",
    "location.country": "Syria",
    "location.city": "Deir Attiyeh",
    "footer.version": "Home Energy Monitor v1.0",
    "footer.real_time": "Real-time data",
    "footer.last_updated": "Last updated",
    "error.failed_fetch": "Failed to fetch energy data",
    "error.retry": "Retry",
  },
  ar: {
    "app.title": "مراقبة الطاقة",
    "app.subtitle": "مراقبة الطاقة في الوقت الفعلي",
    "battery.title": "البطارية",
    "battery.soc": "مستوى الشحن",
    "battery.power": "قوة البطارية",
    "battery.discharging": "تفريغ",
    "battery.charging": "شحن",
    "battery.idle": "خامل",
    "battery.runtime": "الوقت المتبقي المتوقع",
    "battery.at_load": "عند الحمل",
    "battery.info_positive": "موجب: الشحن من الطاقة الشمسية/الشبكة",
    "battery.info_negative": "سالب: التفريغ للحمل",
    "battery.info_capacity": "سعة البطارية",
    "battery.info_mock": "(محاكاة)",
    "battery.info_runtime": "محسوب كالتالي: (مستوى الشحن% × السعة) / الحمل",
    "battery.info_assumptions": "يفترض حملاً ثابتاً وعدم وجود مدخلات شمسية",
    "inverter.pv_now": "الطاقة الشمسية الآن",
    "inverter.today": "اليوم",
    "inverter.load": "الحمل",
    "inverter.rated_power": "القوة المقدرة",
    "inverter.pv_total": "إجمالي الطاقة الشمسية",
    "trends.title": "الاتجاهات (24 ساعة)",
    "trends.home": "المنزل",
    "trends.ground_floor": "الطابق الأرضي",
    "trends.first_floor": "الطابق الأول",
    "trends.no_data": "لا توجد بيانات متاحة",
    "trends.power_label": "الطاقة (W)",
    "trends.soc_label": "مستوى الشحن (%)",
    "trends.home_desc": "البيانات المدمجة من كلا العاكسين",
    "trends.floor_desc": "اتجاهات العاكس الفردي",
    "trends.soc_desc": "حالة شحن البطارية (المحور الأيمن، %)",
    "legend.pv_power": "قوة الطاقة الشمسية",
    "legend.load": "الحمل",
    "legend.battery": "البطارية",
    "legend.grid": "الشبكة",
    "legend.generator": "المولد",
    "legend.soc": "مستوى الشحن %",
    "government.title": "كهرباء الحكومة",
    "government.today": "اليوم",
    "government.intervals": "الفترات",
    "government.no_intervals": "لم يتم تسجيل فترات",
    "government.duration_min": "دقيقة",
    "location.country": "سوريا",
    "location.city": "دير عطية",
    "footer.version": "مراقب الطاقة المنزلية v1.0",
    "footer.real_time": "البيانات الحية",
    "footer.last_updated": "آخر تحديث",
    "error.failed_fetch": "فشل في جلب بيانات الطاقة",
    "error.retry": "إعادة محاولة",
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    // Get from localStorage or default to English
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("language") as Language | null;
      return saved || "en";
    }
    return "en";
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      localStorage.setItem("language", lang);
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    }
  };

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}

