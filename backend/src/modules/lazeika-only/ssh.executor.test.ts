import assert from "node:assert/strict";
import test from "node:test";

const { buildSshArgs } = await import("./ssh.executor.js");

const ENV = { privateKeyPath: "/keys/id_ed25519", user: "root", port: 2223, knownHostsFile: "/keys/kh" };

test("ssh argv: -- ends options BEFORE destination, remote command goes last", () => {
  const args = buildSshArgs("203.0.113.10", ENV);
  const destIndex = args.findIndex((a) => a.includes("@"));
  assert.equal(args[destIndex], "root@203.0.113.10");
  // "--" строго до destination (конец опций)
  assert.equal(args.lastIndexOf("--"), destIndex - 1);
  // удалённая команда — после destination, отдельными аргументами
  assert.deepEqual(args.slice(destIndex + 1), ["bash", "-s"]);
  assert.match(args.join(" "), /BatchMode=yes/);
  assert.match(args.join(" "), /StrictHostKeyChecking=yes/);
  assert.match(args.join(" "), /UserKnownHostsFile=\/keys\/kh/);
});
