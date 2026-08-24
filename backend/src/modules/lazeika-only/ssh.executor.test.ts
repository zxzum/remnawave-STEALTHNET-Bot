import assert from "node:assert/strict";
import test from "node:test";

import { createHmac } from "node:crypto";
const { matchKnownHostKeys, checkHostKey, safeSshErrorMessage, SshHostKeyError } = await import("./ssh.executor.js");

test("known_hosts: plain entry matches host and [host]:port form", () => {
  const keyType = "ssh-ed25519";
  const key = "AAAAC3NzaC1lZDI1NTE5AAAAIB1234567890abcdefEXAMPLEKEY=";
  const lines = [
    "# comment",
    `example.com ${keyType} ${key}`,
    `[203.0.113.10]:2223 ${keyType} ${key}`,
    "|1|c2FsdA==|aGFzaA== ssh-rsa OTHERKEY=",
  ];
  assert.equal(matchKnownHostKeys(lines, "example.com", 22).length >= 1, true);
  assert.equal(matchKnownHostKeys(lines, "203.0.113.10", 2223).length >= 1, true);
});

test("known_hosts: hashed |1| entries are matched via hmac-sha1", () => {
  const host = "node5.example.net";
  const salt = Buffer.from("pepper123");
  const keyB64 = "AAAAC3NzaC1lZDI1NTE5AAAAIB1234567890abcdefEXAMPLEKEY=";
  const hash = createHmac("sha1", salt).update(host).digest().toString("base64");
  const lines = [`|1|${salt.toString("base64")}|${hash} ssh-ed25519 ${keyB64}`];
  const matched = matchKnownHostKeys(lines, host, 22);
  assert.equal(matched.length, 1);
  assert.equal(matched[0]!.keyBase64, keyB64);
});

test("checkHostKey throws on missing host entry and on key mismatch", () => {
  const lines = ["other-host ssh-ed25519 AAAAX"];
  assert.throws(() => checkHostKey(lines.join("\n"), "my-node", 22, Buffer.from("k")), SshHostKeyError);
  const knownKeyB64 = "AAAAC3NzaC1lZDI1NTE5AAAAIrealkey==";
  const known = `my-node ssh-ed25519 ${knownKeyB64}`;
  assert.throws(() => checkHostKey(known, "my-node", 22, Buffer.from("wrong")), SshHostKeyError);
  // Совпадение проходит (ключ передаётся как декодированный wire-format).
  checkHostKey(known, "my-node", 22, Buffer.from(knownKeyB64, "base64"));
});

test("safeSshErrorMessage strips secret-like lines and truncates", () => {
  const err = ["normal line", "password: hunter2", "private key blob"].join("\n");
  const msg = safeSshErrorMessage(err);
  assert.ok(!msg.includes("hunter2"));
  assert.ok(msg.includes("normal line"));
});
