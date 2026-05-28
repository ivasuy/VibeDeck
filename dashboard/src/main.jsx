import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";
import App from "./App.jsx";
import "./styles.css";

const router = createBrowserRouter([
  { path: "*", element: <App /> },
]);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LocaleProvider>
      <RouterProvider router={router} />
    </LocaleProvider>
  </React.StrictMode>,
);
