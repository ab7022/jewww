import { Analytics } from "@vercel/analytics/react";
import { Dashboard } from "./pages/Dashboard.js";
import { Landing } from "./pages/Landing.js";
import { SignIn } from "./pages/SignIn.js";
import { usePath } from "./router.js";

export function App() {
  const path = usePath();
  return (
    <>
      {path.startsWith("/dashboard") || path.startsWith("/account") ? (
        <Dashboard />
      ) : path.startsWith("/signin") ? (
        <SignIn />
      ) : (
        <Landing />
      )}
      <Analytics />
    </>
  );
}
