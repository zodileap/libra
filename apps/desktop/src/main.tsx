import ReactDOM from "react-dom/client";
import App from "./app";
import "@aries-kit/react/theme/index.scss";
import "@aries-kit/react/style.css";
import "./theme-overrides.css";
import "./styles.css";

// 描述：在 macOS 下标记平台类名，供样式层启用标题栏覆盖模式的安全区布局。
if (navigator.userAgent.includes("Mac")) {
  document.documentElement.classList.add("desk-platform-macos");
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
