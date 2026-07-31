import { crossedRemainingPercents } from "../modules/squad-traffic/traffic-period.js";

function run(count: number) {
  const startedAt = performance.now();
  let thresholds = 0;
  for (let index = 0; index < count; index++) {
    thresholds += crossedRemainingPercents(BigInt(index % 100), BigInt((index % 100) + 10), 100n).length;
  }
  const durationMs = performance.now() - startedAt;
  console.log(`${count.toLocaleString()} pure calculations: ${durationMs.toFixed(2)}ms (${thresholds} thresholds)`);
  if (count === 20_000 && durationMs >= 1_000) process.exitCode = 1;
}

run(1_000);
run(20_000);
