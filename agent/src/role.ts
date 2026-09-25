export type AgentRole = "standalone" | "supervisor" | "session";

export const ROLE_ARGUMENT = "--role";

export function resolveRole(argv: string[], env: Record<string, string | undefined>): AgentRole {
  const fromArgv = readRoleArgument(argv);
  if (fromArgv) return fromArgv;

  const fromEnv = normalizeRole(env.RM_AGENT_ROLE);
  if (fromEnv) return fromEnv;

  return "standalone";
}

export function readRoleArgument(argv: string[]): AgentRole | null {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === ROLE_ARGUMENT) {
      return normalizeRole(argv[index + 1]);
    }

    if (argument.startsWith(`${ROLE_ARGUMENT}=`)) {
      return normalizeRole(argument.slice(ROLE_ARGUMENT.length + 1));
    }
  }

  return null;
}

function normalizeRole(value: string | undefined): AgentRole | null {
  if (value === "standalone" || value === "supervisor" || value === "session") {
    return value;
  }
  return null;
}
