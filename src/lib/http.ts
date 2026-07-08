import { ofetch, type $Fetch } from "ofetch";
import { getActivePinia } from "pinia";

import { useAuthStore } from "@/stores/auth";

/**
 * Shared HTTP client for all app-level requests (everything except
 * VueFinder's own data layer). Injects the Authorization header for the
 * active auth method in one place.
 */
export const http: $Fetch = ofetch.create({
  onRequest({ options }) {
    if (!getActivePinia()) return; // pre-bootstrap request — no auth yet
    const headers = new Headers(options.headers);
    for (const [name, value] of Object.entries(useAuthStore().authHeader())) {
      headers.set(name, value);
    }
    options.headers = headers;
  },
});
