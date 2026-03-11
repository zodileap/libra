import assert from "node:assert/strict";
import test from "node:test";
import { remote } from "webdriverio";
import {
  buildDesktopE2EArtifacts,
  resolveDesktopBinaryPath,
  resolveUnsupportedPlatformReason,
  startTauriDriver,
  stopChildProcess,
} from "./helpers.mjs";

const unsupportedPlatformReason = resolveUnsupportedPlatformReason();

test(
  "TestDesktopTauriDriverSmokeShouldRenderLoginValidation",
  { skip: unsupportedPlatformReason || false, timeout: 240000 },
  async (t) => {
    buildDesktopE2EArtifacts();

    const driverProcess = await startTauriDriver();
    t.after(async () => {
      await stopChildProcess(driverProcess);
    });

    const browser = await remote({
      logLevel: "error",
      hostname: "127.0.0.1",
      port: 4444,
      path: "/",
      capabilities: {
        browserName: "wry",
        "tauri:options": {
          application: resolveDesktopBinaryPath(),
        },
      },
    });
    t.after(async () => {
      await browser.deleteSession().catch(() => undefined);
    });

    // 描述：
    //
    //   - 通过 reload 清空内存态认证信息，确保 smoke case 固定落在登录页，并验证空密码校验来自真实桌面容器而非浏览器 mock。
    await browser.waitUntil(async () => /Libra/i.test(await browser.getTitle()), {
      timeout: 20000,
      timeoutMsg: "Desktop 窗口未在预期时间内启动。",
    });
    await browser.execute(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.hash = "#/login";
      window.location.reload();
    });

    const accountInput = await browser.$('//input[@placeholder="请输入邮箱"]');
    await accountInput.waitForDisplayed({
      timeout: 20000,
      timeoutMsg: "登录页账号输入框未出现。",
    });

    const passwordInput = await browser.$('//input[@placeholder="请输入密码"]');
    const loginButton = await browser.$('//button[contains(normalize-space(.), "登录")]');

    await accountInput.setValue("qa@example.com");
    await loginButton.click();

    const passwordError = await browser.$('//*[contains(normalize-space(.), "请输入密码后再登录。")]');
    await passwordError.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "登录页未展示空密码校验提示。",
    });

    assert.equal(await accountInput.getValue(), "qa@example.com");
    assert.equal(await passwordInput.getValue(), "");
    assert.equal(await passwordError.isDisplayed(), true);
  },
);
