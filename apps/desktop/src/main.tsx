import ReactDOM from "react-dom/client";
import App from "./app";
import "@aries-kit/react/theme/index.scss";
import "@aries-kit/react/style.css";
import "./styles.css";

// 描述：在 macOS 下标记平台类名，供样式层启用标题栏覆盖模式的安全区布局。
if (navigator.userAgent.includes("Mac")) {
  document.documentElement.classList.add("desk-platform-macos");
}

// 描述：在 Windows 下标记平台类名，便于样式层切换透明根层与材质面板变量。
if (navigator.userAgent.includes("Windows")) {
  document.documentElement.classList.add("desk-platform-windows");
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
