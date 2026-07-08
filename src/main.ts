import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueFinderPlugin } from "vuefinder";

import App from "./App.vue";
import { initKeycloak } from "./lib/keycloak";
import router from "./router";
import { useAuthStore } from "./stores/auth";
import { useConfigStore } from "./stores/config";

import "./assets/main.css";

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(VueFinderPlugin);

  // Runtime config decides the auth method; for Keycloak the app only
  // mounts once authentication has completed.
  const runtime = await useConfigStore(pinia).load();
  const auth = useAuthStore(pinia);
  auth.setMethod(runtime.authMethod);

  if (runtime.authMethod === "keycloak" && runtime.keycloak) {
    const keycloak = await initKeycloak(runtime.keycloak, {
      onToken: (token) => auth.updateKeycloakToken(token),
    });
    auth.setKeycloak(keycloak);
  }

  app.use(router);
  app.mount("#app");
}

bootstrap().catch((err: unknown) => {
  console.error("Failed to start the application", err);
  document.body.innerHTML =
    '<p style="font-family: sans-serif; padding: 2rem;">' +
    "The application failed to start. Please try again later.</p>";
});
