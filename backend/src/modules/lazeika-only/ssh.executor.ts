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
 * Выполнить скрипт на ноде: stdin = script. Никакой конкатенации команд:
 * адрес ноды приходит только из списка Remnawave nodes и валидируется выше.
 */
export function runSsh(nodeAddress: string, script: string, sshEnv: SshEnv = readSshEnv()): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    // ponytail: StrictHostKeyChecking=yes + известный user@host; ключ не передаём аргументами команды.
    const args = [
      "-i", sshEnv.privateKeyPath,
      "-p", String(sshEnv.port),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${sshEnv.knownHostsFile}`,
      "-o", "ConnectTimeout=10",
      `${sshEnv.user}@${nodeAddress}`,
      "--", "bash -s",
    ];
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ ok: exitCode === 0, exitCode, stdout, stderr }));
    child.stdin.end(script);
  });
}
