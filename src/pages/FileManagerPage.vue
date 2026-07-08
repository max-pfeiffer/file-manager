<script setup lang="ts">
import { VueFinder, RemoteDriver } from "vuefinder";
import "vuefinder/dist/vuefinder.css";

// VueFinder's built-in data layer owns all file server state; the driver
// talks to the backend file API under /api.
const driver = new RemoteDriver({ baseURL: "/api" });
</script>

<template>
  <main class="h-screen p-2">
    <VueFinder id="file-manager" :driver="driver" class="h-full" />
  </main>
</template>
