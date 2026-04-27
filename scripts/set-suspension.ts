import { spawnSync } from "node:child_process";

const action = process.argv[2];

if (action !== "on" && action !== "off") {
  throw new Error("Uso: tsx scripts/set-suspension.ts on|off");
}

const value = action === "on" ? "true" : "false";

function run(command: string, args: string[], input?: string): void {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    shell: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(output || `${command} ${args.join(" ")} falhou`);
  }
}

run("vercel", ["env", "rm", "SERVICE_SUSPENDED", "production", "--yes"]);
run("vercel", ["env", "add", "SERVICE_SUSPENDED", "production"], value);
run("vercel", ["deploy", "--prod"]);

console.log(action === "on"
  ? "Sistema suspenso em producao."
  : "Sistema reativado em producao.");
