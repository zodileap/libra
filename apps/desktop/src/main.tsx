import ReactDOM from "react-dom/client";
import App from "./app";
import "aries_react/theme/components/index.scss";
import "aries_react/dist/assets/style.css";
import "./theme-overrides.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
