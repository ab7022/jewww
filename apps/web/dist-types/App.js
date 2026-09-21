import { jsx as _jsx } from "react/jsx-runtime";
import { Dashboard } from "./pages/Dashboard.js";
import { Landing } from "./pages/Landing.js";
import { SignIn } from "./pages/SignIn.js";
import { usePath } from "./router.js";
export function App() {
    const path = usePath();
    if (path.startsWith("/dashboard"))
        return _jsx(Dashboard, {});
    if (path.startsWith("/signin"))
        return _jsx(SignIn, {});
    return _jsx(Landing, {});
}
//# sourceMappingURL=App.js.map