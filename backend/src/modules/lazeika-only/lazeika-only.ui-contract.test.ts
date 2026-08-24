import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * UI acceptance (§8 ревью): доказываем по исходнику settings.tsx, что кнопки
 * Lazeika-Only не являются silent no-op: SSH-поля видны, POST вызывается,
 * loading/ошибки видны, пароль очищается. В репозитории нет frontend-test-runner —
 * используем тот же source-contract подход, что и остальные contract-тесты.
 */
const settingsSrc = readFileSync(
  new URL("../../../../frontend/src/pages/settings.tsx", import.meta.url),
  "utf8",
);

test("setup/verify/reconcile use visible SSH fields instead of a hidden modal", () => {
  for (const kind of ["setup", "verify", "reconcile"]) {
    assert.ok(
      settingsSrc.includes(`onClick={() => runLazeikaAction("${kind}")}`),
      `кнопка «${kind}» вызывает runLazeikaAction`,
    );
  }
  // Кнопки сразу запускают действие с видимыми полями формы.
  const fn = settingsSrc.match(/function runLazeikaAction[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(fn.includes("void confirmLazeikaAction(kind)"), "runLazeikaAction запускает действие из формы");
  assert.ok(!fn.includes("setLazeikaSshOpen"), "SSH modal больше не скрывает обязательные поля");
  assert.ok(settingsSrc.includes('id="lazeika-ssh-user"'), "SSH user виден в карточке");
  assert.ok(settingsSrc.includes('id="lazeika-ssh-password"'), "SSH password виден в карточке");
});

test("settings bind notification defaults returned as an array", () => {
  assert.ok(
    settingsSrc.includes("lazeikaOnlyNotificationMessages?.[0]"),
    "первое дефолтное сообщение из API попадает в input",
  );
  assert.ok(
    settingsSrc.includes("lazeikaOnlyNotificationMessages?.[2]"),
    "третье дефолтное сообщение из API попадает в input",
  );
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

test("password is cleared immediately after the inline form submits", () => {
  const confirm = settingsSrc.match(/async function confirmLazeikaAction[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(confirm.includes("setLazeikaSshPassword(\"\")"), "пароль очищается сразу после отправки");
  assert.ok(!confirm.includes("setLazeikaSshOpen"), "пароль не зависит от скрытой модалки");
});
