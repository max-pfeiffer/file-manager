<script setup lang="ts">
import { watch } from "vue";
import { VueFinder, RemoteDriver } from "vuefinder";
import "vuefinder/dist/vuefinder.css";

import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

// VueFinder's built-in data layer owns all file server state; the driver
// talks to the backend file API under /api. Basic credentials are static
// for the page's lifetime (login happens before navigation); Keycloak
// tokens rotate, so they are pushed into the driver on every refresh.
const driver = new RemoteDriver({
  baseURL: "/api",
  headers: auth.method === "basic" ? auth.authHeader() : {},
  token: auth.keycloakToken ?? undefined,
});

watch(
  () => auth.keycloakToken,
  (token) => driver.setToken(token ?? undefined),
);
</script>

<template>
  <main class="h-screen p-2">
    <VueFinder id="file-manager" :driver="driver" class="h-full" />
  </main>
</template>
