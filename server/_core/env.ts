export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  backendUrl: "https://dair.drd-home.online",
  isProduction: process.env.NODE_ENV === "production",
};
