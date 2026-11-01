import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ReferenceDataProvider } from "./context/ReferenceDataContext";
import { SocketProvider } from "./context/SocketContext";
import { ToastProvider } from "./context/ToastContext";
import "./styles/tailwind.css";
import "./styles/globals.scss";
import { routeRecoveryFragment } from "./lib/recovery";

// A password-recovery email can land on the Site URL root; move it to the
// reset route before the router reads the initial location.
routeRecoveryFragment();

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root was not found in index.html");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <ReferenceDataProvider>
              <App />
            </ReferenceDataProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
