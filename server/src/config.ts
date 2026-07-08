const AUTH_METHODS = ["basic", "keycloak", "none"] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

export interface BasicAuthConfig {
  username: string;
  password: string;
}

export interface KeycloakConfig {
  url: string;
  realm: string;
  clientId: string;
}

export interface AppConfig {
  port: number;
  host: string;
  filesRoot: string;
  authMethod: AuthMethod;
  basicAuth?: BasicAuthConfig;
  keycloak?: KeycloakConfig;
}

export class ConfigError extends Error {}

function isAuthMethod(value: string): value is AuthMethod {
  return (AUTH_METHODS as readonly string[]).includes(value);
}

function required(env: NodeJS.ProcessEnv, name: string, when: string): string {
  const value = env[name];
  if (!value) {
    throw new ConfigError(`${name} is required when ${when}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.PORT ?? "8080";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(
      `PORT must be an integer between 1 and 65535, got "${rawPort}"`,
    );
  }

  const authMethod = env.AUTH_METHOD ?? "none";
  if (!isAuthMethod(authMethod)) {
    throw new ConfigError(
      `AUTH_METHOD must be one of ${AUTH_METHODS.join(", ")}, got "${authMethod}"`,
    );
  }

  const config: AppConfig = {
    port,
    host: env.HOST ?? "0.0.0.0",
    filesRoot: env.FILES_ROOT ?? "/data",
    authMethod,
  };

  if (authMethod === "basic") {
    config.basicAuth = {
      username: required(env, "AUTH_USERNAME", "AUTH_METHOD=basic"),
      password: required(env, "AUTH_PASSWORD", "AUTH_METHOD=basic"),
    };
  }

  if (authMethod === "keycloak") {
    config.keycloak = {
      url: required(env, "KEYCLOAK_URL", "AUTH_METHOD=keycloak"),
      realm: required(env, "KEYCLOAK_REALM", "AUTH_METHOD=keycloak"),
      clientId: required(env, "KEYCLOAK_CLIENT_ID", "AUTH_METHOD=keycloak"),
    };
  }

  return config;
}
