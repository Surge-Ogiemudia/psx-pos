import LoginClient from "./LoginClient";

export default function LoginPage() {
  const brandName = process.env.LOGIN_BRAND_NAME || "PharmaStackX POS";
  return <LoginClient brandName={brandName} />;
}
