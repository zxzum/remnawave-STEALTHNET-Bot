/**
 * Lazeika-Only: SSH executor поверх системного ssh (без новых зависимостей).
 * Безопасность: только argv-массив из валидированных значений, BatchMode,
 * строгий known_hosts, приватный ключ — только из окружения backend.
 */
import { spawn } from "node:child_process";

export type SshEnv = {
  privateKeyPath: string;
  user: string;
  port: number;
  knownHostsFile: string;
};

export function readSshEnv(env: NodeJS.ProcessEnv = process.env): SshEnv {
  const privateKeyPath = (env.LAZEIKA_ONLY_SSH_PRIVATE_KEY_PATH ?? "").trim();
  const knownHostsFile = (env.LAZEIKA_ONLY_SSH_KNOWN_HOSTS ?? "").trim();
  const portRaw = (env.LAZEIKA_ONLY_SSH_PORT ?? "").trim();
  const port = portRaw === "" ? 22 : Number(portRaw);
  if (!privateKeyPath) throw new Error("LAZEIKA_ONLY_SSH_PRIVATE_KEY_PATH не задан");
  if (!knownHostsFile) throw new Error("LAZEIKA_ONLY_SSH_KNOWN_HOSTS не задан");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Недопустимый LAZEIKA_ONLY_SSH_PORT: ${portRaw}`);
  }
  return {
    privateKeyPath,
    knownHostsFile,
    port,
    user: (env.LAZEIKA_ONLY_SSH_USER ?? "root").trim() || "root",
  };
}

export type SshResult = { ok: boolean; exitCode: number | null; stdout: string; stderr: string };

/**
 * Аргументы ssh: опции → "--" → destination → удалённая команда.
 * "--" ДОЛЖЕН стоять до destination (конец опций), команда — строго после.
 */
export function buildSshArgs(nodeAddress: string, sshEnv: SshEnv): string[] {
  return [
    "-i", sshEnv.privateKeyPath,
    "-p", String(sshEnv.port),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${sshEnv.knownHostsFile}`,
    "-o", "ConnectTimeout=10",
    "--",
    `${sshEnv.user}@${nodeAddress}`,
    "bash", "-s",
  ];
}

/** Выполнить скрипт на ноде: stdin = script. Никакой конкатенации команд. */
export function runSsh(nodeAddress: string, script: string, sshEnv: SshEnv = readSshEnv(), timeoutMs = 120_000): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", buildSshArgs(nodeAddress, sshEnv), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: SshResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Общий таймаут: ConnectTimeout покрывает только соединение, не выполнение скрипта.
    const timer = setTimeout(() => {
      stderr += `\nlazeika-only: timeout after ${timeoutMs}ms`;
      child.kill("SIGKILL");
      finish({ ok: false, exitCode: null, stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (exitCode) => finish({ ok: exitCode === 0, exitCode, stdout, stderr }));
    child.stdin.end(script);
  });
}
