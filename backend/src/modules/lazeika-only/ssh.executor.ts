/**
 * Lazeika-Only: SSH executor на ssh2 с password-аутентификацией.
 * Безопасность:
 *  - пароль живёт только в памяти вызова (не в argv/env/БД/логах);
 *  - строгая проверка host key по known_hosts (plain и hashed |1| форматы);
 *  - неизвестный ключ → отказ с понятной ошибкой;
 *  - таймаут + закрытие зависшего соединения.
 */
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, type ClientChannel } from "ssh2";

export type SshCredentials = {
  host: string;
  user: string;
  port: number;
  password: string;
};

export type SshResult = { ok: boolean; exitCode: number | null; stdout: string; stderr: string };

/** Записи known_hosts для host:port (plain + hashed |1|salt|hash). */
export function matchKnownHostKeys(lines: string[], host: string, port: number): Array<{ keyType: string; keyBase64: string }> {
  const out: Array<{ keyType: string; keyBase64: string }> = [];
  const aliases = new Set<string>([host, `[${host}]:${port}`]);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const matched = parts[0].split(",").some((h) => {
      if (aliases.has(h)) return true;
      if (h.startsWith("|1|")) {
        const [, , saltB64, hashB64] = h.split("|");
        try {
          const salt = Buffer.from(saltB64, "base64");
          const expected = Buffer.from(hashB64, "base64");
          // OpenSSH хеширует строку подключения: host для :22, "[host]:port" для нестандартных.
          const variants = port === 22 ? [host] : [host, `[${host}]:${port}`];
          for (const v of variants) {
            if (createHmac("sha1", salt).update(v).digest().equals(expected)) return true;
          }
        } catch { /* битая запись */ }
      }
      return false;
    });
    if (matched) out.push({ keyType: parts[1], keyBase64: parts[2] });
  }
  return out;
}

export class SshHostKeyError extends Error {}

/** Строгая проверка ключа хоста по загруженной базе. */
export function checkHostKey(knownHostsContent: string, host: string, port: number, key: Buffer): void {
  const candidates = matchKnownHostKeys(knownHostsContent.split("\n"), host, port);
  if (candidates.length === 0) {
    throw new SshHostKeyError(
      `В known_hosts нет записи для ${host}:${port}. Выполните ssh-keyscan -p ${port} ${host} >> <known_hosts файл>`,
    );
  }
  // Нормализуем base64 (padding может отличаться между ssh-keyscan и ssh2).
  const norm = (v: string) => v.replace(/=+$/, "");
  const b64 = norm(key.toString("base64"));
  for (const c of candidates) {
    if (norm(c.keyBase64) === b64) return;
  }
  throw new SshHostKeyError(`Host key ноды ${host} не совпал с known_hosts — соединение отклонено.`);
}

/**
 * Выполнить bash-скрипт на ноде по SSH (password auth).
 * Пароль передаётся только в runtime API ssh2 — ни в argv, ни в env, ни в логи.
 */
export function runSsh(
  creds: SshCredentials,
  script: string,
  opts?: { timeoutMs?: number; knownHostsFile?: string },
): Promise<SshResult> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const knownHostsFile = opts?.knownHostsFile ?? process.env.LAZEIKA_ONLY_SSH_KNOWN_HOSTS ?? "";
  return (async (): Promise<SshResult> => {
    let knownHosts: string;
    try {
      knownHosts = await readFile(knownHostsFile, "utf8");
    } catch {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `Файл known_hosts не найден: ${knownHostsFile}. Задайте LAZEIKA_ONLY_SSH_KNOWN_HOSTS и добавьте ключ ноды через ssh-keyscan.`,
      };
    }

    return new Promise<SshResult>((resolve) => {
      const conn = new Client();
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result: SshResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { conn.end(); } catch { /* уже закрыт */ }
        resolve(result);
      };
      const timer = setTimeout(() => {
        stderr += "\nlazeika-only: timeout";
        finish({ ok: false, exitCode: null, stdout, stderr });
      }, timeoutMs);

      conn.on("error", (err: Error) => {
        if (/authentication/i.test(err.message) || /All configured authentication methods failed/i.test(err.message)) {
          finish({ ok: false, exitCode: null, stdout, stderr: `SSH authentication failed for ${creds.user}@${creds.host}:${creds.port}` });
          return;
        }
        finish({ ok: false, exitCode: null, stdout, stderr });
      });

      conn.on("ready", () => {
        conn.exec("bash -s", (execErr: Error | undefined, stream: ClientChannel) => {
          if (execErr) {
            finish({ ok: false, exitCode: null, stdout, stderr: execErr.message });
            return;
          }
          stream.on("close", (code: number | null) => finish({ ok: code === 0, exitCode: code, stdout, stderr }));
          stream.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
          stream.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
          stream.end(script);
        });
      });

      conn.connect({
        host: creds.host,
        port: creds.port,
        username: creds.user,
        password: creds.password,
        readyTimeout: timeoutMs,
        // Строгая проверка host key: без совпадения с known_hosts соединение отклоняется.
        hostVerifier: (key: Buffer) => {
          try {
            checkHostKey(knownHosts, creds.host, creds.port, key);
            return true;
          } catch (e) {
            stderr += `\n${e instanceof Error ? e.message : String(e)}`;
            return false;
          }
        },
      });
    });
  })();
}

/** Убрать из stderr секреты и обрезать до безопасного размера. */
export function safeSshErrorMessage(stderr: string): string {
  return stderr
    .split("\n")
    .filter((l) => !/password|secret|private/i.test(l))
    .join("; ")
    .slice(0, 400);
}
