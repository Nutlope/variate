import { createRoot } from "react-dom/client";
import { Hero } from "./components/Hero.jsx";
import { Pricing } from "./components/Pricing.jsx";
import "./tokens.css";

createRoot(document.getElementById("root")).render(
  <main>
    <Hero />
    <Pricing />
  </main>,
);
