import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * UI acceptance (§8 ревью): доказываем по исходнику settings.tsx, что кнопки
 * Lazeika-Only не являются silent no-op: modal открывается, POST вызывается,
 * loading/ошибки видны, пароль очищается. В репозитории нет frontend-test-runner —
 * используем тот же source-contract подход, что и остальные contract-тесты.
 */
const settingsSrc = readFileSync(
  new URL("../../../../frontend/src/pages/settings.tsx", import.meta.url),
  "utf8",
);

test("setup/verify/reconcile buttons open the SSH modal (no silent no-op)", () => {
  for (const kind of ["setup", "verify", "reconcile"]) {
    assert.ok(
      settingsSrc.includes(`onClick={() => runLazeikaAction("${kind}")}`),
      `кнопка «${kind}» вызывает runLazeikaAction`,
    );
  }
  // runLazeikaAction открывает modal и сбрасывает пароль перед показом.
  const fn = settingsSrc.match(/function runLazeikaAction[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(fn.includes("setLazeikaSshOpen(true)"), "runLazeikaAction открывает SSH modal");
  assert.ok(fn.includes("setLazeikaSshPassword(\"\")"), "пароль сбрасывается перед вводом");
});

test("confirm posts to backend, shows loading and surfaces errors to the user", () => {
  assert.ok(settingsSrc.includes("api.lazeikaOnlySetup(token,"), "POST /setup вызывается");
  assert.ok(settingsSrc.includes("api.lazeikaOnlyVerify(token, ssh)"), "POST /verify вызывается");
  assert.ok(settingsSrc.includes("api.lazeikaOnlyReconcile(token, ssh)"), "POST /reconcile вызывается");
  assert.ok(settingsSrc.includes("setLazeikaBusy(kind)"), "loading-состояние включается");
  assert.ok(settingsSrc.includes("setLazeikaBusy(null)"), "loading-состояние снимается");
  // Ошибка endpoint показывается пользователю, а не проглатывается.
  assert.ok(
    settingsSrc.includes("setMessage(e instanceof Error ? e.message : \"Ошибка операции Lazeika-Only\")"),
    "ошибка backend отображается пользователю",
  );
  // node/user/port реально попадают в POST setup.
  assert.ok(settingsSrc.includes("nodeUuid: settings.lazeikaOnlyNodeUuid"), "nodeUuid уходит в POST");
  assert.ok(settingsSrc.includes("const ssh = { user: lazeikaSshUser.trim(), port: lazeikaSshPort, password: lazeikaSshPassword }"), "ssh user/port/password уходят в POST");
});

test("password is cleared after submit, on Cancel and on backdrop click", () => {
  const confirm = settingsSrc.match(/async function confirmLazeikaAction[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(confirm.includes("setLazeikaSshPassword(\"\")"), "пароль очищается сразу после отправки");
  // Cancel-кнопка и backdrop: оба пути закрытия чистят пароль.
  const clears = settingsSrc.match(/setLazeikaSshPassword\(""\); setLazeikaSshOpen\(false\)/g) ?? [];
  assert.ok(clears.length >= 2, "Cancel и backdrop очищают пароль");
});
