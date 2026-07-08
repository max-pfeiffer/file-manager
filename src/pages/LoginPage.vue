<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { http } from "@/lib/http";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

const username = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = "";
  auth.loginBasic(username.value, password.value);
  try {
    // Any authenticated endpoint validates the credentials.
    await http("/api", { query: { path: "local://" } });
    await router.push({ name: "file-manager" });
  } catch {
    auth.logoutBasic();
    error.value = "Invalid username or password";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-gray-100">
    <form
      class="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow"
      @submit.prevent="submit"
    >
      <h1 class="text-xl font-semibold text-gray-800">File Manager</h1>
      <label class="block">
        <span class="mb-1 block text-sm text-gray-600">Username</span>
        <input
          v-model="username"
          type="text"
          name="username"
          autocomplete="username"
          required
          class="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-gray-600">Password</span>
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          class="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button
        type="submit"
        :disabled="busy"
        class="w-full rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Sign in
      </button>
    </form>
  </main>
</template>
