import { Dashboard } from "./pages/Dashboard.js";
import { Landing } from "./pages/Landing.js";
import { SignIn } from "./pages/SignIn.js";
import { usePath } from "./router.js";

export function App() {
  const path = usePath();
  if (path.startsWith("/dashboard") || path.startsWith("/account")) return <Dashboard />;
  if (path.startsWith("/signin")) return <SignIn />;
  return <Landing />;
}
